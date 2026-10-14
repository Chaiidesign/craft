import { describe, expect, it } from 'vitest'

import { fixedEnv, m, text } from './fixtures/builders'
import { evidenceBrief } from './fixtures/brief'
import { completeInvoice, FIXTURE_1_EXPECTED, incompleteInvoice } from './fixtures/invoices'
import { PROPOSAL_TEMPLATES, proposalFrom, SAMPLE_REVIEWER } from './fixtures/revisions'
import { computeInvoiceTotals } from './invoice'
import type { DocumentSnapshot, InvoiceSnapshot, Revision } from './model'
import {
  acceptProposal,
  applyBoundedEdit,
  approvalLabel,
  approvalOf,
  checkAncestry,
  compareSnapshots,
  createDocument,
  currentRevision,
  deriveDeckRevision,
  emptyStore,
  getRevision,
  history,
  markApproved,
  previewProposal,
  rejectProposal,
  restoreRevision,
  RevisionError,
  SAMPLE_OPERATOR,
  saveEdit,
  SYSTEM_AUTHOR,
  versionLabel,
  type RevisionStore,
} from './revisions'
import { validateSnapshot } from './validation'

const day = (iso: string) => iso.slice(0, 10)

function withDoc(snapshot: DocumentSnapshot, outputId = 'out-doc') {
  const env = fixedEnv()
  const { store } = createDocument(emptyStore(), env, snapshot, { outputId })
  return { env, store, outputId, v1: currentRevision(store, outputId) }
}

function expectError(fn: () => unknown, code: RevisionError['code']) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(RevisionError)
    expect((e as RevisionError).code).toBe(code)
    return e as RevisionError
  }
  throw new Error(`expected a ${code} error`)
}

describe('revision store', () => {
  it('creates v1 with explicit identity, a System author and a frozen snapshot', () => {
    const { store, v1 } = withDoc(completeInvoice())
    expect(v1.parentRevisionId).toBeNull()
    expect(v1.author).toEqual(SYSTEM_AUTHOR)
    expect(versionLabel(store, v1.revisionId)).toBe('v1')
    expect(Object.isFrozen(v1.snapshot)).toBe(true)
    expect(Object.isFrozen(v1.snapshot.blocks[0])).toBe(true)
    // Changing saved content is an error, not a silent no-op.
    expect(() => { (v1.snapshot.fields['payment.terms'] as { label: string }).label = 'x' }).toThrow(TypeError)
    expect(() => { (v1 as { changeSummary: string }).changeSummary = 'rewritten' }).toThrow(TypeError)
  })

  it('never mutates an earlier store: every operation returns a new one', () => {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    const before = { docs: store.documents, revs: store.revisions, current: store.documents.get(outputId)!.currentRevisionId }
    const { store: next } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    expect(store.documents).toBe(before.docs)
    expect(store.revisions).toBe(before.revs)
    expect(store.documents.get(outputId)!.currentRevisionId).toBe(before.current)
    expect(next.revisions.size).toBe(2)
  })

  it('keeps two documents with the same title distinct by ID', () => {
    const env = fixedEnv()
    let { store } = createDocument(emptyStore(), env, completeInvoice(), { outputId: 'out-a', title: 'Same title' })
    ;({ store } = createDocument(store, env, completeInvoice(), { outputId: 'out-b', title: 'Same title' }))
    const a = currentRevision(store, 'out-a')
    const b = currentRevision(store, 'out-b')
    expect(a.revisionId).not.toBe(b.revisionId)
    expect(store.documents.get('out-a')!.title).toBe(store.documents.get('out-b')!.title)
    expect(history(store, 'out-a').map((r) => r.revisionId)).toEqual([a.revisionId])
    expectError(() => createDocument(store, env, completeInvoice(), { outputId: 'out-a' }), 'invalid-edit')
  })
})

