// Strict documents on /output-verify (Session 2): invoices, quotes, purchase
// orders and receipts, made with the document engine's own template, gate and
// versions. Every value has one of two sources:
//
// - **The store.** The model names an order number or product SKUs; the values
//   (customer, lines, prices, discount, tax, shipping, dates) are copied here
//   from the sample data, with "store" provenance. The model never types a
//   store number, so a store number can't be wrong (build-loop §8).
// - **The person.** Anything else the model sets is a generation operation that
//   quotes the person's own words, checked by the engine's gate (D-49).
//
// Everything else stays Missing. Nothing is invented to complete a document.

import { z } from 'zod'

import { DISCOUNT_OPTIONS, INVOICE_FIELDS as F, KIND_NOUN, COMMERCIAL_KINDS } from '../documents/invoice'
import { gateOperations } from '../documents/generation/gate'
import { normaliseQuote } from '../documents/generation/apply'
import { digest } from '../documents/generation/digest'
import { OperationSchema } from '../documents/generation/ops'
import { describeChanges, GENERATOR_AUTHOR } from '../documents/generation/tools'
import type { CommercialKind, DocumentEnv, Field, FieldState, InvoiceLineItem, InvoiceSnapshot, Provenance } from '../documents/model'
import { money, parseMoneyInput, percentOf } from '../documents/money'
import { createDocument, currentRevision, getDocument, RevisionError, saveGenerated, versionNumber, type RevisionStore } from '../documents/revisions'
import { blankFields, INVOICE_BLOCKS, invoiceSnapshot } from '../documents/templates/invoice'
import { validateSnapshot } from '../documents/validation'
import type { Order, Product, Store } from './fixtures/stores'

export const STRICT_KINDS = COMMERCIAL_KINDS

/** What each kind is called on screen ("Making your purchase order"). */
export const kindName = (kind: CommercialKind) => KIND_NOUN[kind]

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'Write a plain decimal such as 420 or 420.50, with no symbols or separators.')

export const ProductLineSchema = z.object({
  sku: z.string().min(1).max(40).describe('A SKU from the store’s catalogue (find_products).'),
  quantity: z.number().int().min(1).max(100_000),
  unitCost: z.object({
    amount: decimal,
    evidence: z.string().min(1).max(200).describe('The person’s exact words that state this price.'),
  }).strict().optional().describe('Purchase orders only, when the person states the price per unit they pay. The store’s selling price is never used on a purchase order.'),
}).strict()

const operations = z.array(OperationSchema).max(60).optional().describe('Facts the person stated that aren’t in the store’s data (a document number, due date, payment terms, a supplier’s name). Each one quotes the person’s own words. Leave out anything they didn’t say: it stays Missing.')
const followUp = z.string().min(1).max(240).optional().describe('One short question about the most important fact that is still missing, shown under the document.')

export const StrictDocumentInputSchema = z.object({
  type: z.enum([...STRICT_KINDS, 'other']).describe('"other": a policy or another document with exact terms, which is coming later; give a summary and nothing else.'),
  summary: z.string().min(1).max(300).optional().describe('type "other" only: one line, what you would make.'),
  fromOrder: z.string().min(1).max(40).optional().describe('Invoice or receipt for a store order: its order number. The customer, lines, discount, tax and shipping are copied from the order.'),
  products: z.array(ProductLineSchema).min(1).max(40).optional().describe('Lines for catalogue products, by SKU and quantity. Titles and prices are copied from the store (not for a purchase order, see unitCost).'),
  operations,
  followUp,
}).strict()

export const UpdateDocumentInputSchema = z.object({
  products: z.array(ProductLineSchema).min(1).max(40).optional().describe('Catalogue products to add as new lines.'),
  operations: operations.describe('Changes to the current version. Every change to an existing field or line quotes its digest from the current document.'),
  followUp,
}).strict()

export type StrictDocumentInput = z.infer<typeof StrictDocumentInputSchema>
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInputSchema>

export type StrictContext = {
  store: Store
  today: string
  env: DocumentEnv
  /** Everything the person wrote in this conversation: the only text a quote may come from. */
  sourceText: string
  revisions: RevisionStore
}

