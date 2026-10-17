// The invoice@1 skeleton and the kinds built the same way (quote@1,
// purchase-order@1, receipt@1): the fixed block set every one uses, whether it
// comes from a fixture or from generation. Moved out of the fixtures so the
// generation pipeline builds invoices exactly the way the samples do.
//
// The four kinds share one structure — parties, details, line items, totals,
// terms — and one composer. What differs is set per kind in COMMERCIAL_TEMPLATES:
// the title, the field labels, which fields are required, which appear in each
// block, and what the grand total is called. The invoice's own settings are the
// ones invoice@1 always had, so its output is unchanged.

import { DISCOUNT_OPTIONS, INVOICE_FIELDS as F, TAX_OPTIONS } from '../invoice'
import type { Block, BrandProfile, CommercialKind, Field, FieldId, InvoiceLineItem, InvoiceSnapshot, LayoutPreset, TextRun } from '../model'

/** Stable block IDs of invoice@1 (shared by every commercial kind). Generation never renames them. */
export const INVOICE_BLOCKS = {
  parties: 'blk-parties',
  details: 'blk-details',
  lines: 'blk-lines',
  adjustments: 'blk-adjustments',
  totals: 'blk-totals',
  payment: 'blk-payment',
  internalNote: 'blk-internal-note',
} as const

type FieldSpec = readonly [id: FieldId, label: string, valueType: Field['valueType'], required: boolean]

export interface CommercialTemplate {
  kind: CommercialKind
  templateId: InvoiceSnapshot['templateId']
  /** The document's name, used as its title ("Quote"). */
  title: string
  detailsTitle: string
  /** Footer text when the document number is missing. */
  numberMissing: string
  /** The grand-total label when the total is known. */
  grandTotal: string
  /** Title of the terms block, or `null` when the kind has none (a receipt). */
  termsTitle: string | null
  parties: readonly FieldId[]
  /** Dates shown in the title block. */
  meta: readonly FieldId[]
  details: readonly FieldId[]
  terms: readonly FieldId[]
  /** Every field the kind has, in order, with nothing supplied. */
  fields: readonly FieldSpec[]
}

const ADJUSTMENTS: readonly FieldSpec[] = [
  [F.discountApplicability, 'Discount', 'choice', true],
  [F.discountRate, 'Discount rate', 'percent', true],
  [F.taxApplicability, 'Tax', 'choice', true],
  [F.taxRate, 'Tax rate', 'percent', true],
]

const ISSUER: readonly FieldSpec[] = [
  [F.issuerName, 'Issuer', 'text', true],
  [F.issuerAddress, 'Issuer address', 'multiline', true],
]

export const COMMERCIAL_TEMPLATES: Readonly<Record<CommercialKind, CommercialTemplate>> = {
  invoice: {
    kind: 'invoice',
    templateId: 'invoice@1',
    title: 'Invoice',
    detailsTitle: 'Invoice details',
    numberMissing: 'Invoice (number missing)',
    grandTotal: 'Total due',
    termsTitle: 'Payment',
    parties: [F.issuerName, F.issuerAddress, F.buyerName, F.buyerAddress],
    meta: [F.issueDate, F.dueDate],
    details: [F.poNumber, F.orderNumber, F.currency],
    terms: [F.paymentTerms],
    fields: [
      ...ISSUER,
      [F.buyerName, 'Bill to', 'text', true],
      [F.buyerAddress, 'Billing address', 'multiline', true],
      [F.number, 'Invoice number', 'text', true],
      [F.issueDate, 'Invoice date', 'date', true],
      [F.dueDate, 'Due date', 'date', true],
      [F.poNumber, 'Purchase order', 'text', false],
      [F.currency, 'Currency', 'currency', true],
      ...ADJUSTMENTS,
      [F.paymentTerms, 'Payment terms', 'text', true],
      [F.shipping, 'Shipping', 'money', false],
      [F.orderNumber, 'Order', 'text', false],
    ],
  },
  quote: {
    kind: 'quote',
    templateId: 'quote@1',
    title: 'Quote',
    detailsTitle: 'Quote details',
    numberMissing: 'Quote (number missing)',
    grandTotal: 'Total',
    termsTitle: 'Terms',
    parties: [F.issuerName, F.issuerAddress, F.buyerName, F.buyerAddress],
    meta: [F.issueDate, F.dueDate],
    details: [F.currency],
    terms: [F.paymentTerms],
    fields: [
      ...ISSUER,
      [F.buyerName, 'Quote for', 'text', true],
      [F.buyerAddress, 'Address', 'multiline', false],
      [F.number, 'Quote number', 'text', true],
      [F.issueDate, 'Quote date', 'date', true],
      [F.dueDate, 'Valid until', 'date', true],
      [F.currency, 'Currency', 'currency', true],
      ...ADJUSTMENTS,
      [F.paymentTerms, 'Terms', 'text', false],
      [F.shipping, 'Shipping', 'money', false],
    ],
  },
  'purchase-order': {
    kind: 'purchase-order',
    templateId: 'purchase-order@1',
    title: 'Purchase order',
    detailsTitle: 'Order details',
    numberMissing: 'Purchase order (number missing)',
    grandTotal: 'Order total',
    termsTitle: 'Payment',
    parties: [F.issuerName, F.issuerAddress, F.buyerName, F.buyerAddress],
    meta: [F.issueDate, F.dueDate],
    details: [F.currency],
    terms: [F.paymentTerms],
    fields: [
      ...ISSUER,
      [F.buyerName, 'Supplier', 'text', true],
      [F.buyerAddress, 'Supplier address', 'multiline', true],
      [F.number, 'PO number', 'text', true],
      [F.issueDate, 'Order date', 'date', true],
      [F.dueDate, 'Deliver by', 'date', false],
      [F.currency, 'Currency', 'currency', true],
      ...ADJUSTMENTS,
      [F.paymentTerms, 'Payment terms', 'text', false],
      [F.shipping, 'Shipping', 'money', false],
    ],
  },
  receipt: {
    kind: 'receipt',
    templateId: 'receipt@1',
    title: 'Receipt',
    detailsTitle: 'Payment details',
    numberMissing: 'Receipt (number missing)',
    grandTotal: 'Total paid',
    termsTitle: null,
    parties: [F.issuerName, F.issuerAddress, F.buyerName, F.buyerAddress],
    meta: [F.issueDate],
    details: [F.orderNumber, F.paymentMethod, F.currency],
    terms: [],
    fields: [
      ...ISSUER,
      [F.buyerName, 'Received from', 'text', true],
      [F.buyerAddress, 'Address', 'multiline', false],
      [F.number, 'Receipt number', 'text', true],
      [F.issueDate, 'Date paid', 'date', true],
      [F.orderNumber, 'Order', 'text', false],
      [F.paymentMethod, 'Paid by', 'text', false],
      [F.currency, 'Currency', 'currency', true],
      ...ADJUSTMENTS,
      [F.shipping, 'Shipping', 'money', false],
    ],
  },
}

