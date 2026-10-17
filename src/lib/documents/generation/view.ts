// The document as a model or an agent reads it: every field and line item with
// its stable ID, its current value in the same units the operations use, and
// the digest a revise operation must quote. Plain JSON, so it can go straight
// into a model prompt or a tool result.

import { CURRENCIES } from '../defaults'
import { computeInvoiceTotals, invoiceCurrency, isCommercial } from '../invoice'
import type { DocumentSnapshot, FieldValue, Money } from '../model'
import { validateSnapshot, type Readiness } from '../validation'
import { digest } from './digest'
import type { GenerationValue } from './ops'

export interface FieldView {
  id: string
  label: string
  valueType: string
  required: boolean
  options?: string[]
  status: 'provided' | 'missing' | 'not-applicable'
  value?: GenerationValue
  digest: string
}

export interface LineItemView {
  id: string
  description: string | null
  quantity: string
  unit?: string
  unitPrice: string | null
  digest: string
}

export interface DocumentView {
  kind: DocumentSnapshot['kind']
  readiness: Readiness
  currency: string | null
  fields: FieldView[]
  lineItems: LineItemView[]
  totals: { subtotal: string | null; total: string | null; unknownBecause: string[] }
  /** What is still not supplied, in the document's own words. */
  missing: string[]
  /** Problems that block saving or exporting. Empty for anything the gate let through. */
  errors: string[]
}

/** 240000 minor units of USD → "2400.00"; 500 JPY → "500". */
export function moneyToDecimal(money: Money): string {
  const digits = CURRENCIES[money.currency].minorDigits
  if (digits === 0) return String(money.amountMinor)
  const s = String(Math.abs(money.amountMinor)).padStart(digits + 1, '0')
  return `${money.amountMinor < 0 ? '-' : ''}${s.slice(0, -digits)}.${s.slice(-digits)}`
}

/** 1500 thousandths → "1.5". */
export function milliToDecimal(milli: number): string {
  const whole = Math.trunc(milli / 1000)
  const fraction = String(milli % 1000).padStart(3, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

/** 825 basis points → "8.25". */
export function basisPointsToDecimal(bp: number): string {
  return milliToDecimal(bp * 10)
}

export function toGenerationValue(value: FieldValue): GenerationValue {
  switch (value.type) {
    case 'money': return { type: 'money', amount: moneyToDecimal(value.money), currency: value.money.currency }
    case 'percent': return { type: 'percent', percent: basisPointsToDecimal(value.basisPoints) }
    case 'multiline': return { type: 'multiline', lines: [...value.lines] }
    default: return value
  }
}

export function lineItems(snapshot: DocumentSnapshot) {
  const block = snapshot.blocks.find((b) => b.type === 'line-items')
  return block?.type === 'line-items' ? block : undefined
}

export function documentView(snapshot: DocumentSnapshot): DocumentView {
  const report = validateSnapshot(snapshot)
  const fields: FieldView[] = snapshot.fieldOrder.map((id) => {
    const f = snapshot.fields[id]
    return {
      id,
      label: f.label,
      valueType: f.valueType,
      required: f.required,
      ...(f.options ? { options: f.options.map((o) => o.value) } : {}),
      status: f.state.status,
      ...(f.state.status === 'provided' ? { value: toGenerationValue(f.state.value) } : {}),
      digest: digest(f.state),
    }
  })
  const items: LineItemView[] = (lineItems(snapshot)?.items ?? []).map((li) => ({
    id: li.id,
    description: li.description,
    quantity: milliToDecimal(li.quantityMilli),
    ...(li.unit ? { unit: li.unit } : {}),
    unitPrice: li.unitPrice ? moneyToDecimal(li.unitPrice) : null,
    digest: digest(li),
  }))
  let totals: DocumentView['totals'] = { subtotal: null, total: null, unknownBecause: [] }
  if (isCommercial(snapshot)) {
    const t = computeInvoiceTotals(snapshot)
    totals = {
      subtotal: t.subtotal.known ? moneyToDecimal(t.subtotal.money) : null,
      total: t.total.known ? moneyToDecimal(t.total.money) : null,
      unknownBecause: t.total.known ? [] : t.total.reasons.map((r) => r.message),
    }
  }
  return {
    kind: snapshot.kind,
    readiness: report.readiness,
    currency: isCommercial(snapshot) ? invoiceCurrency(snapshot) : null,
    fields,
    lineItems: items,
    totals,
    missing: report.issues.filter((i) => i.severity === 'missing').map((i) => i.message),
    errors: report.issues.filter((i) => i.severity === 'error').map((i) => i.message),
  }
}
