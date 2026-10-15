// The invoice@1 skeleton: the fixed block set every invoice uses, whether it
// comes from a fixture or from generation. Moved out of the fixtures so the
// generation pipeline builds invoices exactly the way the samples do.

import { DISCOUNT_OPTIONS, INVOICE_FIELDS as F, TAX_OPTIONS } from '../invoice'
import type { Block, BrandProfile, Field, InvoiceLineItem, InvoiceSnapshot, TextRun } from '../model'

/** Stable block IDs of invoice@1. Generation never renames them. */
export const INVOICE_BLOCKS = {
  parties: 'blk-parties',
  details: 'blk-details',
  lines: 'blk-lines',
  adjustments: 'blk-adjustments',
  totals: 'blk-totals',
  payment: 'blk-payment',
  internalNote: 'blk-internal-note',
} as const

export function invoiceSnapshot(input: {
  brand: BrandProfile
  locale: string
  fields: Field[]
  items: InvoiceLineItem[]
  internalNote?: string
}): InvoiceSnapshot {
  const B = INVOICE_BLOCKS
  const blocks: Block[] = [
    { id: B.parties, type: 'field-group', title: 'Parties', fieldIds: [F.issuerName, F.issuerAddress, F.buyerName, F.buyerAddress] },
    { id: B.details, type: 'field-group', title: 'Invoice details', fieldIds: [F.number, F.issueDate, F.dueDate, F.poNumber, F.currency] },
    { id: B.lines, type: 'line-items', items: input.items },
    { id: B.adjustments, type: 'field-group', title: 'Discount and tax', fieldIds: [F.discountApplicability, F.discountRate, F.taxApplicability, F.taxRate] },
    { id: B.totals, type: 'totals', lineItemsBlockId: B.lines },
    { id: B.payment, type: 'field-group', title: 'Payment', fieldIds: [F.paymentTerms] },
  ]
  if (input.internalNote) {
    const runs: TextRun[] = [{ text: input.internalNote }]
    blocks.push({ id: B.internalNote, type: 'callout', tone: 'note', audience: 'internal', runs })
  }
  const fields = Object.fromEntries(input.fields.map((f) => [f.id, f]))
  return {
    schemaVersion: 1,
    kind: 'invoice',
    templateId: 'invoice@1',
    locale: input.locale,
    brand: input.brand,
    fields,
    fieldOrder: input.fields.map((f) => f.id),
    blocks,
    citations: [],
    layoutPreset: 'a4-portrait',
  }
}

/**
 * The invoice@1 fields with nothing supplied: the starting point for a generated invoice.
 * Labels and requiredness match the fixtures; only the purchase order is optional.
 */
export function blankInvoiceFields(): Field[] {
  const field = (id: string, label: string, valueType: Field['valueType'], extra: Partial<Field> = {}): Field =>
    ({ id, label, valueType, required: true, state: { status: 'missing' }, ...extra })
  return [
    field(F.issuerName, 'Issuer', 'text'),
    field(F.issuerAddress, 'Issuer address', 'multiline'),
    field(F.buyerName, 'Bill to', 'text'),
    field(F.buyerAddress, 'Billing address', 'multiline'),
    field(F.number, 'Invoice number', 'text'),
    field(F.issueDate, 'Invoice date', 'date'),
    field(F.dueDate, 'Due date', 'date'),
    field(F.poNumber, 'Purchase order', 'text', { required: false }),
    field(F.currency, 'Currency', 'currency'),
    field(F.discountApplicability, 'Discount', 'choice', { options: DISCOUNT_OPTIONS }),
    field(F.discountRate, 'Discount rate', 'percent'),
    field(F.taxApplicability, 'Tax', 'choice', { options: TAX_OPTIONS }),
    field(F.taxRate, 'Tax rate', 'percent'),
    field(F.paymentTerms, 'Payment terms', 'text'),
  ]
}