export const templateFor = (kind: CommercialKind): CommercialTemplate => COMMERCIAL_TEMPLATES[kind]

export function invoiceSnapshot(input: {
  /** Defaults to `invoice`. */
  kind?: CommercialKind
  brand: BrandProfile
  locale: string
  fields: Field[]
  items: InvoiceLineItem[]
  internalNote?: string
  layoutPreset?: LayoutPreset
}): InvoiceSnapshot {
  const B = INVOICE_BLOCKS
  const t = templateFor(input.kind ?? 'invoice')
  // A block lists only the fields this document has: invoice fixtures made before shipping and
  // the order reference existed keep exactly the blocks they always had.
  const has = new Set(input.fields.map((f) => f.id))
  const only = (ids: readonly FieldId[]) => ids.filter((id) => has.has(id))
  const blocks: Block[] = [
    { id: B.parties, type: 'field-group', title: 'Parties', fieldIds: [...t.parties] },
    { id: B.details, type: 'field-group', title: t.detailsTitle, fieldIds: [F.number, ...t.meta, ...only(t.details)] },
    { id: B.lines, type: 'line-items', items: input.items },
    { id: B.adjustments, type: 'field-group', title: 'Discount and tax', fieldIds: [F.discountApplicability, F.discountRate, F.taxApplicability, F.taxRate] },
    { id: B.totals, type: 'totals', lineItemsBlockId: B.lines },
  ]
  if (t.termsTitle) blocks.push({ id: B.payment, type: 'field-group', title: t.termsTitle, fieldIds: only(t.terms) })
  if (input.internalNote) {
    const runs: TextRun[] = [{ text: input.internalNote }]
    blocks.push({ id: B.internalNote, type: 'callout', tone: 'note', audience: 'internal', runs })
  }
  const fields = Object.fromEntries(input.fields.map((f) => [f.id, f]))
  return {
    schemaVersion: 1,
    kind: t.kind,
    templateId: t.templateId,
    locale: input.locale,
    brand: input.brand,
    fields,
    fieldOrder: input.fields.map((f) => f.id),
    blocks,
    citations: [],
    layoutPreset: input.layoutPreset ?? 'a4-portrait',
  }
}

/**
 * A kind's fields with nothing supplied: the starting point for a generated document.
 * For the invoice, labels and requiredness match the fixtures; only the purchase order,
 * shipping and order reference are optional.
 */
export function blankFields(kind: CommercialKind): Field[] {
  return templateFor(kind).fields.map(([id, label, valueType, required]): Field => ({
    id, label, valueType, required, state: { status: 'missing' },
    ...(id === F.discountApplicability ? { options: DISCOUNT_OPTIONS } : id === F.taxApplicability ? { options: TAX_OPTIONS } : {}),
  }))
}

/** The invoice@1 fields with nothing supplied. */
export const blankInvoiceFields = (): Field[] => blankFields('invoice')
