'use client'

// One saved revision, inline in the chat: its version, how ready it is, the
// rendered pages, what is still not provided, and downloads of exactly this
// revision. A drafting card shows the same frame filling in while the model
// writes; it has no version and nothing can be downloaded from it.

import React, { useMemo, useState } from 'react'

import { Button } from '@/components/Button'
import { DocumentPreview } from '@/components/documents/DocumentPreview'
import { composeDocument } from '@/lib/documents/compose'
import { capability, FORMAT_LABEL, formatsFor } from '@/lib/documents/export/capabilities'
import { INVOICE_FIELDS } from '@/lib/documents/invoice'
import type { DocumentSnapshot, ExportFormat } from '@/lib/documents/model'
import { validateSnapshot } from '@/lib/documents/validation'

import styles from './chat.module.css'

export type DownloadState = { format: ExportFormat; status: 'working' } | { format: ExportFormat; status: 'failed'; message: string } | null

/** Rates that only matter once their applicability is known to be "applies". */
const RATE_OF: Readonly<Record<string, { applicability: string; on: string }>> = {
  [INVOICE_FIELDS.taxRate]: { applicability: INVOICE_FIELDS.taxApplicability, on: 'applicable' },
  [INVOICE_FIELDS.discountRate]: { applicability: INVOICE_FIELDS.discountApplicability, on: 'percent' },
}

/**
 * Labels of the facts still missing: required fields, then line items with no description.
 * A rate is left out until its applicability says it applies, so the list asks for one thing at a time.
 */
export function notProvided(snapshot: DocumentSnapshot): string[] {
  const applies = (id: string) => {
    const rate = RATE_OF[id]
    if (!rate) return true
    const state = snapshot.fields[rate.applicability]?.state
    return state?.status === 'provided' && state.value.type === 'choice' && state.value.option === rate.on
  }
  const fields = snapshot.fieldOrder.filter((id) => snapshot.fields[id].required && snapshot.fields[id].state.status === 'missing' && applies(id)).map((id) => snapshot.fields[id].label)
  const items = snapshot.blocks.flatMap((b) => (b.type === 'line-items' ? b.items : []))
  const lines = items.flatMap((item, i) => (item.description === null ? [`Line ${i + 1} description`] : []))
  return [...fields, ...lines]
}

export function ReadinessChip({ snapshot }: { snapshot: DocumentSnapshot }) {
  const report = validateSnapshot(snapshot)
  if (report.readiness === 'ready') return <span className={styles.chipReady}>Ready to send</span>
  const missing = notProvided(snapshot).length
  return <span className={styles.chipDraft}>{missing > 0 ? `Draft · ${missing} missing` : 'Draft'}</span>
}

export function DocumentCard({ snapshot, title, version, current, onDownload, download }: {
  snapshot: DocumentSnapshot
  title: string
  version: number
  /** The latest revision of its document; older ones are shown collapsed. */
  current: boolean
  onDownload: (format: ExportFormat) => void
  download: DownloadState
}) {
  // The latest version is always open; older ones open only when asked.
  const [expanded, setExpanded] = useState(false)
  const open = current || expanded
  const plan = useMemo(() => composeDocument(snapshot, { audience: 'recipient' }), [snapshot])
  const missing = useMemo(() => notProvided(snapshot), [snapshot])
  const formats = formatsFor(snapshot.kind).filter((format) => capability(snapshot.kind, format).supported)

  return (
    <article className={styles.card} aria-label={`${title}, version ${version}`} data-current={current}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>{title}</h2>
          <span className={styles.version}>v{version}</span>
          <ReadinessChip snapshot={snapshot} />
        </div>
        {!current && (
          <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setExpanded((o) => !o)}>
            {open ? 'Hide' : 'Show'} v{version}
          </button>
        )}
      </header>
      {open && (
        <>
          <div className={styles.paper}>
            <DocumentPreview plan={plan} />
          </div>
          {missing.length > 0 && (
            <div className={styles.missing}>
              <p className={styles.missingTitle}>Not provided yet</p>
              <p className={styles.missingList}>{missing.join(' · ')}</p>
            </div>
          )}
          <div className={styles.actions}>
            {formats.map((format) => {
              const working = download?.format === format && download.status === 'working'
              return (
                <Button key={format} variant={format === 'pdf' ? 'default' : 'secondary'} size="sm" loading={working} disabled={download?.status === 'working'} onClick={() => onDownload(format)}>
                  Download {FORMAT_LABEL[format]}
                </Button>
              )
            })}
            {download?.status === 'failed' && <p className={styles.downloadError} role="alert">{FORMAT_LABEL[download.format]} download failed: {download.message}</p>}
          </div>
        </>
      )}
    </article>
  )
}

/** The card while the model writes: a page skeleton, then the draft as operations arrive. */
export function DraftingCard({ snapshot, label, applied }: { snapshot: DocumentSnapshot; label: string; applied: number }) {
  const plan = useMemo(() => composeDocument(snapshot, { audience: 'recipient' }), [snapshot])
  return (
    <article className={styles.card} aria-busy="true" aria-label={label}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>
            <span className={styles.pulseDot} aria-hidden="true" />
            {label}
          </h2>
        </div>
      </header>
      <div className={styles.paper} data-drafting="true">
        {applied === 0 ? <PageSkeleton /> : <DocumentPreview plan={plan} />}
      </div>
    </article>
  )
}

function PageSkeleton() {
  return (
    <div className={styles.skeletonPage} role="presentation">
      <div className={styles.skelTitle} />
      <div className={styles.skelRow}>
        <div className={styles.skelField} /><div className={styles.skelField} /><div className={styles.skelField} />
      </div>
      <div className={styles.skelRow}>
        <div className={styles.skelBlock} /><div className={styles.skelBlock} />
      </div>
      <div className={styles.skelTable}>
        <div className={styles.skelLine} /><div className={styles.skelLine} /><div className={styles.skelLine} />
      </div>
      <div className={styles.skelTotals}>
        <div className={styles.skelLine} /><div className={styles.skelLine} />
      </div>
    </div>
  )
}
