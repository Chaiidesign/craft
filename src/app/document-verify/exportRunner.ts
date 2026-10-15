// Runs one export from the workbench: start (refusals come back as text),
// render, settle, then report — announcements and the PDF-preview switch are
// based on the record as stored after settling, never on the render outcome.
// A job cancelled while it rendered settles to nothing, so its late result
// can't announce "ready" or open a preview. Pure enough to test in Node.

import { FORMAT_LABEL } from '@/lib/documents/export/capabilities'
import { ExportJobError, formatSize, getExport, renderJob, settleExport, startExport, type ExportState, type StartRequest } from '@/lib/documents/export/jobs'
import type { ExportResources } from '@/lib/documents/export/resources'
import type { DocumentEnv, DocumentSnapshot, ExportRecord } from '@/lib/documents/model'
import { getDocument, versionLabel, type RevisionStore } from '@/lib/documents/revisions'

export interface ExportControls {
  exports: ExportState
  /** Applies a change to the latest export state (jobs settle asynchronously). */
  updateExports: (change: (s: ExportState) => ExportState) => void
  /** The latest state, read synchronously when a job starts (duplicate check) and after it settles. */
  readExports: () => ExportState
}

/** Approved status labels. */
export function exportStatusLabel(store: RevisionStore, r: ExportRecord): string {
  const format = FORMAT_LABEL[r.format]
  const v = versionLabel(store, r.revisionId)
  switch (r.status) {
    case 'pending': return `Preparing ${format} of ${v}…`
    case 'succeeded': return `${format} of ${v} ready (${formatSize(r.artifact.byteSize)})`
    case 'expired': return `${format} of ${v} — file not kept after reload. Export again to download.`
    case 'failed': return r.error.code === 'cancelled' ? `${format} of ${v} cancelled — ${r.error.message}` : `${format} failed: ${r.error.message}`
    case 'unsupported': return r.error.message
  }
}

export interface RunExport {
  controls: ExportControls
  env: DocumentEnv
  store: RevisionStore
  req: StartRequest
  resources: (snapshot: DocumentSnapshot) => Promise<ExportResources>
  localUrl: (bytes: Uint8Array, mimeType: string, filename: string) => string
  /** Scenarios 9 and 11 only: the forced renderer failure's message. */
  forceFailure?: string
  announce?: (message: string) => void
  /** Called only when the stored record is a succeeded PDF. */
  onPdfReady?: (exportId: string) => void
}

export type RunResult = { refusal: string } | { record: ExportRecord }

export async function runExport(a: RunExport): Promise<RunResult> {
  let started
  try {
    started = startExport(a.controls.readExports(), a.env, a.store, a.req)
  } catch (e) {
    if (e instanceof ExportJobError) return { refusal: e.message }
    throw e
  }
  a.controls.updateExports(() => started.state)
  const { job, record } = started
  a.announce?.(exportStatusLabel(a.store, record))
  if (!job) return { record }
  const v = versionLabel(a.store, job.revisionId)
  let outcome
  try {
    const resources = await a.resources(job.snapshot)
    outcome = await renderJob(job, {
      resources,
      title: getDocument(a.store, a.req.outputId).title,
      subject: `Revision ${job.revisionId} (${v})`,
      createdAt: a.env.now(),
      forceFailure: a.forceFailure,
    })
  } catch (e) {
    outcome = { ok: false as const, error: { code: 'renderer-failed' as const, message: e instanceof Error ? e.message : String(e) } }
  }
  a.controls.updateExports((s) => settleExport(s, a.env, job, outcome, a.localUrl))
  const settled = getExport(a.controls.readExports(), job.exportId)
  if (settled.status === 'succeeded') {
    if (settled.format === 'pdf') a.onPdfReady?.(settled.exportId)
    a.announce?.(`${FORMAT_LABEL[settled.format]} of ${v} ready.`)
  } else if (settled.status === 'failed' && settled.error.code !== 'cancelled') {
    a.announce?.(`${FORMAT_LABEL[settled.format]} failed: ${settled.error.message}`)
  }
  return { record: settled }
}
