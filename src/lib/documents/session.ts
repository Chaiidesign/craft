// Browser-session persistence for the workbench (Step 6). Demo storage only,
// not production persistence (PRD §2).
//
// What is kept, under one versioned key: the revision store (documents,
// revisions, approval markers), the export records and events, and which
// document is the derived deck. Export files are never stored. On load, a
// succeeded record becomes `expired` (record kept, file not), and a record
// that was still pending comes back cancelled by the reload, so it can never
// block a new export.
//
// A saved session is checked in full before anything is used. A malformed
// one is never silently replaced: loading reports a specific reason and the
// unreadable text, and nothing is written until the person chooses. Starting
// again keeps that text under a second key first.

import type { DocumentEnv, DocumentRecord, DocumentSnapshot, ExportRecord, ReviewMarker, Revision } from './model'
import { CANCEL_MESSAGE, type ExportEvent, type ExportState } from './export/jobs'
import { deepFreeze, type RevisionStore } from './revisions'
import { validateSnapshot } from './validation'

export const SESSION_KEY = 'souvenir-doc-workbench:v1'
export const SESSION_BACKUP_KEY = 'souvenir-doc-workbench:v1:backup'
export const SESSION_VERSION = 1

export interface WorkbenchSession {
  store: RevisionStore
  exports: ExportState
  /** The deck derived in fixture 5, if any. */
  deckId: string | null
}

/** The part of the Web Storage API this module uses (tests pass a fake). */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

// ── Saving ───────────────────────────────────────────────────────────────────

interface SavedSession {
  schemaVersion: typeof SESSION_VERSION
  documents: DocumentRecord[]
  revisions: Revision[]
  markers: ReviewMarker[]
  exports: { records: ExportRecord[]; events: ExportEvent[] }
  deckId: string | null
}

/** Serialises a session. Object URLs are dropped: they die with the page, and files are not stored. */
export function serializeSession(session: WorkbenchSession): string {
  const saved: SavedSession = {
    schemaVersion: SESSION_VERSION,
    documents: [...session.store.documents.values()],
    revisions: [...session.store.revisions.values()],
    markers: [...session.store.markers],
    exports: {
      records: session.exports.records.map((r) => {
        if (r.status !== 'succeeded') return r
        const { filename, mimeType, byteSize } = r.artifact
        return { ...r, artifact: { filename, mimeType, byteSize } } as unknown as ExportRecord
      }),
      events: [...session.exports.events],
    },
    deckId: session.deckId,
  }
  return JSON.stringify(saved)
}

// ── Loading ──────────────────────────────────────────────────────────────────

export type SessionLoad =
  | { status: 'empty' }
  | { status: 'loaded'; session: WorkbenchSession }
  | { status: 'malformed'; reason: string; raw: string }

/** Thrown inside the checker; becomes a malformed result with the approved reason text. */
class Malformed extends Error {}
const wrongAt = (path: string): never => { throw new Malformed(`its structure is wrong at ${path}`) }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const obj = (v: unknown, path: string): Obj => (isObj(v) ? v : wrongAt(path))
const arr = (v: unknown, path: string): unknown[] => (Array.isArray(v) ? v : wrongAt(path))
const str = (v: unknown, path: string): string => (typeof v === 'string' && v.length > 0 ? v : wrongAt(path))
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], path: string): T => (allowed.includes(v as T) ? (v as T) : wrongAt(path))

const KINDS = ['invoice', 'brief', 'deck'] as const
const FORMATS = ['pdf', 'docx', 'pptx'] as const
const STATUSES = ['pending', 'succeeded', 'failed', 'unsupported', 'expired'] as const
const ERROR_CODES = ['unsupported-format', 'validation-blocked', 'renderer-failed', 'font-missing-glyph', 'cancelled'] as const
const OPERATIONS = ['create', 'edit', 'accept-proposal', 'restore', 'derive'] as const