describe('bounded edits (fixture 6)', () => {
  it('editing line 2 quantity changes only the line items and the derived totals', () => {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    const { store: s2, revision: v2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'line-item', blockId: 'blk-lines', itemId: 'li-2', change: { property: 'quantity', quantityMilli: 10_000 } })
    expect(v2.changeSummary).toBe('Edited line 2: quantity')
    expect(v2.author).toEqual(SAMPLE_OPERATOR)
    expect(v2.parentRevisionId).toBe(v1.revisionId)
    expect(versionLabel(s2, v2.revisionId)).toBe('v2')
    const cmp = compareSnapshots(v1.snapshot, v2.snapshot)
    expect(cmp.changedBlocks).toEqual(['blk-lines'])
    expect(cmp.changedFields).toEqual([])
    expect(cmp.brandUnchanged && cmp.localeUnchanged && cmp.layoutUnchanged).toBe(true)
    // Unchanged blocks are the very same frozen objects.
    for (const id of cmp.unchangedBlocks) expect(v2.snapshot.blocks.find((b) => b.id === id)).toBe(v1.snapshot.blocks.find((b) => b.id === id))
    // Derived totals follow the new value; v1 keeps its own.
    expect((computeInvoiceTotals(v1.snapshot as InvoiceSnapshot).total as { money: { amountMinor: number } }).money.amountMinor).toBe(FIXTURE_1_EXPECTED.total)
    const t2 = computeInvoiceTotals(v2.snapshot as InvoiceSnapshot)
    // 10 h × 185.00 = 1,850.00 (was 2,312.50): subtotal 684,497; discount 34,225 (34,224.85); base 650,272; tax 53,647 (53,647.44); total 703,919.
    expect(t2.subtotal).toEqual({ known: true, money: m(684_497, 'USD') })
    expect(t2.total).toEqual({ known: true, money: m(703_919, 'USD') })
  })

  it('edits one field, one unit price, one description and one sentence with the approved summaries', () => {
    const inv = withDoc(completeInvoice())
    expect(saveEdit(inv.store, inv.env, inv.outputId, inv.v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') }).revision.changeSummary).toBe('Edited Payment terms')
    expect(saveEdit(inv.store, inv.env, inv.outputId, inv.v1.revisionId, { kind: 'line-item', blockId: 'blk-lines', itemId: 'li-3', change: { property: 'unitPrice', value: m(7_000, 'USD') } }).revision.changeSummary).toBe('Edited line 3: unit price')
    expect(saveEdit(inv.store, inv.env, inv.outputId, inv.v1.revisionId, { kind: 'line-item', blockId: 'blk-lines', itemId: 'li-1', change: { property: 'description', value: 'Brand identity system' } }).revision.changeSummary).toBe('Edited line 1: description')

    const brief = withDoc(evidenceBrief())
    const { revision } = saveEdit(brief.store, brief.env, brief.outputId, brief.v1.revisionId, { kind: 'text', blockId: 'blk-evidence-1', run: 0, text: 'Across the spring cohort, 61% of cancellations came in the first four weeks' })
    expect(revision.changeSummary).toBe('Edited text in Evidence: when members leave, and the reasons they give when asked at cancellation')
    const block = revision.snapshot.blocks.find((b) => b.id === 'blk-evidence-1')
    // The citation stays with the edited sentence.
    expect(block?.type === 'paragraph' && block.runs[0].citationIds).toEqual(['src-1'])
    const list = saveEdit(brief.store, brief.env, brief.outputId, brief.v1.revisionId, { kind: 'text', blockId: 'blk-goals', item: 1, run: 0, text: 'Learn which expectation gaps matter most.' }).revision
    expect(list.changeSummary).toBe('Edited text in Goals')
    expect(compareSnapshots(brief.v1.snapshot, list.snapshot).changedBlocks).toEqual(['blk-goals'])
  })

  it('filling a missing field creates a revision and updates validation; unknown never becomes zero', () => {
    const { env, store, outputId, v1 } = withDoc(incompleteInvoice())
    expect(validateSnapshot(v1.snapshot).fields['invoice.dueDate'].status).toBe('missing')
    const { revision: v2, store: s2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'invoice.dueDate', value: { type: 'date', iso: '2026-11-01' } })
    expect(v2.changeSummary).toBe('Edited Due date')
    expect(validateSnapshot(v2.snapshot).fields['invoice.dueDate'].status).toBe('provided')
    expect(computeInvoiceTotals(v2.snapshot as InvoiceSnapshot).total.known).toBe(false)
    const { revision: v3 } = saveEdit(s2, env, outputId, v2.revisionId, { kind: 'field', fieldId: 'tax.applicability', value: { type: 'choice', option: 'exempt' } })
    expect(computeInvoiceTotals(v3.snapshot as InvoiceSnapshot).total).toEqual({ known: true, money: m(167_750, 'EUR') })
  })

  it('previewing an edit (then cancelling) leaves the accepted snapshot untouched', () => {
    const { store, outputId, v1 } = withDoc(completeInvoice())
    const preview = applyBoundedEdit(v1.snapshot, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    expect(preview.snapshot).not.toBe(v1.snapshot)
    expect(currentRevision(store, outputId)).toBe(v1)
    expect(store.revisions.size).toBe(1)
  })

  it('refuses invalid, empty, unchanged and out-of-bounds edits with explicit errors', () => {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    const edit = (e: Parameters<typeof saveEdit>[4]) => saveEdit(store, env, outputId, v1.revisionId, e)
    expectError(() => edit({ kind: 'field', fieldId: 'payment.terms', value: { type: 'date', iso: '2026-01-01' } }), 'invalid-edit')
    expectError(() => edit({ kind: 'field', fieldId: 'payment.terms', value: text('   ') }), 'invalid-edit')
    expectError(() => edit({ kind: 'field', fieldId: 'tax.applicability', value: { type: 'choice', option: 'maybe' } }), 'invalid-edit')
    expectError(() => edit({ kind: 'field', fieldId: 'no.such.field', value: text('x') }), 'invalid-edit')
    expectError(() => edit({ kind: 'field', fieldId: 'payment.terms', value: text('Net 30. Bank transfer to the account on the remittance slip.') }), 'no-change')
    expectError(() => edit({ kind: 'line-item', blockId: 'blk-lines', itemId: 'li-9', change: { property: 'quantity', quantityMilli: 1000 } }), 'invalid-edit')
    expectError(() => edit({ kind: 'line-item', blockId: 'blk-lines', itemId: 'li-2', change: { property: 'quantity', quantityMilli: 0 } }), 'invalid-edit')
    expectError(() => edit({ kind: 'line-item', blockId: 'blk-lines', itemId: 'li-2', change: { property: 'unitPrice', value: m(-1, 'USD') } }), 'invalid-edit')
    expectError(() => edit({ kind: 'line-item', blockId: 'blk-totals', itemId: 'li-2', change: { property: 'quantity', quantityMilli: 1000 } }), 'invalid-edit')
    // Text not under a section heading (the invoice's internal note) is outside the bounded-edit scope.
    expectError(() => edit({ kind: 'text', blockId: 'blk-internal-note', run: 0, text: 'Changed' }), 'unsupported')
    expect(store.revisions.size).toBe(1)
  })

  it('refuses Issuer edits: issuer identity comes from the brand profile (forced)', () => {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    const err = expectError(() => saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'issuer.name', value: text('Renamed Studio Ltd') }), 'unsupported')
    expect(err.message).toMatch(/brand profile/)
    expect(store.revisions.size).toBe(1)
    // Proposals go through the same rule.
    const forged = { proposalId: 'p', outputId, baseRevisionId: v1.revisionId, title: 'x', edit: { kind: 'field' as const, fieldId: 'issuer.name', value: text('Renamed') }, fictional: true as const }
    expectError(() => acceptProposal(store, env, forged), 'unsupported')
  })

  it('refuses edits to a revision that is not current (forced)', () => {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    const { store: s2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    const err = expectError(() => saveEdit(s2, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 45.') }), 'not-current')
    expect(err.message).toMatch(/v1 is not the current revision \(v2 is\)/)
    expectError(() => saveEdit(s2, env, 'out-other', v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('x') }), 'not-found')
  })
})

describe('proposals', () => {
  for (const template of PROPOSAL_TEMPLATES) {
    it(`${template.title}: before/after shown, reject changes nothing, accept creates a revision`, () => {
      const snapshot = template.fixtureId === 'brief-evidence' ? evidenceBrief() : completeInvoice()
      const { env, store, outputId, v1 } = withDoc(snapshot)
      const proposal = proposalFrom(template, outputId, v1.revisionId)
      const { before, after } = previewProposal(store, proposal)
      expect(before).toBe(v1.snapshot)
      expect(compareSnapshots(before, after).changedBlocks.length + compareSnapshots(before, after).changedFields.length).toBe(1)
      // The proposal is not applied content.
      expect(currentRevision(store, outputId).snapshot).toBe(v1.snapshot)
      expect(rejectProposal(store, proposal)).toBe(store)
      const { revision } = acceptProposal(store, env, proposal)
      expect(revision.changeSummary).toBe(`Accepted proposal: ${template.title}`)
      expect(revision.operation).toEqual({ type: 'accept-proposal', proposalId: template.proposalId })
      expect(JSON.stringify(revision.snapshot)).toBe(JSON.stringify(after))
    })
  }

  it('the brief proposal keeps its facts and citation', () => {
    const { store, outputId, v1 } = withDoc(evidenceBrief())
    const { after } = previewProposal(store, proposalFrom(PROPOSAL_TEMPLATES[1], outputId, v1.revisionId))
    const block = after.blocks.find((b) => b.id === 'blk-evidence-2')
    expect(block?.type === 'paragraph' && block.runs[0].text).toMatch(/8 of 112.*15 of 109/)
    expect(block?.type === 'paragraph' && block.runs[0].citationIds).toEqual(['src-3'])
  })

  it('refuses to accept a proposal whose base is no longer current (forced)', () => {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    const proposal = proposalFrom(PROPOSAL_TEMPLATES[0], outputId, v1.revisionId)
    const { store: s2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'invoice.poNumber', value: text('CLC-PO-9000') })
    expectError(() => acceptProposal(s2, env, proposal), 'not-current')
  })
})

