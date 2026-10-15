import { describe, expect, it } from 'vitest'

import { evidenceBrief } from '@/lib/documents/fixtures/brief'
import { completeInvoice, incompleteInvoice } from '@/lib/documents/fixtures/invoices'
import { INVOICE_FIELDS as F } from '@/lib/documents/invoice'
import type { DocumentSnapshot, Field, FieldState } from '@/lib/documents/model'
import { validateSnapshot } from '@/lib/documents/validation'

function setState<S extends DocumentSnapshot>(snapshot: S, fieldId: string, state: FieldState): S {
  return { ...snapshot, fields: { ...snapshot.fields, [fieldId]: { ...snapshot.fields[fieldId], state } } }
}

describe('validateSnapshot', () => {
  it('passes the complete invoice and brief', () => {
    expect(validateSnapshot(completeInvoice())).toMatchObject({ readiness: 'ready', issues: [] })
    expect(validateSnapshot(evidenceBrief())).toMatchObject({ readiness: 'ready', issues: [] })
  })

  it('reports each missing required fact beside its field and in the summary', () => {
    const report = validateSnapshot(incompleteInvoice())
    expect(report.readiness).toBe('incomplete')
    expect(report.fields[F.buyerAddress]).toMatchObject({ status: 'missing', severity: 'missing', messages: ['Billing address is required and has not been supplied.'] })
    expect(report.fields[F.dueDate].messages).toEqual(['Due date is required and has not been supplied.'])
    expect(report.fields[F.taxApplicability].messages).toEqual(['Tax is required and has not been supplied.'])

    const summary = report.issues.map((i) => i.id)
    expect(summary).toEqual(expect.arrayContaining([
      `field:${F.buyerAddress}:missing`,
      `field:${F.dueDate}:missing`,
      `field:${F.taxApplicability}:missing`,
      'totals:incomplete',
    ]))
  })

  it('does not flag an optional field that was not supplied', () => {
    const report = validateSnapshot(incompleteInvoice())
    expect(report.fields[F.poNumber]).toMatchObject({ status: 'missing', required: false, messages: [], severity: null })
  })

  it('accepts not-applicable only when its documented rule holds', () => {
    // Fixture 2: discount "none" makes the discount rate not applicable — fine.
    expect(validateSnapshot(incompleteInvoice()).fields[F.discountRate].messages).toEqual([])

    // Claiming tax rate is N/A while tax applies is an error, not a dismissal.
    const misuse = setState(completeInvoice(), F.taxRate, { status: 'not-applicable', rule: 'tax-rate-when-exempt' })
    const report = validateSnapshot(misuse)
    expect(report.readiness).toBe('invalid')
    expect(report.fields[F.taxRate].messages[0]).toMatch(/^Marked not applicable, but the condition does not hold/)
  })

  it('flags a supplied rate that contradicts "exempt"', () => {
    const contradictory = setState(completeInvoice(), F.taxApplicability, { status: 'provided', value: { type: 'choice', option: 'exempt' } })
    expect(validateSnapshot(contradictory).fields[F.taxRate].messages).toEqual(['A tax rate is supplied, but the invoice is marked tax-exempt.'])
  })

  it.each<[string, string, FieldState, string]>([
    ['an impossible date', F.dueDate, { status: 'provided', value: { type: 'date', iso: '2026-02-30' } }, '“2026-02-30” is not a valid calendar date (expected YYYY-MM-DD).'],
    ['a value of the wrong type', F.dueDate, { status: 'provided', value: { type: 'text', text: 'end of month' } }, 'Expected a date value but got text.'],
    ['a choice outside the options', F.taxApplicability, { status: 'provided', value: { type: 'choice', option: 'maybe' } }, '“maybe” is not one of the permitted options.'],
    ['an out-of-range percentage', F.taxRate, { status: 'provided', value: { type: 'percent', basisPoints: 12_000 } }, 'Percentage must be between 0% and 100%.'],
    ['an empty "provided" value', F.paymentTerms, { status: 'provided', value: { type: 'text', text: '  ' } }, 'Marked as provided but empty. Mark it missing instead.'],
  ])('gives a specific message for %s', (_, fieldId, state, message) => {
    const report = validateSnapshot(setState(completeInvoice(), fieldId, state))
    expect(report.readiness).toBe('invalid')
    expect(report.fields[fieldId].messages).toContain(message)
  })

  it('warns when the due date precedes the invoice date', () => {
    const report = validateSnapshot(setState(completeInvoice(), F.dueDate, { status: 'provided', value: { type: 'date', iso: '2026-09-01' } }))
    expect(report.readiness).toBe('ready')
    expect(report.fields[F.dueDate]).toMatchObject({ severity: 'warning', messages: ['Due date is before the invoice date.'] })
  })

  it('flags a line priced in another currency and a missing unit price', () => {
    const base = completeInvoice()
    const snapshot = {
      ...base,
      blocks: base.blocks.map((b) => (b.type === 'line-items' ? { ...b, items: [
        { id: 'li-x', description: 'Wrong currency', quantityMilli: 1_000, unitPrice: { amountMinor: 100, currency: 'EUR' as const } },
        { id: 'li-y', description: 'No price', quantityMilli: 1_000, unitPrice: null },
      ] } : b)),
    }
    const messages = validateSnapshot(snapshot).issues.filter((i) => i.target.kind === 'line-item').map((i) => i.message)
    expect(messages).toEqual(['Priced in EUR; this invoice is in USD.', 'Unit price for “No price” has not been supplied.'])
  })

  it('rejects a citation that is not in the source list rather than inventing one', () => {
    const brief = evidenceBrief()
    const snapshot = {
      ...brief,
      blocks: brief.blocks.map((b) => (b.id === 'blk-evidence-1' && b.type === 'paragraph' ? { ...b, runs: [{ text: 'Unsupported claim', citationIds: ['src-99'] }] } : b)),
    }
    const report = validateSnapshot(snapshot)
    expect(report.readiness).toBe('invalid')
    expect(report.issues.find((i) => i.id === 'block:blk-evidence-1:cite:src-99')?.message).toMatch(/not in the source list/)
  })

  it('requires chart units and a data summary', () => {
    const brief = evidenceBrief()
    const snapshot = { ...brief, blocks: brief.blocks.map((b) => (b.type === 'chart' ? { ...b, unit: '', dataSummary: '' } : b)) }
    const ids = validateSnapshot(snapshot).issues.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['block:blk-chart:unit', 'block:blk-chart:summary']))
  })

  it('never fills a missing value — validation is read-only', () => {
    const snapshot = incompleteInvoice()
    const before = JSON.stringify(snapshot)
    validateSnapshot(snapshot)
    expect(JSON.stringify(snapshot)).toBe(before)
    const fields: Field[] = Object.values(snapshot.fields)
    expect(fields.filter((f) => f.state.status === 'missing').map((f) => f.id)).toEqual([F.buyerAddress, F.dueDate, F.poNumber, F.taxApplicability, F.taxRate])
  })

  it('D-60: an unstated line description is missing (an unknown); a blank one is malformed', () => {
    const base = completeInvoice()
    const withItems = (items: { id: string; description: string | null }[]): DocumentSnapshot => ({
      ...base,
      blocks: base.blocks.map((b) => (b.type === 'line-items' ? { ...b, items: items.map((i) => ({ ...i, quantityMilli: 1_000, unitPrice: { amountMinor: 240_000, currency: 'USD' as const } })) } : b)),
    })
    const unstated = validateSnapshot(withItems([{ id: 'li-a', description: null }]))
    expect(unstated.readiness).toBe('incomplete')
    expect(unstated.issues).toContainEqual(expect.objectContaining({ id: 'line:li-a:description', severity: 'missing', message: 'Description for line 1 has not been supplied.' }))

    const blank = validateSnapshot(withItems([{ id: 'li-b', description: '   ' }]))
    expect(blank.readiness).toBe('invalid')
    expect(blank.issues).toContainEqual(expect.objectContaining({ id: 'line:li-b:description', severity: 'error' }))
  })
})