function checkDocument(v: unknown, path: string): DocumentRecord {
  const d = obj(v, path)
  str(d.outputId, `${path}.outputId`)
  oneOf(d.kind, KINDS, `${path}.kind`)
  if (typeof d.title !== 'string') wrongAt(`${path}.title`)
  str(d.currentRevisionId, `${path}.currentRevisionId`)
  const ids = arr(d.revisionIds, `${path}.revisionIds`)
  if (ids.length === 0) wrongAt(`${path}.revisionIds`)
  ids.forEach((id, i) => str(id, `${path}.revisionIds[${i}]`))
  if (d.derivedFrom !== undefined) {
    const from = obj(d.derivedFrom, `${path}.derivedFrom`)
    str(from.outputId, `${path}.derivedFrom.outputId`)
    str(from.revisionId, `${path}.derivedFrom.revisionId`)
  }
  return d as unknown as DocumentRecord
}

function checkRevision(v: unknown, path: string): Revision {
  const r = obj(v, path)
  str(r.revisionId, `${path}.revisionId`)
  str(r.outputId, `${path}.outputId`)
  if (r.parentRevisionId !== null) str(r.parentRevisionId, `${path}.parentRevisionId`)
  str(r.createdAt, `${path}.createdAt`)
  const author = obj(r.author, `${path}.author`)
  str(author.id, `${path}.author.id`)
  str(author.name, `${path}.author.name`)
  if (typeof r.changeSummary !== 'string') wrongAt(`${path}.changeSummary`)
  oneOf(obj(r.operation, `${path}.operation`).type, OPERATIONS, `${path}.operation.type`)
  obj(r.snapshot, `${path}.snapshot`)
  return r as unknown as Revision
}

function checkMarker(v: unknown, path: string): ReviewMarker {
  const m = obj(v, path)
  str(m.reviewer, `${path}.reviewer`)
  oneOf(m.decision, ['approved', 'changes-requested'] as const, `${path}.decision`)
  str(m.timestamp, `${path}.timestamp`)
  str(m.revisionId, `${path}.revisionId`)
  if (m.mock !== true) wrongAt(`${path}.mock`)
  return m as unknown as ReviewMarker
}

function checkExport(v: unknown, path: string): ExportRecord {
  const r = obj(v, path)
  str(r.exportId, `${path}.exportId`)
  str(r.outputId, `${path}.outputId`)
  str(r.revisionId, `${path}.revisionId`)
  oneOf(r.format, FORMATS, `${path}.format`)
  if (typeof r.draft !== 'boolean') wrongAt(`${path}.draft`)
  if (r.retryOf !== undefined) str(r.retryOf, `${path}.retryOf`)
  const status = oneOf(r.status, STATUSES, `${path}.status`)
  if (status === 'succeeded' || status === 'expired') {
    const a = obj(r.artifact, `${path}.artifact`)
    str(a.filename, `${path}.artifact.filename`)
    str(a.mimeType, `${path}.artifact.mimeType`)
    if (typeof a.byteSize !== 'number' || !Number.isInteger(a.byteSize) || a.byteSize <= 0) wrongAt(`${path}.artifact.byteSize`)
  }
  if (status === 'failed' || status === 'unsupported') {
    const e = obj(r.error, `${path}.error`)
    oneOf(e.code, ERROR_CODES, `${path}.error.code`)
    if (typeof e.message !== 'string') wrongAt(`${path}.error.message`)
  }
  return r as unknown as ExportRecord
}

