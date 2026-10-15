'use client'

// Revision UI for the workbench: which revision is being viewed, the history
// (KDS VersionCard for each entry, with the full change summary, author,
// approval and ancestry beside it), a block-by-block comparison, and the
// sample proposals with before/after and Accept / Reject.

import React, { useMemo, useState } from 'react'

import { Button } from '@/components/Button'
import { VersionCard } from '@/components/VersionCard'
import { formatFieldValue } from '@/lib/documents/display'
import type { DocumentSnapshot, Field, TextRun } from '@/lib/documents/model'
import {
  approvalLabel,
  approvalOf,
  checkAncestry,
  compareSnapshots,
  getDocument,
  getRevision,
  history,
  previewProposal,
  versionLabel,
  type Proposal,
  type RevisionStore,
} from '@/lib/documents/revisions'

import styles from './workbench.module.css'

export const formatStamp = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC'
const formatDay = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso))

export function approvalText(store: RevisionStore, revisionId: string): string {
  return approvalLabel(store, revisionId, formatDay)
}

/** "Current" or "Viewing v{n} — not the current revision" (approved wording), plus the approval state. */
export function RevisionBar({ store, outputId, viewedId, onViewCurrent }: { store: RevisionStore; outputId: string; viewedId: string; onViewCurrent: () => void }) {
  const doc = getDocument(store, outputId)
  const isCurrent = doc.currentRevisionId === viewedId
  const ancestry = doc.kind === 'deck' ? checkAncestry(store, viewedId) : null
  return (
    <div className={styles.revisionBar} data-current={isCurrent} role="status">
      <span className={styles.pill} data-tone={isCurrent ? 'ready' : 'incomplete'}>
        {isCurrent ? `${versionLabel(store, viewedId)} · Current` : `Viewing ${versionLabel(store, viewedId)} — not the current revision`}
      </span>
      <span className={styles.pill} data-tone="neutral">{approvalText(store, viewedId)}</span>
      {ancestry && <span className={styles.pill} data-tone={ancestry.status === 'current' ? 'ready' : ancestry.status === 'stale' ? 'incomplete' : 'invalid'}>{ancestry.label}</span>}
      {!isCurrent && <Button variant="outline" size="sm" onClick={onViewCurrent}>View current ({versionLabel(store, doc.currentRevisionId)})</Button>}
    </div>
  )
}

