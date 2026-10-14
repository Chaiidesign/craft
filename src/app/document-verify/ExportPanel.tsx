'use client'

// Export panel: one button per format the document kind supports (unsupported
// formats are shown disabled with their reason), the draft warning, per-format
// records with their own status and retry, and the generated PDF itself.
// Every export targets the revision being viewed, fixed when it starts.

import React, { useState } from 'react'

import { Button } from '@/components/Button'
import { browserExportResources } from '@/components/documents/exportResources'
import { PdfFilePreview } from '@/components/documents/PdfFilePreview'
import { ADAPTERS } from '@/lib/documents/export/adapters'
import { capability, formatsFor, FORMAT_LABEL } from '@/lib/documents/export/capabilities'
import { ExportJobError, formatSize, renderJob, retryRequest, settleExport, startExport, type ExportState, type StartRequest } from '@/lib/documents/export/jobs'
import type { DocumentEnv, ExportFormat, ExportRecord } from '@/lib/documents/model'
import { getDocument, getRevision, versionLabel, type RevisionStore } from '@/lib/documents/revisions'

import styles from './workbench.module.css'

export interface ExportControls {
  exports: ExportState
  /** Applies a change to the latest export state (jobs settle asynchronously). */
  updateExports: (change: (s: ExportState) => ExportState) => void
  /** The latest state, read synchronously when a job starts (duplicate check). */
  readExports: () => ExportState
}

/** Generated files by their object URL, so the PDF preview reads the bytes themselves (the app's CSP blocks fetching blob: URLs). */
const generated = new Map<string, Uint8Array>()
const objectUrl = (bytes: Uint8Array, mimeType: string) => {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mimeType }))
  generated.set(url, bytes)
  return url
}

/** Approved status labels. */
export function exportStatusLabel(store: RevisionStore, r: ExportRecord): string {
  const format = FORMAT_LABEL[r.format]
  const v = versionLabel(store, r.revisionId)
  switch (r.status) {
    case 'pending': return `Preparing ${format} of ${v}…`
    case 'succeeded': return `${format} of ${v} ready (${formatSize(r.artifact.byteSize)})`
    case 'failed': return `${format} failed: ${r.error.message}`
    case 'unsupported': return r.error.message
  }
}

const TONE: Record<ExportRecord['status'], string> = { pending: 'neutral', succeeded: 'ready', failed: 'invalid', unsupported: 'neutral' }

