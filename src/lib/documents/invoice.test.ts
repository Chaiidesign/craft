import { describe, expect, it } from 'vitest'

import {
  completeInvoice,
  FIXTURE_1_EXPECTED,
  FIXTURE_2_EXPECTED,
  incompleteInvoice,
  longInvoice,
  TALL_ROW_ID,
} from '@/lib/documents/fixtures/invoices'
import { computeInvoiceTotals, INVOICE_FIELDS } from '@/lib/documents/invoice'
import type { InvoiceLineItem, InvoiceSnapshot } from '@/lib/documents/model'

function withField(snapshot: InvoiceSnapshot, fieldId: string, state: InvoiceSnapshot['fields'][string]['state']): InvoiceSnapshot {
  return { ...snapshot, fields: { ...snapshot.fields, [fieldId]: { ...snapshot.fields[fieldId], state } } }
}

describe('fixture 1: complete invoice arithmetic', () => {
  const totals = computeInvoiceTotals(completeInvoice())

  it('matches the hand-worked expected integer amounts exactly', () => {
    expect(totals.lines.map((l) => (l.amount.known ? l.amount.money.amountMinor : null))).toEqual(FIXTURE_1_EXPECTED.lines)
    const known = (a: typeof totals.total) => (a.known ? a.money.amountMinor : null)
    expect(known(totals.subtotal)).toBe(FIXTURE_1_EXPECTED.subtotal)
    expect(known(totals.discount)).toBe(FIXTURE_1_EXPECTED.discount)
    expect(known(totals.taxableBase)).toBe(FIXTURE_1_EXPECTED.taxableBase)
    expect(known(totals.tax)).toBe(FIXTURE_1_EXPECTED.tax)
    expect(known(totals.total)).toBe(FIXTURE_1_EXPECTED.total)
    expect(totals.currency).toBe('USD')
    expect(totals.complete).toBe(true)
  })

  it('uses the configured rounding mode', () => {
    // 694,210 × 8.25% = 57,272.325 — not a tie, so both modes agree here…
    const evenTotals = computeInvoiceTotals(completeInvoice(), { rounding: 'half-even' })
    expect(evenTotals.tax.known && evenTotals.tax.money.amountMinor).toBe(57_272)
    // …while a tie (0.5 × 5¢ = 2.5¢) is decided by the mode.
    const tie = withLineItems(completeInvoice(), [{ id: 'tie', description: 'Tie', quantityMilli: 500, unitPrice: { amountMinor: 5, currency: 'USD' } }])
    expect(computeInvoiceTotals(tie, { rounding: 'half-up' }).subtotal).toEqual({ known: true, money: { amountMinor: 3, currency: 'USD' } })
    expect(computeInvoiceTotals(tie, { rounding: 'half-even' }).subtotal).toEqual({ known: true, money: { amountMinor: 2, currency: 'USD' } })
  })
})

function withLineItems(snapshot: InvoiceSnapshot, items: InvoiceLineItem[]): InvoiceSnapshot {
  return { ...snapshot, blocks: snapshot.blocks.map((b) => (b.type === 'line-items' ? { ...b, items } : b)) }
}

