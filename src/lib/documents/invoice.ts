// Invoice template schema and derived totals.
//
// Totals are never stored: they are recomputed from the line items and the
// tax/discount fields of one snapshot, so a changed source value always
// updates them and nothing else. An amount that depends on an unresolved fact
// is reported as unknown with the reasons — unknown tax is not zero, and an
// incomplete total is never presented as final.

import { DOCUMENT_DEFAULTS, type RoundingMode } from './defaults'
import type { Block, CurrencyCode, FieldId, InvoiceLineItem, InvoiceSnapshot, Money } from './model'
import { lineAmount, money, percentOf, sumMoney } from './money'

/** Stable field IDs for the `invoice@1` template. */
export const INVOICE_FIELDS = {
  issuerName: 'issuer.name',
  issuerAddress: 'issuer.address',
  buyerName: 'buyer.name',
  buyerAddress: 'buyer.address',
  number: 'invoice.number',
  issueDate: 'invoice.issueDate',
  dueDate: 'invoice.dueDate',
  poNumber: 'invoice.poNumber',
  currency: 'invoice.currency',
  discountApplicability: 'discount.applicability',
  discountRate: 'discount.rate',
  taxApplicability: 'tax.applicability',
  taxRate: 'tax.rate',
  paymentTerms: 'payment.terms',
} as const satisfies Record<string, FieldId>

export const TAX_OPTIONS = [
  { value: 'applicable', label: 'Tax applies' },
  { value: 'exempt', label: 'Exempt — no tax charged' },
] as const

export const DISCOUNT_OPTIONS = [
  { value: 'none', label: 'No discount' },
  { value: 'percent', label: 'Percentage discount' },
] as const

export interface UnknownReason {
  fieldId?: FieldId
  lineItemId?: string
  message: string
}

export type Amount =
  | { known: true; money: Money }
  | { known: false; reasons: readonly UnknownReason[] }

export interface InvoiceTotals {
  currency: CurrencyCode | null
  lines: readonly { itemId: string; amount: Amount }[]
  subtotal: Amount
  discount: Amount
  taxableBase: Amount
  tax: Amount
  total: Amount
  /** True only when every amount, including tax, is known. */
  complete: boolean
}

function unknown(...reasons: UnknownReason[]): Amount {
  return { known: false, reasons }
}

function reasonsOf(...amounts: Amount[]): UnknownReason[] {
  const out: UnknownReason[] = []
  for (const a of amounts) if (!a.known) out.push(...a.reasons)
  // One reason per field / line item, in first-seen order.
  return out.filter((r, i) => out.findIndex((o) => o.fieldId === r.fieldId && o.lineItemId === r.lineItemId && o.message === r.message) === i)
}

function providedValue(snapshot: InvoiceSnapshot, fieldId: FieldId) {
  const field = snapshot.fields[fieldId]
  return field?.state.status === 'provided' ? field.state.value : undefined
}

export function invoiceCurrency(snapshot: InvoiceSnapshot): CurrencyCode | null {
  const value = providedValue(snapshot, INVOICE_FIELDS.currency)
  return value?.type === 'currency' ? value.code : null
}

export function lineItemsBlock(snapshot: InvoiceSnapshot, blockId?: string): Extract<Block, { type: 'line-items' }> | undefined {
  for (const block of snapshot.blocks) {
    if (block.type === 'line-items' && (blockId === undefined || block.id === blockId)) return block
  }
  return undefined
}

export function computeInvoiceTotals(
  snapshot: InvoiceSnapshot,
  options: { rounding?: RoundingMode; lineItemsBlockId?: string } = {},
): InvoiceTotals {
  const rounding = options.rounding ?? DOCUMENT_DEFAULTS.rounding
  const currency = invoiceCurrency(snapshot)
  const items: readonly InvoiceLineItem[] = lineItemsBlock(snapshot, options.lineItemsBlockId)?.items ?? []

  if (!currency) {
    const reason = { fieldId: INVOICE_FIELDS.currency, message: 'Currency not supplied, so no amount can be stated.' }
    const all = unknown(reason)
    return {
      currency: null,
      lines: items.map((item) => ({ itemId: item.id, amount: all })),
      subtotal: all, discount: all, taxableBase: all, tax: all, total: all,
      complete: false,
    }
  }

  const lines = items.map((item, index): { itemId: string; amount: Amount } => {
    if (!item.unitPrice) {
      return { itemId: item.id, amount: unknown({ lineItemId: item.id, message: `Unit price missing for ${item.description !== null ? `“${item.description}”` : `line ${index + 1}`}.` }) }
    }
    if (item.unitPrice.currency !== currency) {
      return { itemId: item.id, amount: unknown({ lineItemId: item.id, message: `Line priced in ${item.unitPrice.currency}, invoice is in ${currency}.` }) }
    }
    return { itemId: item.id, amount: { known: true, money: lineAmount(item.quantityMilli, item.unitPrice, rounding) } }
  })

  const lineReasons = reasonsOf(...lines.map((l) => l.amount))
  const subtotal: Amount = lineReasons.length
    ? unknown(...lineReasons)
    : { known: true, money: sumMoney(lines.map((l) => (l.amount as { money: Money }).money), currency) }

  // Discount: a rate is only used when the issuer said a percentage discount applies.
  const discountApplicability = providedValue(snapshot, INVOICE_FIELDS.discountApplicability)
  const discountRate = providedValue(snapshot, INVOICE_FIELDS.discountRate)
  let discount: Amount
  if (discountApplicability?.type !== 'choice') {
    discount = unknown({ fieldId: INVOICE_FIELDS.discountApplicability, message: 'Discount applicability not supplied.' })
  } else if (discountApplicability.option === 'none') {
    discount = { known: true, money: money(0, currency) }
  } else if (discountRate?.type !== 'percent') {
    discount = unknown({ fieldId: INVOICE_FIELDS.discountRate, message: 'Discount rate not supplied.' })
  } else if (!subtotal.known) {
    discount = unknown(...reasonsOf(subtotal))
  } else {
    discount = { known: true, money: percentOf(subtotal.money, discountRate.basisPoints, rounding) }
  }

  const taxableBase: Amount = subtotal.known && discount.known
    ? { known: true, money: money(subtotal.money.amountMinor - discount.money.amountMinor, currency) }
    : unknown(...reasonsOf(subtotal, discount))

  // Tax: exempt is a supplied fact (zero tax); a missing applicability is not.
  const taxApplicability = providedValue(snapshot, INVOICE_FIELDS.taxApplicability)
  const taxRate = providedValue(snapshot, INVOICE_FIELDS.taxRate)
  let tax: Amount
  if (taxApplicability?.type !== 'choice') {
    tax = unknown({ fieldId: INVOICE_FIELDS.taxApplicability, message: 'Tax applicability not supplied — tax is unknown, not zero.' })
  } else if (taxApplicability.option === 'exempt') {
    tax = { known: true, money: money(0, currency) }
  } else if (taxRate?.type !== 'percent') {
    tax = unknown({ fieldId: INVOICE_FIELDS.taxRate, message: 'Tax rate not supplied.' })
  } else if (!taxableBase.known) {
    tax = unknown(...reasonsOf(taxableBase))
  } else {
    tax = { known: true, money: percentOf(taxableBase.money, taxRate.basisPoints, rounding) }
  }

  const total: Amount = taxableBase.known && tax.known
    ? { known: true, money: money(taxableBase.money.amountMinor + tax.money.amountMinor, currency) }
    : unknown(...reasonsOf(taxableBase, tax))

  return { currency, lines, subtotal, discount, taxableBase, tax, total, complete: total.known }
}
