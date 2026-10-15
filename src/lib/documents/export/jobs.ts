// Export jobs (PRD §5, §9, §10). An export targets exactly one frozen
// revision, chosen explicitly when the job starts; the snapshot is taken from
// the revision store at that moment, so later edits never retarget it. Each
// format succeeds or fails on its own — there is no blanket "export
// succeeded". A second job for the same revision and format is refused while
// one is pending; a retry is a new record with the same revision and format.
// Approval is not export success, and export is not sending.
//
// The state is immutable, like the revision store: every operation returns a
// new state. Events record exportStarted / exportSucceeded / exportFailed /
// exportCancelled.
//
// Cancelling: the renderers run in the page and can't be stopped partway, so a
// cancel marks the record failed with code `cancelled` and the result is
// discarded when it arrives (settleExport only settles a pending record). A
// late result therefore never becomes a file, an event or a "ready" label.

import type { DocumentEnv, DocumentSnapshot, ExportError, ExportFormat, ExportId, ExportRecord, OutputId, RevisionId } from '../model'
import { getRevision, versionNumber, type RevisionStore } from '../revisions'
import { ADAPTERS, type RenderOptions, type RenderOutcome } from './adapters'
import { FORMAT_FILE } from './capabilities'
import { exportFilename } from './filename'

export type ExportEvent =
  | { type: 'exportStarted'; exportId: ExportId; outputId: OutputId; revisionId: RevisionId; format: ExportFormat; at: string }
  | { type: 'exportSucceeded'; exportId: ExportId; at: string; filename: string; byteSize: number }
  | { type: 'exportFailed'; exportId: ExportId; at: string; error: ExportError }
  | { type: 'exportCancelled'; exportId: ExportId; at: string; reason: CancelReason }

export interface ExportState {
  /** Oldest first. */
  readonly records: readonly ExportRecord[]
  readonly events: readonly ExportEvent[]
}

export const emptyExports = (): ExportState => ({ records: [], events: [] })

export type ExportJobErrorCode = 'duplicate-pending' | 'draft-not-confirmed' | 'not-found' | 'not-retryable' | 'not-cancellable'

/** Why a job was cancelled; the text completes "{format} of v{n} cancelled — …" (approved). */
export type CancelReason = 'user' | 'reload'
export const CANCEL_MESSAGE: Readonly<Record<CancelReason, string>> = {
  user: 'the result will be discarded when it arrives',
  reload: 'the page was reloaded before it finished',
}

export const isCancelled = (r: ExportRecord): boolean => r.status === 'failed' && r.error.code === 'cancelled'

export class ExportJobError extends Error {
  constructor(readonly code: ExportJobErrorCode, message: string) {
    super(message)
  }
}

export interface StartRequest {
  outputId: OutputId
  /** The revision to export — explicit, never "whatever is current". */
  revisionId: RevisionId
  format: ExportFormat
  /** The person saw the draft warning and chose "Export draft". */
  confirmDraft?: boolean
  retryOf?: ExportId
}

/** What a started job renders: the frozen snapshot and its file identity, fixed at start. */
export interface ExportJob {
  exportId: ExportId
  revisionId: RevisionId
  format: ExportFormat
  snapshot: DocumentSnapshot
  filename: string
  versionNumber: number
}

export function getExport(state: ExportState, exportId: ExportId): ExportRecord {
  const r = state.records.find((x) => x.exportId === exportId)
  if (!r) throw new ExportJobError('not-found', `No export ${exportId}`)
  return r
}

export function pendingFor(state: ExportState, revisionId: RevisionId, format: ExportFormat): ExportRecord | undefined {
  return state.records.find((r) => r.status === 'pending' && r.revisionId === revisionId && r.format === format)
}

/**
 * Starts an export of one revision in one format. Unsupported formats and blocked revisions are
 * recorded as such (no render happens); otherwise a pending record and the job to render are returned.
 */