describe('restore (fixture 8)', () => {
  function threeVersions() {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    let s = markApproved(store, env, v1.revisionId, SAMPLE_REVIEWER)
    const r2 = saveEdit(s, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    const r3 = saveEdit(r2.store, env, outputId, r2.revision.revisionId, { kind: 'line-item', blockId: 'blk-lines', itemId: 'li-2', change: { property: 'quantity', quantityMilli: 8_000 } })
    s = r3.store
    return { env, store: s, outputId, v1, v2: r2.revision, v3: r3.revision }
  }

  it('restoring v1 after v3 creates v4 from v1’s content, keeping v2 and v3 and not inheriting approval', () => {
    const { env, store, outputId, v1, v2, v3 } = threeVersions()
    const { store: s4, revision: v4 } = restoreRevision(store, env, outputId, v1.revisionId)
    expect(versionLabel(s4, v4.revisionId)).toBe('v4')
    expect(v4.parentRevisionId).toBe(v3.revisionId)
    expect(v4.operation).toEqual({ type: 'restore', fromRevisionId: v1.revisionId })
    expect(v4.changeSummary).toBe('Restored from v1')
    expect(v4.author).toEqual(SYSTEM_AUTHOR)
    expect(v4.snapshot).toEqual(v1.snapshot)
    expect(v4.revisionId).not.toBe(v1.revisionId)
    expect(history(s4, outputId).map((r: Revision) => r.revisionId)).toEqual([v1.revisionId, v2.revisionId, v3.revisionId, v4.revisionId])
    expect(getRevision(s4, v3.revisionId)).toBe(v3)
    expect(approvalOf(s4, v1.revisionId)).not.toBeNull()
    expect(approvalOf(s4, v4.revisionId)).toBeNull()
  })

  it('refuses restoring the current revision, a missing one, or another document’s (forced)', () => {
    const { env, store, outputId, v1, v3 } = threeVersions()
    expectError(() => restoreRevision(store, env, outputId, v3.revisionId), 'no-change')
    expectError(() => restoreRevision(store, env, outputId, 'rev-missing'), 'not-found')
    const other = createDocument(store, env, completeInvoice(), { outputId: 'out-other' })
    expectError(() => restoreRevision(other.store, env, 'out-other', v1.revisionId), 'wrong-document')
  })
})

describe('mock approval (fixture 7)', () => {
  it('the marker stays on v1; v2 is not approved; labels are the approved wording', () => {
    const { env, store, outputId, v1 } = withDoc(completeInvoice())
    const s1 = markApproved(store, env, v1.revisionId, SAMPLE_REVIEWER)
    const { store: s2, revision: v2 } = saveEdit(s1, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    expect(approvalLabel(s2, v1.revisionId, day)).toBe(`Approved (sample) by ${SAMPLE_REVIEWER} on ${day(approvalOf(s2, v1.revisionId)!.timestamp)} — applies to v1 only`)
    expect(approvalLabel(s2, v2.revisionId, day)).toBe('Not approved')
    expect(approvalOf(s2, v1.revisionId)?.mock).toBe(true)
    expectError(() => markApproved(s2, env, v1.revisionId, SAMPLE_REVIEWER), 'no-change')
    expectError(() => markApproved(s2, env, 'rev-missing', SAMPLE_REVIEWER), 'not-found')
  })
})

describe('deck ancestry (fixture 5)', () => {
  function briefAndDeck() {
    const { env, store, outputId: briefId, v1 } = withDoc(evidenceBrief(), 'out-brief')
    const { store: s, outputId: deckId, revision: deckV1 } = deriveDeckRevision(store, env, briefId, v1.revisionId)
    return { env, store: s, briefId, deckId, briefV1: v1, deckV1 }
  }

  it('records and verifies the exact source revision; reports current', () => {
    const { store, deckId, deckV1, briefV1 } = briefAndDeck()
    expect(store.documents.get(deckId)!.derivedFrom).toEqual({ outputId: 'out-brief', revisionId: briefV1.revisionId })
    expect(deckV1.changeSummary).toMatch(/^Derived from Reducing first-month cancellations.* v1$/)
    expect(checkAncestry(store, deckV1.revisionId)).toEqual({ status: 'current', label: 'Derived from brief v1 — current', sourceVersion: 1 })
  })

  it('reports stale when the brief moves on, never updating by itself; deriving again makes it current', () => {
    const { env, store, briefId, deckId, briefV1, deckV1 } = briefAndDeck()
    const { store: s2, revision: briefV2 } = saveEdit(store, env, briefId, briefV1.revisionId, { kind: 'text', blockId: 'blk-goals', item: 0, run: 0, text: 'Lower first-month cancellations.' })
    const stale = checkAncestry(s2, deckV1.revisionId)
    expect(stale).toEqual({ status: 'stale', label: 'Derived from brief v1 — the brief now has v2. This deck does not update by itself; derive again to update.', sourceVersion: 1, latestVersion: 2 })
    expect(currentRevision(s2, deckId)).toBe(deckV1)
    const { store: s3, revision: deckV2 } = deriveDeckRevision(s2, env, briefId, briefV2.revisionId, deckId)
    expect(versionLabel(s3, deckV2.revisionId)).toBe('v2')
    expect(deckV2.parentRevisionId).toBe(deckV1.revisionId)
    expect(checkAncestry(s3, deckV2.revisionId).label).toBe('Derived from brief v2 — current')
    expect(s3.documents.get(deckId)!.derivedFrom?.revisionId).toBe(briefV2.revisionId)
  })

  it('restoring an older deck revision points the record and the check back at that revision’s source', () => {
    const { env, store, briefId, deckId, briefV1, deckV1 } = briefAndDeck()
    const b2 = saveEdit(store, env, briefId, briefV1.revisionId, { kind: 'text', blockId: 'blk-goals', item: 0, run: 0, text: 'Lower first-month cancellations.' })
    const d2 = deriveDeckRevision(b2.store, env, briefId, b2.revision.revisionId, deckId)
    expect(d2.store.documents.get(deckId)!.derivedFrom?.revisionId).toBe(b2.revision.revisionId)
    const { store: s, revision: deckV3 } = restoreRevision(d2.store, env, deckId, deckV1.revisionId)
    expect(s.documents.get(deckId)!.derivedFrom).toEqual({ outputId: briefId, revisionId: briefV1.revisionId })
    expect(checkAncestry(s, deckV3.revisionId).label).toBe('Derived from brief v1 — the brief now has v2. This deck does not update by itself; derive again to update.')
  })

  it('fails explicitly for a missing, misattributed, non-brief or mismatched source (forced)', () => {
    const { store, deckV1, briefV1 } = briefAndDeck()
    const forge = (patch: Partial<Revision>): RevisionStore => {
      const revisions = new Map(store.revisions)
      revisions.set(deckV1.revisionId, { ...deckV1, ...patch })
      return { ...store, revisions }
    }
    const derive = (from: { outputId: string; revisionId: string }) => ({ operation: { type: 'derive' as const, from } })
    expect(checkAncestry(forge(derive({ outputId: 'out-brief', revisionId: 'rev-missing' })), deckV1.revisionId)).toMatchObject({ status: 'invalid', reason: 'source revision rev-missing does not exist.' })
    expect(checkAncestry(forge(derive({ outputId: 'out-elsewhere', revisionId: briefV1.revisionId })), deckV1.revisionId)).toMatchObject({ status: 'invalid' })
    expect(checkAncestry(forge({ snapshot: { ...deckV1.snapshot, blocks: deckV1.snapshot.blocks.slice(1) } }), deckV1.revisionId)).toMatchObject({ status: 'invalid', reason: `the deck's content does not match ${briefV1.revisionId}.` })
    expect(checkAncestry(forge({ operation: { type: 'create' } }), deckV1.revisionId)).toMatchObject({ status: 'invalid' })
    expect(checkAncestry(store, 'rev-missing')).toMatchObject({ status: 'invalid' })
    // Deriving from something that is not a brief is refused.
    const env = fixedEnv('2026-11-01T00:00:00.000Z')
    const inv = createDocument(store, env, completeInvoice(), { outputId: 'out-inv' })
    expectError(() => deriveDeckRevision(inv.store, env, 'out-inv', inv.revision.revisionId), 'unsupported')
    expectError(() => deriveDeckRevision(store, env, 'out-inv', briefV1.revisionId), 'wrong-document')
    expectError(() => deriveDeckRevision(store, env, 'out-brief', 'rev-missing'), 'not-found')
  })

  it('decks are not edited directly', () => {
    const { env, store, deckId, deckV1 } = briefAndDeck()
    expectError(() => saveEdit(store, env, deckId, deckV1.revisionId, { kind: 'field', fieldId: 'brief.title', value: text('New') }), 'unsupported')
  })
})