export function ExportPanel({ store, env, outputId, revisionId, controls, forceFailure, onAnnounce }: {
  store: RevisionStore
  env: DocumentEnv
  outputId: string
  revisionId: string
  controls: ExportControls
  /** Scenario 9 only: formats whose renderer is made to fail on purpose. */
  forceFailure?: ReadonlySet<ExportFormat>
  onAnnounce?: (message: string) => void
}) {
  const doc = getDocument(store, outputId)
  const revision = getRevision(store, revisionId)
  const v = versionLabel(store, revisionId)
  const [confirming, setConfirming] = useState<ExportFormat | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const run = async (req: StartRequest) => {
    setRefusal(null)
    let started
    try {
      started = startExport(controls.readExports(), env, store, req)
    } catch (e) {
      if (e instanceof ExportJobError) { setRefusal(e.message); return }
      throw e
    }
    controls.updateExports(() => started.state)
    const { job, record } = started
    if (!job) { onAnnounce?.(exportStatusLabel(store, record)); return }
    onAnnounce?.(exportStatusLabel(store, record))
    let outcome
    try {
      const resources = await browserExportResources(job.snapshot)
      outcome = await renderJob(job, {
        resources,
        title: doc.title,
        subject: `Revision ${job.revisionId} (${v})`,
        createdAt: env.now(),
        forceFailure: forceFailure?.has(job.format),
      })
    } catch (e) {
      outcome = { ok: false as const, error: { code: 'renderer-failed' as const, message: e instanceof Error ? e.message : String(e) } }
    }
    controls.updateExports((s) => settleExport(s, env, job, outcome, objectUrl))
    if (outcome.ok && job.format === 'pdf') setPreviewId(job.exportId)
    onAnnounce?.(outcome.ok ? `${FORMAT_LABEL[job.format]} of ${v} ready.` : `${FORMAT_LABEL[job.format]} failed: ${outcome.error.message}`)
  }

  const validation = (format: ExportFormat) => ADAPTERS[format].validate(revision.snapshot)
  const click = (format: ExportFormat) => {
    const checked = validation(format)
    if (checked.ok && checked.draft) { setConfirming(format); return }
    void run({ outputId, revisionId, format })
  }

  const records = controls.exports.records.filter((r) => r.outputId === outputId).slice().reverse()
  const pdfs = records.filter((r): r is Extract<ExportRecord, { status: 'succeeded' }> => r.status === 'succeeded' && r.format === 'pdf')
  const shown = pdfs.find((r) => r.exportId === previewId) ?? pdfs.find((r) => r.revisionId === revisionId) ?? null
  const draftCheck = confirming ? validation(confirming) : null

  return (
    <section className={styles.panel} aria-labelledby="export-title">
      <h2 id="export-title" className={styles.panelTitle}>Export {v}</h2>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        Files are made in this browser from the revision you are viewing ({v}), fixed when the export starts. Approval is not export, and export is not sending.
      </p>
      <div className={styles.toolbar} role="group" aria-label="Export formats">
        {formatsFor(doc.kind).map((format) => {
          const cap = capability(doc.kind, format)
          const pending = controls.exports.records.some((r) => r.status === 'pending' && r.revisionId === revisionId && r.format === format)
          return (
            <span key={format} className={styles.exportFormat}>
              <Button size="sm" variant={cap.supported ? 'outline' : 'ghost'} disabled={!cap.supported || pending} onClick={() => click(format)} aria-describedby={cap.supported ? undefined : `export-reason-${format}`}>
                Export {FORMAT_LABEL[format]}
              </Button>
              {!cap.supported && <span id={`export-reason-${format}`} className={styles.muted}>{cap.reason}</span>}
              {forceFailure?.has(format) && <span className={styles.pill} data-tone="invalid">Forced failure (scenario 9 only)</span>}
            </span>
          )
        })}
      </div>

      {confirming && draftCheck?.ok && (
        <div className={styles.draftConfirm} role="alertdialog" aria-labelledby="draft-warning">
          <p id="draft-warning">This revision is a draft: {draftCheck.missingCount} required facts are missing. The file will carry the draft marker.</p>
          <div className={styles.toolbar}>
            <Button size="sm" onClick={() => { const f = confirming; setConfirming(null); void run({ outputId, revisionId, format: f, confirmDraft: true }) }}>Export draft</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {refusal && <p className={styles.formError} role="alert">{refusal}</p>}

      {records.length > 0 && (
        <ul className={styles.issueList} aria-label="Exports">
          {records.map((r) => (
            <li key={r.exportId} className={styles.checkRow} data-export-status={r.status}>
              <span className={styles.pill} data-tone={TONE[r.status]}>{FORMAT_LABEL[r.format]}{r.draft ? ' · draft' : ''}</span>
              <span>
                <span role="status">{exportStatusLabel(store, r)}</span>
                {r.status === 'succeeded' && (
                  <>
                    {' '}<a href={r.artifact.localUrl} download={r.artifact.filename}>{r.artifact.filename}</a>
                    <span className={styles.muted}> · {r.artifact.mimeType}</span>
                    {r.format === 'pdf' && shown?.exportId !== r.exportId && <>{' '}<Button size="sm" variant="ghost" onClick={() => setPreviewId(r.exportId)}>Preview</Button></>}
                  </>
                )}
                {r.status === 'failed' && (
                  <>
                    {' '}<Button size="sm" variant="outline" onClick={() => void run(retryRequest(controls.readExports(), r.exportId))}>Retry {FORMAT_LABEL[r.format]} of {versionLabel(store, r.revisionId)}</Button>
                  </>
                )}
                <span className={styles.code}> {r.exportId}{r.retryOf ? ` · retry of ${r.retryOf}` : ''} · {r.revisionId}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {shown && (
        <div className={styles.previewWell}>
          <PdfFilePreview key={shown.exportId} bytes={generated.get(shown.artifact.localUrl) ?? null} url={shown.artifact.localUrl} filename={shown.artifact.filename} label={`PDF preview (generated file, ${versionLabel(store, shown.revisionId)})`} />
        </div>
      )}
    </section>
  )
}
