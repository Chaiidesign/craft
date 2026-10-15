// Small helpers that keep fixture definitions readable. Fixture data only.

import type {
  CurrencyCode,
  DocumentEnv,
  Field,
  FieldId,
  FieldValue,
  FieldValueType,
  InvoiceLineItem,
  Money,
  NotApplicableRule,
  TextRun,
} from '../model'

export const SAMPLE_LABEL = 'Sample data — fictional'

export function provided(id: FieldId, label: string, value: FieldValue, options: { required?: boolean; choices?: Field['options'] } = {}): Field {
  return { id, label, valueType: value.type, required: options.required ?? true, state: { status: 'provided', value }, ...(options.choices ? { options: options.choices } : {}) }
}

export function missing(id: FieldId, label: string, valueType: FieldValueType, options: { required?: boolean; choices?: Field['options'] } = {}): Field {
  return { id, label, valueType, required: options.required ?? true, state: { status: 'missing' }, ...(options.choices ? { options: options.choices } : {}) }
}

export function notApplicable(id: FieldId, label: string, valueType: FieldValueType, rule: NotApplicableRule): Field {
  return { id, label, valueType, required: true, state: { status: 'not-applicable', rule } }
}

export const text = (value: string): FieldValue => ({ type: 'text', text: value })
export const lines = (...value: string[]): FieldValue => ({ type: 'multiline', lines: value })
export const date = (iso: string): FieldValue => ({ type: 'date', iso })
export const currency = (code: CurrencyCode): FieldValue => ({ type: 'currency', code })
export const percent = (basisPoints: number): FieldValue => ({ type: 'percent', basisPoints })
export const choice = (option: string): FieldValue => ({ type: 'choice', option })

export function fieldMap(fields: readonly Field[]): { fields: Record<FieldId, Field>; fieldOrder: FieldId[] } {
  return {
    fields: Object.fromEntries(fields.map((f) => [f.id, f])),
    fieldOrder: fields.map((f) => f.id),
  }
}

export const m = (amountMinor: number, code: CurrencyCode): Money => ({ amountMinor, currency: code })

export function item(id: string, description: string, quantityMilli: number, unitPrice: Money | null, unit?: string): InvoiceLineItem {
  return { id, description, quantityMilli, unitPrice, ...(unit ? { unit } : {}) }
}

export const run = (value: string, citationIds?: string[]): TextRun => (citationIds ? { text: value, citationIds } : { text: value })

/**
 * Deterministic clock + IDs for fixtures and tests. Each call to `now()`
 * advances one minute from `start`; IDs count up per prefix.
 */
export function fixedEnv(start = '2026-10-01T09:00:00.000Z'): DocumentEnv {
  let tick = 0
  const counters = new Map<string, number>()
  return {
    now: () => new Date(Date.parse(start) + tick++ * 60_000).toISOString(),
    nextId: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, n)
      return `${prefix}-${String(n).padStart(3, '0')}`
    },
  }
}