describe('fixture 2: unknown facts stay unknown', () => {
  const totals = computeInvoiceTotals(incompleteInvoice())

  it('knows the subtotal but not the tax or total', () => {
    expect(totals.subtotal).toEqual({ known: true, money: { amountMinor: FIXTURE_2_EXPECTED.subtotal, currency: 'EUR' } })
    expect(totals.tax.known).toBe(false)
    expect(totals.total.known).toBe(false)
    expect(totals.complete).toBe(false)
  })

  it('never treats unknown tax as zero, and says why', () => {
    expect(totals.tax).not.toEqual({ known: true, money: { amountMinor: 0, currency: 'EUR' } })
    if (totals.total.known) throw new Error('total should be unknown')
    expect(totals.total.reasons).toEqual([
      { fieldId: INVOICE_FIELDS.taxApplicability, message: 'Tax applicability not supplied — tax is unknown, not zero.' },
    ])
  })

  it('treats a stated exemption as a real zero', () => {
    const exempt = withField(
      withField(incompleteInvoice(), INVOICE_FIELDS.taxApplicability, { status: 'provided', value: { type: 'choice', option: 'exempt' } }),
      INVOICE_FIELDS.taxRate, { status: 'not-applicable', rule: 'tax-rate-when-exempt' },
    )
    const result = computeInvoiceTotals(exempt)
    expect(result.tax).toEqual({ known: true, money: { amountMinor: 0, currency: 'EUR' } })
    expect(result.total).toEqual({ known: true, money: { amountMinor: FIXTURE_2_EXPECTED.subtotal, currency: 'EUR' } })
  })

  it('makes the subtotal unknown when a line has no price, naming the line', () => {
    const base = completeInvoice()
    const noPrice = withLineItems(base, [
      { id: 'li-a', description: 'Priced item', quantityMilli: 1_000, unitPrice: { amountMinor: 1_000, currency: 'USD' } },
      { id: 'li-b', description: 'Unpriced item', quantityMilli: 1_000, unitPrice: null },
    ])
    const result = computeInvoiceTotals(noPrice)
    expect(result.subtotal).toEqual({ known: false, reasons: [{ lineItemId: 'li-b', message: 'Unit price missing for “Unpriced item”.' }] })
    expect(result.total.known).toBe(false)
  })

  it('states nothing when the currency is missing', () => {
    const noCurrency = withField(completeInvoice(), INVOICE_FIELDS.currency, { status: 'missing' })
    const result = computeInvoiceTotals(noCurrency)
    expect(result.currency).toBeNull()
    expect(result.lines.every((l) => !l.amount.known)).toBe(true)
    expect(result.total.known).toBe(false)
  })
})

describe('fixture 3: long invoice', () => {
  const snapshot = longInvoice()
  const items = snapshot.blocks.flatMap((b) => (b.type === 'line-items' ? b.items : []))

  it('has 40+ rows including the tall row', () => {
    expect(items.length).toBeGreaterThanOrEqual(40)
    const tall = items.find((i) => i.id === TALL_ROW_ID)
    expect(tall?.description.length).toBeGreaterThan(500)
  })

  it('totals agree with an independent per-line reference sum', () => {
    // Reference: exact rational per line, rounded half-up once per line.
    const reference = items.reduce((sum, li) => sum + Math.floor((li.quantityMilli * li.unitPrice!.amountMinor + 500) / 1000), 0)
    const totals = computeInvoiceTotals(snapshot)
    expect(totals.subtotal).toEqual({ known: true, money: { amountMinor: reference, currency: 'INR' } })
    // GST 18%, no discount.
    const tax = Math.floor((reference * 1_800 + 5_000) / 10_000)
    expect(totals.tax).toEqual({ known: true, money: { amountMinor: tax, currency: 'INR' } })
    expect(totals.total).toEqual({ known: true, money: { amountMinor: reference + tax, currency: 'INR' } })
  })
})

describe('derived values', () => {
  it('update when a source value changes, and only the dependent amounts move', () => {
    const before = computeInvoiceTotals(completeInvoice())
    const edited = withField(completeInvoice(), INVOICE_FIELDS.taxRate, { status: 'provided', value: { type: 'percent', basisPoints: 1_000 } })
    const after = computeInvoiceTotals(edited)
    expect(after.subtotal).toEqual(before.subtotal)
    expect(after.discount).toEqual(before.discount)
    expect(after.taxableBase).toEqual(before.taxableBase)
    expect(after.tax).toEqual({ known: true, money: { amountMinor: 69_421, currency: 'USD' } })
    expect(after.total).toEqual({ known: true, money: { amountMinor: 694_210 + 69_421, currency: 'USD' } })
  })
})
