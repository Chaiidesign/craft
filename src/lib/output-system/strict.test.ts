import { describe, expect, it } from 'vitest'

import { composeDocument } from '../documents/compose'
import { digest } from '../documents/generation/digest'
import { computeInvoiceTotals, INVOICE_FIELDS as F } from '../documents/invoice'
import type { DocumentEnv, InvoiceSnapshot } from '../documents/model'
import { currentRevision, emptyStore, getRevision, history } from '../documents/revisions'
import { validateSnapshot } from '../documents/validation'
import { ANCHOR_DATE, sampleStore } from './fixtures/stores'
import { makeStrictDocument, updateStrictDocument, type StrictContext } from './strict'

function env(): DocumentEnv {
  let n = 0
  return { now: () => '2026-09-30T10:00:00.000Z', nextId: (p) => `${p}-${++n}` }
}

const ctx = (storeId: 'saffron-loom' | 'fernhill-goods', sourceText = '', revisions = emptyStore()): StrictContext =>
  ({ store: sampleStore(storeId), today: ANCHOR_DATE, env: env(), sourceText, revisions })

const snap = (r: ReturnType<typeof makeStrictDocument>) => {
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return getRevision(r.revisions, r.revisionId).snapshot as InvoiceSnapshot
}

const value = (s: InvoiceSnapshot, id: string) => {
  const st = s.fields[id]?.state
  return st?.status === 'provided' ? st.value : st?.status
}