export function startExport(state: ExportState, env: DocumentEnv, store: RevisionStore, req: StartRequest): { state: ExportState; record: ExportRecord; job: ExportJob | null } {
  const revision = getRevision(store, req.revisionId)
  if (revision.outputId !== req.outputId) throw new ExportJobError('not-found', `Revision ${req.revisionId} does not belong to ${req.outputId}`)
  const duplicate = pendingFor(state, req.revisionId, req.format)
  if (duplicate) throw new ExportJobError('duplicate-pending', `An export of this revision to ${req.format} is already in progress (${duplicate.exportId}).`)
  const snapshot = revision.snapshot
  const adapter = ADAPTERS[req.format]
  const exportId = env.nextId('exp')
  const base = { exportId, outputId: req.outputId, revisionId: req.revisionId, format: req.format, ...(req.retryOf ? { retryOf: req.retryOf } : {}) }
  const checked = adapter.validate(snapshot)
  if (!checked.ok) {
    const record: ExportRecord = checked.error.code === 'unsupported-format'
      ? { ...base, draft: false, status: 'unsupported', error: checked.error }
      : { ...base, draft: false, status: 'failed', error: checked.error }
    const events = record.status === 'failed' ? [...state.events, { type: 'exportFailed' as const, exportId, at: env.now(), error: checked.error }] : state.events
    return { state: { records: [...state.records, record], events }, record, job: null }
  }
  if (checked.draft && !req.confirmDraft) {
    throw new ExportJobError('draft-not-confirmed', `This revision is a draft: ${checked.missingCount} required facts are missing. Confirm the draft export first.`)
  }
  const record: ExportRecord = { ...base, draft: checked.draft, status: 'pending' }
  const version = versionNumber(store, req.revisionId)
  const job: ExportJob = { exportId, revisionId: req.revisionId, format: req.format, snapshot, filename: exportFilename(snapshot, req.format, version, req.revisionId), versionNumber: version }
  return {
    state: { records: [...state.records, record], events: [...state.events, { type: 'exportStarted', exportId, outputId: req.outputId, revisionId: req.revisionId, format: req.format, at: env.now() }] },
    record,
    job,
  }
}

/** Records a job's outcome. Only a pending record can settle; anything else is left as it is. */
export function settleExport(state: ExportState, env: DocumentEnv, job: ExportJob, outcome: RenderOutcome, localUrl: (bytes: Uint8Array, mimeType: string, filename: string) => string): ExportState {
  const record = getExport(state, job.exportId)
  if (record.status !== 'pending') return state
  let next: ExportRecord
  let event: ExportEvent
  if (outcome.ok) {
    const { mimeType } = FORMAT_FILE[job.format]
    const artifact = { filename: job.filename, mimeType, byteSize: outcome.bytes.byteLength, localUrl: localUrl(outcome.bytes, mimeType, job.filename) }
    next = { ...record, status: 'succeeded', artifact }
    event = { type: 'exportSucceeded', exportId: job.exportId, at: env.now(), filename: artifact.filename, byteSize: artifact.byteSize }
  } else {
    next = { ...record, status: 'failed', error: outcome.error }
    event = { type: 'exportFailed', exportId: job.exportId, at: env.now(), error: outcome.error }
  }
  return { records: state.records.map((r) => (r.exportId === job.exportId ? next : r)), events: [...state.events, event] }
}

/** A retry of a failed (or cancelled) export: same revision, same format, same draft confirmation. */
export function retryRequest(state: ExportState, exportId: ExportId): StartRequest {
  const record = getExport(state, exportId)
  if (record.status !== 'failed') throw new ExportJobError('not-retryable', `Export ${exportId} is ${record.status}; only a failed export can be retried.`)
  return { outputId: record.outputId, revisionId: record.revisionId, format: record.format, confirmDraft: record.draft, retryOf: exportId }
}

/** Exporting again after a reload dropped the file: same revision, format and draft confirmation; a new export, not a retry. */
export function exportAgainRequest(state: ExportState, exportId: ExportId): StartRequest {
  const record = getExport(state, exportId)
  if (record.status !== 'expired') throw new ExportJobError('not-retryable', `Export ${exportId} is ${record.status}; only an export whose file was not kept can be exported again.`)
  return { outputId: record.outputId, revisionId: record.revisionId, format: record.format, confirmDraft: record.draft }
}

/** Cancels a pending job. Its result, when it arrives, is discarded by settleExport. */
export function cancelExport(state: ExportState, env: DocumentEnv, exportId: ExportId, reason: CancelReason = 'user'): ExportState {
  const record = getExport(state, exportId)
  if (record.status !== 'pending') throw new ExportJobError('not-cancellable', `Export ${exportId} is ${record.status}; only a pending export can be cancelled.`)
  const next: ExportRecord = { ...record, status: 'failed', error: { code: 'cancelled', message: CANCEL_MESSAGE[reason] } }
  return {
    records: state.records.map((r) => (r.exportId === exportId ? next : r)),
    events: [...state.events, { type: 'exportCancelled', exportId, at: env.now(), reason }],
  }
}

export function renderJob(job: ExportJob, options: Omit<RenderOptions, 'createdAt'> & { createdAt: string }): Promise<RenderOutcome> {
  return ADAPTERS[job.format].render(job.snapshot, options)
}

/** Formats a byte count for status labels ("{format} of v{n} ready ({size})"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