/** Why a saved snapshot can't be used, or null. Fixture snapshots may be incomplete or invalid by design; this only refuses ones validation can't read. */
export function snapshotProblem(v: Obj): string | null {
  if (!KINDS.includes(v.kind as never)) return `its kind “${String(v.kind)}” is not invoice, brief or deck`
  if (!isObj(v.fields)) return 'it has no fields object'
  if (!Array.isArray(v.fieldOrder)) return 'it has no field order'
  for (const id of v.fieldOrder) if (typeof id !== 'string' || !(id in v.fields)) return `its field order lists “${String(id)}”, which is not among its fields`
  if (!Array.isArray(v.blocks)) return 'it has no block list'
  for (const b of v.blocks) {
    if (!isObj(b) || typeof b.id !== 'string' || typeof b.type !== 'string') return 'a block has no ID or type'
    if (b.type !== 'line-items') continue
    if (!Array.isArray(b.items)) return `block “${b.id}” has no line items`
    for (const li of b.items) {
      if (!isObj(li) || typeof li.id !== 'string' || typeof li.description !== 'string') return `block “${b.id}” has a line item with no ID or description`
      if (!Number.isSafeInteger(li.quantityMilli)) return `line item “${li.id}” has a quantity that is not whole thousandths`
      const price = li.unitPrice
      if (price !== null && (!isObj(price) || !Number.isSafeInteger(price.amountMinor) || typeof price.currency !== 'string')) return `line item “${li.id}” has a unit price that is not whole minor units`
    }
  }
  if (!Array.isArray(v.citations)) return 'it has no citation list'
  if (!isObj(v.brand) || typeof v.brand.issuerDisplayName !== 'string') return 'it has no brand profile'
  if (typeof v.locale !== 'string') return 'it has no locale'
  try {
    validateSnapshot(v as unknown as DocumentSnapshot)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return null
}

/** Checks and rebuilds a saved session. `raw === null` means nothing was saved. */
export function parseSession(raw: string | null, env: DocumentEnv): SessionLoad {
  if (raw === null) return { status: 'empty' }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { status: 'malformed', reason: 'it isn’t valid JSON', raw }
  }
  try {
    return { status: 'loaded', session: rebuild(data, env) }
  } catch (e) {
    if (e instanceof Malformed) return { status: 'malformed', reason: e.message, raw }
    throw e
  }
}

function rebuild(data: unknown, env: DocumentEnv): WorkbenchSession {
  const top = obj(data, '(top level)')
  if (top.schemaVersion !== SESSION_VERSION) throw new Malformed(`it was saved by an unknown version (${JSON.stringify(top.schemaVersion) ?? 'none'})`)
  const documents = arr(top.documents, 'documents').map((d, i) => checkDocument(d, `documents[${i}]`))
  const revisions = arr(top.revisions, 'revisions').map((r, i) => checkRevision(r, `revisions[${i}]`))
  const markers = arr(top.markers, 'markers').map((m, i) => checkMarker(m, `markers[${i}]`))
  const exportsObj = obj(top.exports, 'exports')
  const records = arr(exportsObj.records, 'exports.records').map((r, i) => checkExport(r, `exports.records[${i}]`))
  const events = arr(exportsObj.events, 'exports.events').map((e, i) => {
    str(obj(e, `exports.events[${i}]`).type, `exports.events[${i}].type`)
    return e as ExportEvent
  })
  if (top.deckId !== null) str(top.deckId, 'deckId')

  const docMap = new Map<string, DocumentRecord>()
  documents.forEach((d, i) => { if (docMap.has(d.outputId)) wrongAt(`documents[${i}].outputId`); docMap.set(d.outputId, d) })
  const revMap = new Map<string, Revision>()
  revisions.forEach((r, i) => {
    if (revMap.has(r.revisionId)) wrongAt(`revisions[${i}].revisionId`)
    if (!docMap.has(r.outputId)) wrongAt(`revisions[${i}].outputId`)
    revMap.set(r.revisionId, r)
  })

  documents.forEach((d, i) => {
    d.revisionIds.forEach((id, j) => {
      const r = revMap.get(id)
      if (!r || r.outputId !== d.outputId) wrongAt(`documents[${i}].revisionIds[${j}]`)
    })
    if (!d.revisionIds.includes(d.currentRevisionId)) throw new Malformed(`${d.title || d.outputId}’s current revision isn’t in its history`)
  })
  revisions.forEach((r, i) => {
    if (!docMap.get(r.outputId)!.revisionIds.includes(r.revisionId)) wrongAt(`revisions[${i}].revisionId`)
    if ((r.snapshot as unknown as Obj).kind !== docMap.get(r.outputId)!.kind) wrongAt(`revisions[${i}].snapshot.kind`)
  })
  for (const r of revisions) {
    if (r.parentRevisionId !== null && !revMap.has(r.parentRevisionId)) throw new Malformed(`revision ${r.revisionId}’s parent ${r.parentRevisionId} is missing`)
  }
  for (const d of documents) {
    if (d.derivedFrom && !revMap.has(d.derivedFrom.revisionId)) throw new Malformed(`deck ${d.outputId} comes from brief revision ${d.derivedFrom.revisionId}, which is missing`)
  }
  for (const m of markers) {
    if (!revMap.has(m.revisionId)) throw new Malformed(`an approval refers to revision ${m.revisionId}, which is missing`)
  }
  for (const r of revisions) {
    const problem = snapshotProblem(r.snapshot as unknown as Obj)
    if (problem) throw new Malformed(`revision ${r.revisionId} fails validation: ${problem}`)
  }
  records.forEach((r, i) => {
    const rev = revMap.get(r.revisionId)
    if (!rev || rev.outputId !== r.outputId) wrongAt(`exports.records[${i}].revisionId`)
  })
  const deckId = top.deckId as string | null
  if (deckId !== null && docMap.get(deckId)?.kind !== 'deck') wrongAt('deckId')

  // Files are not stored: a finished export comes back expired, an unfinished one cancelled by the reload.
  const reloaded: ExportEvent[] = []
  const restored = records.map((r): ExportRecord => {
    if (r.status === 'succeeded' || r.status === 'expired') {
      const { filename, mimeType, byteSize } = r.artifact
      return { ...r, status: 'expired', artifact: { filename, mimeType, byteSize } }
    }
    if (r.status === 'pending') {
      reloaded.push({ type: 'exportCancelled', exportId: r.exportId, at: env.now(), reason: 'reload' })
      return { ...r, status: 'failed', error: { code: 'cancelled', message: CANCEL_MESSAGE.reload } }
    }
    return r
  })

  return {
    store: {
      documents: new Map(documents.map((d) => [d.outputId, deepFreeze(d)])),
      revisions: new Map(revisions.map((r) => [r.revisionId, deepFreeze(r)])),
      markers: deepFreeze(markers),
    },
    exports: { records: restored, events: [...events, ...reloaded] },
    deckId,
  }
}