export type StrictResult =
  | { ok: true; revisions: RevisionStore; outputId: string; revisionId: string; version: number; changeSummary: string; changed: string[] }
  | { ok: false; errors: string[] }

// ── Filling from the store ───────────────────────────────────────────────────

type Draft = { fields: Record<string, Field>; items: InvoiceLineItem[]; provenance: Record<string, Provenance>; errors: string[] }

function set(d: Draft, fieldId: string, state: FieldState, ref: string) {
  if (!d.fields[fieldId]) return // this kind has no such field
  d.fields[fieldId] = { ...d.fields[fieldId], state }
  if (state.status === 'provided') d.provenance[`field:${fieldId}`] = { source: 'store', ref }
}

const text = (t: string): FieldState => ({ status: 'provided', value: { type: 'text', text: t } })

/** "FH-01042", "fh01042" or "1042". */
export function findOrder(store: Store, number: string): Order | undefined {
  const key = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const digitsOnly = /^\d+$/.test(key(number))
  return store.orders.find((o) => key(o.number) === key(number) || (digitsOnly && Number(o.number.replace(/\D/g, '')) === Number(key(number))))
}

const findProduct = (store: Store, sku: string): Product | undefined => store.products.find((p) => p.sku.toUpperCase() === sku.trim().toUpperCase())