describe('strict documents from store data', () => {
  it('a receipt or invoice for every order totals exactly what the order did', () => {
    for (const id of ['saffron-loom', 'fernhill-goods'] as const) {
      const store = sampleStore(id)
      for (const order of store.orders.filter((o) => o.status !== 'cancelled')) {
        for (const type of ['receipt', 'invoice'] as const) {
          const s = snap(makeStrictDocument({ type, fromOrder: order.number }, ctx(id)))
          const t = computeInvoiceTotals(s)
          expect(t.subtotal).toEqual({ known: true, money: { amountMinor: order.subtotalMinor, currency: store.currency } })
          expect(t.total).toEqual({ known: true, money: { amountMinor: order.totalMinor, currency: store.currency } })
        }
      }
    }
  })

  it('a receipt from an order is complete; it carries the customer, the order and the date paid', () => {
    const store = sampleStore('fernhill-goods')
    const order = store.orders.find((o) => o.status === 'fulfilled' && o.shippingMinor > 0 && o.discountMinor > 0)!
    const s = snap(makeStrictDocument({ type: 'receipt', fromOrder: order.number }, ctx('fernhill-goods')))
    expect(value(s, F.buyerName)).toEqual({ type: 'text', text: store.customers.find((c) => c.id === order.customerId)!.name })
    expect(value(s, F.orderNumber)).toEqual({ type: 'text', text: order.number })
    expect(value(s, F.issueDate)).toEqual({ type: 'date', iso: order.date })
    expect(s.provenance?.[`field:${F.buyerName}`]).toEqual({ source: 'store', ref: `order ${order.number}` })
    // Only the receipt number is missing: nothing is invented to fill it.
    expect(validateSnapshot(s).issues.filter((i) => i.severity !== 'warning').map((i) => i.id)).toEqual([`field:${F.number}:missing`])
    const plan = composeDocument(s)
    const totals = plan.nodes.find((n) => n.primitive === 'totals')
    expect(totals && totals.primitive === 'totals' && totals.rows.map((r) => r.label)).toEqual(['Subtotal', 'Discount (10%)', 'Taxable amount', 'Tax (0%)', 'Shipping'])
    expect(totals && totals.primitive === 'totals' && totals.grand.label).toBe('Total paid')
    expect(plan.nodes.some((n) => n.primitive === 'key-value-group' && n.id === 'payment')).toBe(false)
  })

  it('accepts an order number however it is typed', () => {
    const order = sampleStore('saffron-loom').orders[41]
    for (const typed of [order.number, order.number.toLowerCase().replace('-', ''), String(Number(order.number.replace(/\D/g, '')))]) {
      expect(makeStrictDocument({ type: 'receipt', fromOrder: typed }, ctx('saffron-loom')).ok).toBe(true)
    }
  })

  it('refuses an order that does not exist, or was cancelled', () => {
    const r = makeStrictDocument({ type: 'receipt', fromOrder: 'FH-99999' }, ctx('fernhill-goods'))
    expect(r.ok).toBe(false)
    const cancelled = sampleStore('fernhill-goods').orders.find((o) => o.status === 'cancelled')!
    const c = makeStrictDocument({ type: 'invoice', fromOrder: cancelled.number }, ctx('fernhill-goods'))
    expect(!c.ok && c.errors[0]).toMatch(/was cancelled/)
  })

  it('a quote prices catalogue products at the store price, with the store’s tax; valid-until and number stay missing', () => {
    const store = sampleStore('saffron-loom')
    const [a, b] = store.products
    const s = snap(makeStrictDocument({ type: 'quote', products: [{ sku: a.sku, quantity: 3 }, { sku: b.sku.toLowerCase(), quantity: 1 }] }, ctx('saffron-loom')))
    const t = computeInvoiceTotals(s)
    const sub = a.priceMinor * 3 + b.priceMinor
    expect(t.subtotal).toEqual({ known: true, money: { amountMinor: sub, currency: 'INR' } })
    expect(t.tax).toEqual({ known: true, money: { amountMinor: Math.floor((sub * 500 + 5000) / 10000), currency: 'INR' } })
    expect(value(s, F.issuerName)).toEqual({ type: 'text', text: store.brand.issuerDisplayName })
    expect(value(s, F.dueDate)).toBe('missing')
    expect(value(s, F.number)).toBe('missing')
    expect(s.layoutPreset).toBe('a4-portrait')
    expect(composeDocument(s).nodes.find((n) => n.primitive === 'title-block')).toMatchObject({ title: { text: 'Quote' }, reference: { label: 'Quote number' } })
  })

  it('a purchase order never uses the selling price; a stated cost must be in the person’s words', () => {
    const p = sampleStore('fernhill-goods').products[5]
    const noCost = snap(makeStrictDocument({ type: 'purchase-order', products: [{ sku: p.sku, quantity: 40 }] }, ctx('fernhill-goods')))
    const lines = noCost.blocks.find((b) => b.type === 'line-items')
    expect(lines?.type === 'line-items' && lines.items[0].unitPrice).toBeNull()
    expect(value(noCost, F.taxApplicability)).toBe('missing')

    const said = 'Order 40 travel mugs from Ridgeway at $7.40 each'
    const withCost = snap(makeStrictDocument({ type: 'purchase-order', products: [{ sku: p.sku, quantity: 40, unitCost: { amount: '7.40', evidence: 'at $7.40 each' } }] }, ctx('fernhill-goods', said)))
    const l2 = withCost.blocks.find((b) => b.type === 'line-items')
    expect(l2?.type === 'line-items' && l2.items[0].unitPrice).toEqual({ amountMinor: 740, currency: 'USD' })

    const invented = makeStrictDocument({ type: 'purchase-order', products: [{ sku: p.sku, quantity: 40, unitCost: { amount: '6.00', evidence: 'at $6.00 each' } }] }, ctx('fernhill-goods', said))
    expect(invented.ok).toBe(false)
  })

  it('a value the person stated must quote them; the gate refuses one they did not say', () => {
    const order = sampleStore('fernhill-goods').orders.find((o) => o.status === 'fulfilled')!
    const said = `Receipt for ${order.number}, number it R-2041`
    const ok = makeStrictDocument({ type: 'receipt', fromOrder: order.number, operations: [{ op: 'setField', fieldId: F.number, value: { type: 'text', text: 'R-2041' }, provenance: { source: 'prompt', evidence: 'number it R-2041' } }] }, ctx('fernhill-goods', said))
    expect(ok.ok && validateSnapshot(snap(ok)).readiness).toBe('ready')
    const bad = makeStrictDocument({ type: 'receipt', fromOrder: order.number, operations: [{ op: 'setField', fieldId: F.number, value: { type: 'text', text: 'R-9' }, provenance: { source: 'prompt', evidence: 'number it R-9' } }] }, ctx('fernhill-goods', said))
    expect(bad.ok).toBe(false)
  })

  it('a follow-up changes only what was asked, makes a new version, and keeps the old one', () => {
    const store = sampleStore('saffron-loom')
    const said1 = 'Quote Ananya Rao 2 of the first product'
    const firstCtx = ctx('saffron-loom', said1)
    const first = makeStrictDocument({ type: 'quote', products: [{ sku: store.products[0].sku, quantity: 2 }], operations: [{ op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Ananya Rao' }, provenance: { source: 'prompt', evidence: 'Quote Ananya Rao' } }] }, firstCtx)
    if (!first.ok) throw new Error(first.errors.join())
    const v1 = getRevision(first.revisions, first.revisionId).snapshot as InvoiceSnapshot
    const said2 = `${said1}\nMake it valid until 31 October 2026`
    const c = { ...ctx('saffron-loom', said2, first.revisions), env: firstCtx.env }
    const second = updateStrictDocument({ operations: [{ op: 'setField', fieldId: F.dueDate, value: { type: 'date', iso: '2026-10-31' }, provenance: { source: 'prompt', evidence: 'valid until 31 October 2026' }, expectedDigest: digest(v1.fields[F.dueDate].state) }] }, first.outputId, c)
    if (!second.ok) throw new Error(second.errors.join())
    expect(second.version).toBe(2)
    expect(second.changed).toEqual([`field:${F.dueDate}`])
    const v2 = currentRevision(second.revisions, first.outputId).snapshot as InvoiceSnapshot
    for (const id of Object.keys(v1.fields)) if (id !== F.dueDate) expect(v2.fields[id]).toEqual(v1.fields[id])
    expect(v2.blocks).toEqual(v1.blocks)
    expect(history(second.revisions, first.outputId)).toHaveLength(2)
    expect(getRevision(second.revisions, first.revisionId).snapshot).toEqual(v1)

    // A stale digest is refused: nothing new is saved.
    const stale = updateStrictDocument({ operations: [{ op: 'setField', fieldId: F.dueDate, value: { type: 'date', iso: '2026-11-30' }, provenance: { source: 'prompt', evidence: 'valid until 31 October 2026' }, expectedDigest: digest(v1.fields[F.dueDate].state) }] }, first.outputId, { ...c, revisions: second.revisions })
    expect(stale.ok).toBe(false)
  })

  it('adding products in a follow-up adds lines and nothing else', () => {
    const store = sampleStore('fernhill-goods')
    const c = ctx('fernhill-goods')
    const first = makeStrictDocument({ type: 'quote', products: [{ sku: store.products[0].sku, quantity: 1 }] }, c)
    if (!first.ok) throw new Error(first.errors.join())
    const next = updateStrictDocument({ products: [{ sku: store.products[1].sku, quantity: 2 }] }, first.outputId, { ...c, revisions: first.revisions })
    if (!next.ok) throw new Error(next.errors.join())
    expect(next.changeSummary).toBe('Added line 2')
  })
})