// ── Storage access ───────────────────────────────────────────────────────────

/** The reason text for a storage failure: the browser's own message. */
export const storageReason = (e: unknown): string => (e instanceof Error ? e.message || e.name : String(e))

export type StorageResult = { ok: true } | { ok: false; reason: string }

/** Opens storage; the accessor itself throws when storage is blocked (some private modes). */
export function openStorage(get: () => KeyValueStorage): { ok: true; storage: KeyValueStorage } | { ok: false; reason: string } {
  try {
    return { ok: true, storage: get() }
  } catch (e) {
    return { ok: false, reason: storageReason(e) }
  }
}

export function readSession(storage: KeyValueStorage, env: DocumentEnv): SessionLoad | { status: 'unavailable'; reason: string } {
  let raw: string | null
  try {
    raw = storage.getItem(SESSION_KEY)
  } catch (e) {
    return { status: 'unavailable', reason: storageReason(e) }
  }
  return parseSession(raw, env)
}

export function writeSession(storage: KeyValueStorage, session: WorkbenchSession): StorageResult {
  try {
    storage.setItem(SESSION_KEY, serializeSession(session))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: storageReason(e) }
  }
}

/** "Start again": keeps the unreadable text under the backup key, then clears the session. Nothing is cleared if the backup can't be written. */
export function startAgain(storage: KeyValueStorage, raw: string): StorageResult {
  try {
    storage.setItem(SESSION_BACKUP_KEY, raw)
  } catch (e) {
    return { ok: false, reason: storageReason(e) }
  }
  return clearSession(storage)
}

/** "Reset workbench": clears the saved session (the backup, if any, is left alone). */
export function clearSession(storage: KeyValueStorage): StorageResult {
  try {
    storage.removeItem(SESSION_KEY)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: storageReason(e) }
  }
}