function addProductLines(d: Draft, kind: CommercialKind, store: Store, lines: StrictDocumentInput['products'], ctx: StrictContext, nextId: (p: string) => string): string[] {
  const added: string[] = []
  const source = normaliseQuote(ctx.sourceText)
  for (const [i, line] of (lines ?? []).entries()) {
    const product = findProduct(store, line.sku)
    if (!product) { d.errors.push(`products[${i}]: there is no product with SKU ${line.sku}. Use find_products to look it up.`); continue }
    let unitPrice: InvoiceLineItem['unitPrice'] = { amountMinor: product.priceMinor, currency: store.currency }
    if (kind === 'purchase-order') {
      unitPrice = null
      if (line.unitCost) {
        const quote = normaliseQuote(line.unitCost.evidence)
        const digits = (t: string) => t.replace(/[,\s'_]/g, '')
        const stated = line.unitCost.amount.includes('.') ? line.unitCost.amount.replace(/0+$/, '').replace(/\.$/, '') : line.unitCost.amount
        if (!source.includes(quote)) { d.errors.push(`products[${i}].unitCost.evidence: “${line.unitCost.evidence}” is not in what the person wrote. Quote their words, or leave the price out.`); continue }
        if (!digits(quote).includes(stated)) { d.errors.push(`products[${i}].unitCost: the quote “${line.unitCost.evidence}” does not state ${line.unitCost.amount}.`); continue }
        const parsed = parseMoneyInput(line.unitCost.amount, store.currency)
        if (!parsed.ok) { d.errors.push(`products[${i}].unitCost.amount: ${parsed.message}`); continue }
        unitPrice = parsed.money
      }
    } else if (line.unitCost) {
      d.errors.push(`products[${i}].unitCost: only a purchase order takes a stated cost; a ${KIND_NOUN[kind]} uses the store’s price.`)
      continue
    }
    const id = nextId('li')
    d.items.push({ id, description: product.title, quantityMilli: line.quantity * 1000, unitPrice })
    d.provenance[`line:${id}`] = line.unitCost ? { source: 'prompt', evidence: line.unitCost.evidence } : { source: 'store', ref: `product ${product.sku}` }
    added.push(`line:${id}`)
  }
  return added
}

function fillFromOrder(d: Draft, kind: CommercialKind, store: Store, number: string, nextId: (p: string) => string) {
  const order = findOrder(store, number)
  if (!order) { d.errors.push(`fromOrder: there is no order ${number}. Use find_order or customer_orders to look it up.`); return }
  if (kind === 'quote' || kind === 'purchase-order') { d.errors.push(`fromOrder: a ${KIND_NOUN[kind]} isn’t made from a customer’s order. Use products instead.`); return }
  if (order.status === 'cancelled') { d.errors.push(`fromOrder: order ${order.number} was cancelled, so there is nothing to ${kind === 'receipt' ? 'give a receipt for' : 'invoice'}. Tell the person instead.`); return }
  const ref = `order ${order.number}`
  const customer = store.customers.find((c) => c.id === order.customerId)
  if (customer) {
    set(d, F.buyerName, text(customer.name), ref)
    set(d, F.buyerAddress, { status: 'provided', value: { type: 'multiline', lines: [...customer.address] } }, ref)
  }
  set(d, F.orderNumber, text(order.number), ref)
  if (kind === 'receipt') set(d, F.issueDate, { status: 'provided', value: { type: 'date', iso: order.date } }, ref)
  d.items = []
  for (const line of order.lines) {
    const id = nextId('li')
    d.items.push({ id, description: line.title, quantityMilli: line.quantity * 1000, unitPrice: { amountMinor: line.unitPriceMinor, currency: store.currency } })
    d.provenance[`line:${id}`] = { source: 'store', ref }
  }
  // The store's discounts are a percentage of the subtotal; anything else isn't one the document can show.
  if (order.discountMinor === 0) set(d, F.discountApplicability, { status: 'provided', value: { type: 'choice', option: 'none' } }, ref)
  else {
    // Whole-percent rates only, and only when the engine's own arithmetic gives the order's discount back.
    const bp = Math.round((order.discountMinor * 100) / order.subtotalMinor) * 100
    const rate = percentOf(money(order.subtotalMinor, store.currency), bp, 'half-up').amountMinor === order.discountMinor ? bp : undefined
    if (rate === undefined) d.errors.push(`fromOrder: order ${order.number}'s discount isn’t a simple percentage, so it can’t be shown on a ${KIND_NOUN[kind]}.`)
    else {
      set(d, F.discountApplicability, { status: 'provided', value: { type: 'choice', option: 'percent' } }, ref)
      set(d, F.discountRate, { status: 'provided', value: { type: 'percent', basisPoints: rate } }, ref)
    }
  }
  set(d, F.taxApplicability, { status: 'provided', value: { type: 'choice', option: 'applicable' } }, ref)
  set(d, F.taxRate, { status: 'provided', value: { type: 'percent', basisPoints: order.taxRateBp } }, ref)
  if (order.shippingMinor > 0) set(d, F.shipping, { status: 'provided', value: { type: 'money', money: money(order.shippingMinor, store.currency) } }, ref)
}

/** The blank kind with what the store knows about itself: issuer, address, currency, the date, its usual tax and discount. */
function startDraft(kind: CommercialKind, store: Store, today: string): Draft {
  const d: Draft = { fields: Object.fromEntries(blankFields(kind).map((f) => [f.id, f])), items: [], provenance: {}, errors: [] }
  set(d, F.issuerName, text(store.brand.issuerDisplayName), 'store details')
  set(d, F.issuerAddress, { status: 'provided', value: { type: 'multiline', lines: [...store.address] } }, 'store details')
  set(d, F.currency, { status: 'provided', value: { type: 'currency', code: store.currency } }, 'store details')
  set(d, F.issueDate, { status: 'provided', value: { type: 'date', iso: today } }, 'today')
  // On what the store sells, it charges its own tax rate at list price. A supplier's tax and discount
  // on a purchase order are the supplier's, so they stay Missing until the person says.
  if (kind !== 'purchase-order') {
    set(d, F.discountApplicability, { status: 'provided', value: { type: 'choice', option: DISCOUNT_OPTIONS[0].value } }, 'store prices')
    set(d, F.taxApplicability, { status: 'provided', value: { type: 'choice', option: 'applicable' } }, 'store tax rate')
    set(d, F.taxRate, { status: 'provided', value: { type: 'percent', basisPoints: store.taxRateBp } }, 'store tax rate')
  }
  return d
}

function snapshotOf(kind: CommercialKind, store: Store, d: Draft): InvoiceSnapshot {
  const fields = blankFields(kind).map((f) => d.fields[f.id])
  const s = invoiceSnapshot({ kind, brand: store.brand, locale: store.locale, fields, items: d.items, layoutPreset: store.pageSize })
  // A discount rate is not applicable when the store says there is no discount.
  const rate = s.fields[F.discountRate]
  const none = s.fields[F.discountApplicability]?.state
  const withNa = rate && rate.state.status === 'missing' && none?.status === 'provided' && none.value.type === 'choice' && none.value.option === 'none'
    ? { ...s.fields, [F.discountRate]: { ...rate, state: { status: 'not-applicable', rule: 'discount-when-none' } as FieldState } }
    : s.fields
  return { ...s, fields: withNa, provenance: d.provenance }
}

function gateErrors(errors: { path: string; message: string }[]): string[] {
  return errors.map((e) => `${e.path}: ${e.message}`)
}

// ── Make, change ─────────────────────────────────────────────────────────────

export function makeStrictDocument(input: StrictDocumentInput & { type: CommercialKind }, ctx: StrictContext): StrictResult {
  const { store } = ctx
  const kind = input.type
  const d = startDraft(kind, store, ctx.today)
  const nextId = (p: string) => ctx.env.nextId(p)
  if (input.fromOrder) fillFromOrder(d, kind, store, input.fromOrder, nextId)
  addProductLines(d, kind, store, input.products, ctx, nextId)
  if (d.errors.length > 0) return { ok: false, errors: d.errors }
  const base = snapshotOf(kind, store, d)
  const gated = gateOperations(base, input.operations ?? [], { env: ctx.env, caller: 'model', sourceText: ctx.sourceText, revising: false })
  if (!gated.ok) return { ok: false, errors: gateErrors(gated.errors) }
  const created = createDocument(ctx.revisions, ctx.env, gated.snapshot, { author: GENERATOR_AUTHOR })
  return { ok: true, revisions: created.store, outputId: created.outputId, revisionId: created.revision.revisionId, version: 1, changeSummary: created.revision.changeSummary, changed: Object.keys(gated.snapshot.provenance ?? {}) }
}

export function updateStrictDocument(input: UpdateDocumentInput, outputId: string, ctx: StrictContext): StrictResult {
  const current = currentRevision(ctx.revisions, outputId)
  const before = current.snapshot as InvoiceSnapshot
  const d: Draft = { fields: { ...before.fields }, items: [...(before.blocks.find((b) => b.id === INVOICE_BLOCKS.lines && b.type === 'line-items') as { items: InvoiceLineItem[] } | undefined)?.items ?? []], provenance: { ...(before.provenance ?? {}) }, errors: [] }
  const added = addProductLines(d, before.kind, ctx.store, input.products, ctx, (p) => ctx.env.nextId(p))
  if (d.errors.length > 0) return { ok: false, errors: d.errors }
  const withLines: InvoiceSnapshot = {
    ...before,
    blocks: before.blocks.map((b) => (b.id === INVOICE_BLOCKS.lines && b.type === 'line-items' ? { ...b, items: d.items } : b)),
    provenance: d.provenance,
  }
  let next = withLines
  let targets = added
  if ((input.operations ?? []).length > 0) {
    // Digests are checked against the version the model read; new lines have none yet.
    const gated = gateOperations(withLines, input.operations, { env: ctx.env, caller: 'model', sourceText: ctx.sourceText, revising: true })
    if (!gated.ok) return { ok: false, errors: gateErrors(gated.errors) }
    next = gated.snapshot
    targets = [...new Set([...added, ...gated.targets])]
  } else {
    const errors = validateSnapshot(next).issues.filter((i) => i.severity === 'error')
    if (errors.length > 0) return { ok: false, errors: errors.map((e) => e.message) }
  }
  if (targets.length === 0 || digest({ ...next, provenance: undefined }) === digest({ ...before, provenance: undefined })) {
    return { ok: false, errors: ['These changes leave the document exactly as it was, so no new version was made.'] }
  }
  try {
    const changeSummary = describeChanges(next, before, targets)
    const saved = saveGenerated(ctx.revisions, ctx.env, outputId, current.revisionId, next, { changeSummary, operation: { type: 'generate', caller: 'model', targets }, author: GENERATOR_AUTHOR })
    return { ok: true, revisions: saved.store, outputId, revisionId: saved.revision.revisionId, version: versionNumber(saved.store, saved.revision.revisionId), changeSummary, changed: targets }
  } catch (e) {
    if (e instanceof RevisionError) return { ok: false, errors: [e.message] }
    throw e
  }
}

/** The document's title for the conversation ("Quote Q-2041"). */
export const documentTitle = (revisions: RevisionStore, outputId: string) => getDocument(revisions, outputId).title
