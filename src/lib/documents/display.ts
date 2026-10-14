// Typed value → display text. Every surface (inspector, preview, PDF, DOCX,
// PPTX) formats through here, so the same value reads the same everywhere.
// Display text is never written back into the model.

import type { Field, FieldValue } from './model'
import { formatMoney, formatPercent } from './money'

export function formatDate(iso: string, locale: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function formatFieldValue(value: FieldValue, locale: string, field?: Pick<Field, 'options'>): string {
  switch (value.type) {
    case 'text': return value.text
    case 'multiline': return value.lines.join('\n')
    case 'date': return formatDate(value.iso, locale)
    case 'money': return formatMoney(value.money, locale)
    case 'currency': return value.code
    case 'percent': return formatPercent(value.basisPoints, locale)
    case 'choice': return field?.options?.find((o) => o.value === value.option)?.label ?? value.option
  }
}

/** What a field shows when it has no value. Never a zero, never a placeholder that could pass for data. */
export function describeFieldState(field: Field, locale: string): { text: string; status: Field['state']['status'] } {
  const { state } = field
  if (state.status === 'provided') return { text: formatFieldValue(state.value, locale, field), status: 'provided' }
  if (state.status === 'not-applicable') return { text: 'Not applicable', status: 'not-applicable' }
  return { text: field.required ? 'Missing — required' : 'Not supplied (optional)', status: 'missing' }
}
