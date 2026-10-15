// Fixture 11 session data: a valid sample session (invoice v1 approved then
// edited to v2, the evidence brief, and a deck derived from it), and one
// malformed copy of it per kind of breakage, each with the exact reason
// loading must give. Every malformed session is built from the valid one, so
// each breaks exactly one thing. All fictional sample data.

import type { DocumentEnv } from '../model'
import { createDocument, deriveDeckRevision, emptyStore, markApproved, saveEdit } from '../revisions'
import { evidenceBrief } from './brief'
import { text } from './builders'
import { completeInvoice } from './invoices'
import { SAMPLE_REVIEWER } from './revisions'
import type { WorkbenchSession } from '../session'
import { emptyExports } from '../export/jobs'

export function sampleSession(env: DocumentEnv): WorkbenchSession {
  const inv = createDocument(emptyStore(), env, completeInvoice(), { outputId: 'out-session-invoice' })
  const approved = markApproved(inv.store, env, inv.revision.revisionId, SAMPLE_REVIEWER)
  const edited = saveEdit(approved, env, inv.outputId, inv.revision.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
  const brief = createDocument(edited.store, env, evidenceBrief(), { outputId: 'out-session-brief' })
  const deck = deriveDeckRevision(brief.store, env, brief.outputId, brief.revision.revisionId)
  return { store: deck.store, exports: emptyExports(), deckId: deck.outputId }
}

export type SessionBreakage =
  | 'not-json' | 'unknown-version' | 'wrong-structure' | 'current-not-in-history'
  | 'missing-parent' | 'missing-deck-source' | 'missing-approval-revision' | 'fails-validation'

export interface MalformedSession { kind: SessionBreakage; label: string; raw: string; reason: string }

type Saved = {
  schemaVersion: unknown
  documents: { outputId: string; title: string; kind: string; currentRevisionId: string; revisionIds: unknown; derivedFrom?: { revisionId: string } }[]
  revisions: { revisionId: string; parentRevisionId: string | null; snapshot: { blocks: { type: string; items?: { unitPrice: unknown; id: string }[] }[] } }[]
  markers: { revisionId: string }[]
}

/** One malformed copy of `validRaw` (a serialised sample session) per kind of breakage. */
export function malformedSessions(validRaw: string): MalformedSession[] {
  const edit = (change: (s: Saved) => string | void): { raw: string; detail: string } => {
    const s = JSON.parse(validRaw) as Saved
    const detail = change(s) ?? ''
    return { raw: JSON.stringify(s), detail }
  }
  const out: MalformedSession[] = [
    { kind: 'not-json', label: 'Not JSON (cut off mid-write)', raw: validRaw.slice(0, 40), reason: 'it isn’t valid JSON' },
  ]
  const add = (kind: SessionBreakage, label: string, change: (s: Saved) => string | void, reason: (detail: string) => string) => {
    const { raw, detail } = edit(change)
    out.push({ kind, label, raw, reason: reason(detail) })
  }
  add('unknown-version', 'Saved by an unknown version', (s) => { s.schemaVersion = 99 }, () => 'it was saved by an unknown version (99)')
  add('wrong-structure', 'Revision list stored as text', (s) => { s.documents[0].revisionIds = 'rev-001' }, () => 'its structure is wrong at documents[0].revisionIds')
  add('current-not-in-history', 'Current revision not in history', (s) => { s.documents[0].currentRevisionId = 'rev-elsewhere'; return s.documents[0].title }, (title) => `${title}’s current revision isn’t in its history`)
  add('missing-parent', 'Revision points at a missing parent', (s) => {
    const r = s.revisions.find((x) => x.parentRevisionId !== null)!
    r.parentRevisionId = 'rev-gone'
    return r.revisionId
  }, (id) => `revision ${id}’s parent rev-gone is missing`)
  add('missing-deck-source', 'Deck from a missing brief revision', (s) => {
    const d = s.documents.find((x) => x.derivedFrom)!
    d.derivedFrom!.revisionId = 'rev-gone'
    return d.outputId
  }, (id) => `deck ${id} comes from brief revision rev-gone, which is missing`)
  add('missing-approval-revision', 'Approval of a missing revision', (s) => { s.markers[0].revisionId = 'rev-gone' }, () => 'an approval refers to revision rev-gone, which is missing')
  add('fails-validation', 'Amount stored as a formatted string', (s) => {
    const r = s.revisions[0]
    const item = r.snapshot.blocks.find((b) => b.type === 'line-items')!.items![0]
    item.unitPrice = '$1,200.00'
    return `${r.revisionId}|${item.id}`
  }, (d) => {
    const [rev, item] = d.split('|')
    return `revision ${rev} fails validation: line item “${item}” has a unit price that is not whole minor units`
  })
  return out
}