export function HistoryPanel({ store, outputId, viewedId, onView, onRestore, onApprove }: {
  store: RevisionStore
  outputId: string
  viewedId: string
  onView: (revisionId: string) => void
  onRestore: (revisionId: string) => void
  onApprove: (revisionId: string) => void
}) {
  const doc = getDocument(store, outputId)
  const revisions = history(store, outputId).slice().reverse()
  return (
    <section className={styles.panel} aria-labelledby="history-title">
      <h2 id="history-title" className={styles.panelTitle}>Revision history ({revisions.length})</h2>
      <p className={styles.muted} style={{ marginTop: 0 }}>Newest first. Restoring creates a new revision; nothing here is deleted or rewritten. In memory only — reloading resets the demo (browser storage arrives in Step 6).</p>
      <ol className={styles.historyList}>
        {revisions.map((rev) => {
          const current = rev.revisionId === doc.currentRevisionId
          const label = versionLabel(store, rev.revisionId)
          const parent = rev.parentRevisionId ? versionLabel(store, rev.parentRevisionId) : null
          const ancestry = doc.kind === 'deck' ? checkAncestry(store, rev.revisionId) : null
          return (
            <li key={rev.revisionId} className={styles.historyItem} data-viewing={rev.revisionId === viewedId || undefined}>
              <VersionCard variant={current ? 'default' : 'restore'} personaName={label} timestamp={formatStamp(rev.createdAt)} onRestore={() => onRestore(rev.revisionId)} />
              <div className={styles.historyDetail}>
                <p className={styles.historySummary}>{rev.changeSummary}</p>
                <p className={styles.muted}>{rev.author.name}{parent ? ` · from ${parent}` : ' · first revision'} · <span className={styles.code}>{rev.revisionId}</span></p>
                <p className={styles.muted}>{approvalText(store, rev.revisionId)}</p>
                {ancestry && <p className={styles.muted}>{ancestry.label}</p>}
                <div className={styles.toolbar}>
                  <Button variant={rev.revisionId === viewedId ? 'secondary' : 'ghost'} size="sm" aria-pressed={rev.revisionId === viewedId} onClick={() => onView(rev.revisionId)}>
                    {rev.revisionId === viewedId ? `Viewing ${label}` : `View ${label}`}
                  </Button>
                  {!approvalOf(store, rev.revisionId) && (
                    <Button variant="ghost" size="sm" onClick={() => onApprove(rev.revisionId)}>Mark {label} approved (sample)</Button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function fieldText(f: Field | undefined, locale: string): string {
  if (!f) return '—'
  if (f.state.status === 'provided') return formatFieldValue(f.state.value, locale, f)
  return f.state.status === 'missing' ? 'Missing' : 'Not applicable'
}

/** Compares the viewed revision with another revision of the same document, block by block. */
export function ComparePanel({ store, outputId, viewedId }: { store: RevisionStore; outputId: string; viewedId: string }) {
  const revisions = history(store, outputId)
  const [otherId, setOtherId] = useState<string>(() => revisions.find((r) => r.revisionId !== viewedId)?.revisionId ?? viewedId)
  const other = revisions.some((r) => r.revisionId === otherId) ? otherId : revisions[0].revisionId
  const a = getRevision(store, other).snapshot
  const b = getRevision(store, viewedId).snapshot
  const cmp = useMemo(() => compareSnapshots(a, b), [a, b])
  if (revisions.length < 2) return null
  return (
    <section className={styles.panel} aria-labelledby="compare-title">
      <h2 id="compare-title" className={styles.panelTitle}>Compare revisions</h2>
      <label className={styles.label} htmlFor="compare-select">Compare {versionLabel(store, viewedId)} with</label>
      <select id="compare-select" className={styles.select} value={other} onChange={(e) => setOtherId(e.target.value)}>
        {revisions.filter((r) => r.revisionId !== viewedId).map((r) => <option key={r.revisionId} value={r.revisionId}>{versionLabel(store, r.revisionId)} — {r.changeSummary}</option>)}
      </select>
      <ul className={styles.compareList}>
        <li><strong>Changed fields ({cmp.changedFields.length}):</strong> {cmp.changedFields.length ? cmp.changedFields.map((id) => `${a.fields[id]?.label ?? id}: “${fieldText(a.fields[id], a.locale)}” → “${fieldText(b.fields[id], b.locale)}”`).join('; ') : 'none'}</li>
        <li><strong>Changed blocks ({cmp.changedBlocks.length}):</strong> {cmp.changedBlocks.length ? cmp.changedBlocks.join(', ') : 'none'}</li>
        <li><strong>Unchanged blocks ({cmp.unchangedBlocks.length}):</strong> identical saved content{cmp.unchangedBlocks.length ? ` — ${cmp.unchangedBlocks.join(', ')}` : ''}</li>
        <li><strong>Issuer brand:</strong> {cmp.brandUnchanged ? 'unchanged' : 'changed'} · <strong>Layout:</strong> {cmp.layoutUnchanged ? 'unchanged' : 'changed'}</li>
      </ul>
      {cmp.changedBlocks.includes('blk-lines') && <p className={styles.muted}>Totals are derived from the line items, so they follow this change.</p>}
    </section>
  )
}

function runsText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join('')
}

/** Text of whatever a proposal changes, before and after. */
function proposalDiff(before: DocumentSnapshot, after: DocumentSnapshot): { label: string; before: string; after: string }[] {
  const cmp = compareSnapshots(before, after)
  const out = cmp.changedFields.map((id) => ({ label: before.fields[id]?.label ?? id, before: fieldText(before.fields[id], before.locale), after: fieldText(after.fields[id], after.locale) }))
  for (const id of cmp.changedBlocks) {
    const a = before.blocks.find((x) => x.id === id)
    const b = after.blocks.find((x) => x.id === id)
    if (a?.type === 'paragraph' && b?.type === 'paragraph') out.push({ label: id, before: runsText(a.runs), after: runsText(b.runs) })
  }
  return out
}

export type ProposalState = { kind: 'open' } | { kind: 'accepted'; message: string } | { kind: 'rejected' } | { kind: 'refused'; message: string }

export function ProposalPanel({ store, proposal, state, onAccept, onReject }: { store: RevisionStore; proposal: Proposal; state: ProposalState; onAccept: () => void; onReject: () => void }) {
  const preview = useMemo(() => {
    try { return { ok: true as const, ...previewProposal(store, proposal) } } catch (e) { return { ok: false as const, message: (e as Error).message } }
  }, [store, proposal])
  const doc = getDocument(store, proposal.outputId)
  const stale = doc.currentRevisionId !== proposal.baseRevisionId
  return (
    <section className={styles.panel} aria-labelledby="proposal-title">
      <h2 id="proposal-title" className={styles.panelTitle}>Proposed edit (sample): {proposal.title}</h2>
      <p className={styles.muted} style={{ marginTop: 0 }}>Fictional sample proposal, written against {versionLabel(store, proposal.baseRevisionId)}. It is not part of the document until accepted.</p>
      {preview.ok
        ? (
          <dl className={styles.diffList}>
            {proposalDiff(preview.before, preview.after).map((d) => (
              <div key={d.label} className={styles.diffRow}>
                <dt>{d.label}</dt>
                <dd><span className={styles.diffLabel}>Before</span> {d.before}</dd>
                <dd><span className={styles.diffLabel}>After</span> {d.after}</dd>
              </div>
            ))}
          </dl>
        )
        : <p className={styles.formError} role="alert">{preview.message}</p>}
      {state.kind === 'accepted' && <p className={styles.muted} role="status">{state.message}</p>}
      {state.kind === 'rejected' && <p className={styles.muted} role="status">Rejected — nothing changed.</p>}
      {state.kind === 'refused' && <p className={styles.formError} role="alert">{state.message}</p>}
      {state.kind === 'open' && !stale && (
        <div className={styles.toolbar}>
          <Button size="sm" onClick={onAccept} disabled={!preview.ok}>Accept as new revision</Button>
          <Button variant="ghost" size="sm" onClick={onReject}>Reject</Button>
        </div>
      )}
      {state.kind === 'open' && stale && <p className={styles.muted}>The document has moved on since {versionLabel(store, proposal.baseRevisionId)}, so this proposal can no longer be accepted.</p>}
    </section>
  )
}
