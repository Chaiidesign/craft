'use client'

// Export panel: one button per format the document kind supports (unsupported
// formats are shown disabled with their reason), the draft warning, per-format
// records with their own status, cancel, retry and export-again, and the
// generated PDF itself. Every export targets the revision being viewed, fixed
// when it starts. Announcements and the preview switch follow the stored
// record (exportRunner.ts), so a cancelled job's late result stays silent.

import React, { useState } from 'react'

import { Button } from '@/components/Button'
import { browserExportResources } from '@/components/documents/exportResources'
import { PdfFilePreview } from '@/components/documents/PdfFilePreview'
import { FORCED_VIEWER_FAILURE } from '@/components/documents/viewerOpen'
import { ADAPTERS, forcedRendererFailure } from '@/lib/documents/export/adapters'
import { capability, formatsFor, FORMAT_LABEL } from '@/lib/documents/export/capabilities'
import { cancelExport, exportAgainRequest, ExportJobError, formatSize, retryRequest, type StartRequest } from '@/lib/documents/export/jobs'
import type { DocumentEnv, ExportFormat, ExportRecord } from '@/lib/documents/model'
import { getDocument, getRevision, versionLabel, type RevisionStore } from '@/lib/documents/revisions'

import { exportStatusLabel, runExport, type ExportControls } from './exportRunner'
import styles from './workbench.module.css'

export { exportStatusLabel, type ExportControls }

/** Generated files by their object URL, so the PDF preview reads the bytes themselves (the app's CSP blocks fetching blob: URLs). */
const generated = new Map<string, Uint8Array>()
const objectUrl = (bytes: Uint8Array, mimeType: string) => {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mimeType }))
  generated.set(url, bytes)
  return url
}

/** Deliberate, labelled faults for one scenario only. */
export interface ForcedFaults {
  scenario: 9 | 11
  /** Formats whose renderer is made to fail. */
  formats: ReadonlySet<ExportFormat>
  /** Make the PDF viewer fail (scenario 11). */
  viewer?: boolean
}

const TONE: Record<ExportRecord['status'], string> = { pending: 'neutral', succeeded: 'ready', failed: 'invalid', unsupported: 'neutral', expired: 'neutral' }

export function ExportPanel({ store, env, outputId, revisionId, controls, forced, onAnnounce, onShowHtml }: {
  store: RevisionStore
  env: DocumentEnv
  outputId: string
  revisionId: string
  controls: ExportControls
  forced?: ForcedFaults
  onAnnounce?: (message: string) => void
  /** Offered when the PDF viewer fails. */
  onShowHtml?: () => void
}) {
  const doc = getDocument(store, outputId)
  const revision = getRevision(store, revisionId)
  const v = versionLabel(store, revisionId)
  const [confirming, setConfirming] = useState<ExportFormat | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const run = async (req: StartRequest) => {
    setRefusal(null)
    const result = await runExport({
      controls, env, store, req,
      resources: browserExportResources,
      localUrl: objectUrl,
      forceFailure: forced?.formats.has(req.format) ? forcedRendererFailure(forced.scenario) : undefined,
      announce: onAnnounce,
      onPdfReady: setPreviewId,
    })
    if ('refusal' in result) setRefusal(result.refusal)
  }

  const cancel = (exportId: string) => {
    try {
      controls.updateExports((s) => cancelExport(s, env, exportId))
      onAnnounce?.(exportStatusLabel(store, controls.readExports().records.find((r) => r.exportId === exportId)!))
    } catch (e) {
      if (e instanceof ExportJobError) setRefusal(e.message)
      else throw e
    }
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
    <section className={styles.panel} aria-labelledby={`export-title-${outputId}`}>
      <h2 id={`export-title-${outputId}`} className={styles.panelTitle}>Export {v}</h2>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        Files are made in this browser from the revision you are viewing ({v}), fixed when the export starts. Approval is not export, and export is not sending.
      </p>
      <div className={styles.toolbar} role="group" aria-label="Export formats">
        {formatsFor(doc.kind).map((format) => {
          const cap = capability(doc.kind, format)
          const pending = controls.exports.records.some((r) => r.status === 'pending' && r.revisionId === revisionId && r.format === format)
          return (
            <span key={format} className={styles.exportFormat}>
              <Button size="sm" variant={cap.supported ? 'outline' : 'ghost'} disabled={!cap.supported || pending} onClick={() => click(format)} aria-describedby={cap.supported ? undefined : `export-reason-${outputId}-${format}`}>
                Export {FORMAT_LABEL[format]}
              </Button>
              {!cap.supported && <span id={`export-reason-${outputId}-${format}`} className={styles.muted}>{cap.reason}</span>}
              {forced?.formats.has(format) && <span className={styles.pill} data-tone="invalid">Forced failure (scenario {forced.scenario} only)</span>}
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
                {r.status === 'pending' && (
                  <>{' '}<Button size="sm" variant="ghost" onClick={() => cancel(r.exportId)}>Cancel</Button></>
                )}
                {r.status === 'succeeded' && (
                  <>
                    {' '}<a href={r.artifact.localUrl} download={r.artifact.filename}>{r.artifact.filename}</a>
                    <span className={styles.muted}> · {r.artifact.mimeType}</span>
                    {r.format === 'pdf' && shown?.exportId !== r.exportId && <>{' '}<Button size="sm" variant="ghost" onClick={() => setPreviewId(r.exportId)}>Preview</Button></>}
                  </>
                )}
                {r.status === 'expired' && (
                  <>
                    {' '}<span className={styles.muted}>{r.artifact.filename} · {formatSize(r.artifact.byteSize)}</span>
                    {' '}<Button size="sm" variant="outline" onClick={() => void run(exportAgainRequest(controls.readExports(), r.exportId))}>Export again</Button>
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
          <PdfFilePreview
            key={`${shown.exportId}${forced?.viewer ? ':forced-viewer' : ''}`}
            bytes={generated.get(shown.artifact.localUrl) ?? null}
            url={shown.artifact.localUrl}
            filename={shown.artifact.filename}
            size={formatSize(shown.artifact.byteSize)}
            label={`PDF preview (generated file, ${versionLabel(store, shown.revisionId)})`}
            forceFailure={forced?.viewer ? FORCED_VIEWER_FAILURE : undefined}
            onShowHtml={onShowHtml}
          />
        </div>
      )}
    </section>
  )
}
