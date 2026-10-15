import { describe, expect, it } from 'vitest'

import { fixedEnv } from '@/lib/documents/fixtures/builders'
import { INVOICE_FIELDS as F } from '@/lib/documents/invoice'

import { draftFromPartial } from './draft'
import { blankInvoice } from './tools'

const ctx = () => ({ env: fixedEnv(), caller: 'model' as const, sourceText: 'invoice for Acme, $2,400', revising: false })

describe('draftFromPartial', () => {
  it('shows the complete operations of a half-streamed proposal and skips the rest', () => {
    const partial = {
      intent: { docType: 'invoice' },
      operations: [
        { op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Acme' }, provenance: { source: 'prompt', evidence: 'Acme' } },
        { op: 'setField', fieldId: F.currency, value: { type: 'currency', code: 'USD' }, provenance: { source: 'prompt', evidence: '$2,400' } },
        { op: 'addLineItem', description: null, quantity: '1', unitPrice: { amount: '24' } },
      ],
    }
    const draft = draftFromPartial(blankInvoice(), partial, ctx())
    expect(draft.applied).toBe(2)
    expect(draft.snapshot.fields[F.buyerName].state.status).toBe('provided')
    expect(draft.snapshot.blocks.find((b) => b.type === 'line-items')).toMatchObject({ items: [] })
  })

  it('never shows a value the gate would refuse', () => {
    const partial = { operations: [{ op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Globex' }, provenance: { source: 'prompt', evidence: 'Globex' } }] }
    expect(draftFromPartial(blankInvoice(), partial, ctx()).applied).toBe(0)
  })

  it('returns the base unchanged for anything that is not yet a proposal', () => {
    const base = blankInvoice()
    for (const partial of [null, {}, { operations: 'x' }]) expect(draftFromPartial(base, partial, ctx())).toEqual({ snapshot: base, applied: 0 })
  })
})
