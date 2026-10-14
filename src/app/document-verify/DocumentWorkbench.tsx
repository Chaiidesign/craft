'use client'

// Document-quality workbench.
//
// Step 1: fixture inspector — typed fields, validation and derived totals
// exactly as the model holds them.
// Step 2: document tokens, primitives and templates.
// Step 3: the preview is laid out with real font metrics and paginated by meaning.
// Step 4: every document lives in an in-memory revision store. Panels show the
// revision being viewed; bounded edits, proposals and restores create new
// revisions; scenarios 5–8 run against real revisions. Reloading resets the
// store (browser storage arrives in Step 6).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { DeckPreview, deckChecks } from '@/components/documents/DeckPreview'
import { DocumentPreview, type PreviewState } from '@/components/documents/DocumentPreview'
import { composeDocument, type Audience } from '@/lib/documents/compose'
import { deriveDeck } from '@/lib/documents/deck'
import { describeFieldState } from '@/lib/documents/display'
import { FIXTURES, getFixture, SAMPLE_LABEL, type Fixture } from '@/lib/documents/fixtures'
import { outputIdFor, PROPOSAL_TEMPLATES, proposalFrom, SAMPLE_REVIEWER } from '@/lib/documents/fixtures/revisions'
import { computeInvoiceTotals, type Amount } from '@/lib/documents/invoice'
import type { DeckLayout } from '@/lib/documents/layout/slides'
import type { Block, BriefSnapshot, DeckSnapshot, DocumentEnv, DocumentSnapshot, InvoiceSnapshot } from '@/lib/documents/model'
import { formatMoney, formatQuantity } from '@/lib/documents/money'
import {
  acceptProposal,
  BRAND_OWNED_FIELDS,
  checkAncestry,
  createDocument,
  currentRevision,
  deriveDeckRevision,
  emptyStore,
  getDocument,
  getRevision,
  history,
  markApproved,
  rejectProposal,
  restoreRevision,
  RevisionError,
  saveEdit,
  versionLabel,
  type BoundedEdit,
  type RevisionStore,
} from '@/lib/documents/revisions'
import { resolveTheme } from '@/lib/documents/theme'
import { validateSnapshot, type Readiness, type ValidationIssue } from '@/lib/documents/validation'

import { FieldEditor, LineItemEditor, TextEditor, textTargets, type SaveEdit } from './Editors'
import { ComparePanel, HistoryPanel, ProposalPanel, RevisionBar, type ProposalState } from './RevisionPanels'
import { runApprovedThenEdited, runBoundedEdit, runRestore, type ScenarioCheck } from './scenarios'
import styles from './workbench.module.css'

const READINESS_LABEL: Record<Readiness, string> = {
  ready: 'Ready — all required facts supplied',
  incomplete: 'Incomplete — required facts missing',
  invalid: 'Invalid — values need correcting',
}

const SEVERITY_LABEL: Record<ValidationIssue['severity'], string> = {
  error: 'Error',
  missing: 'Missing',
  warning: 'Warning',
}

const STEP_LABEL = { 'step-3': 'Step 3', 'step-4': 'Step 4', 'step-5': 'Step 5', 'step-6': 'Step 6' } as const
const RUNNABLE_NOW = new Set(['step-3', 'step-4'])

const documentFixtures = FIXTURES.filter((f) => f.type === 'document')
const scenarioFixtures = FIXTURES.filter((f) => f.type === 'scenario')

/** Real clock and unique IDs for the interactive workbench (tests use fixedEnv). */
function workbenchEnv(): DocumentEnv {
  let n = 0
  const session = Date.now().toString(36)
  return { now: () => new Date().toISOString(), nextId: (prefix) => `${prefix}-${session}-${String(++n).padStart(3, '0')}` }
}

function initialStore(env: DocumentEnv): RevisionStore {
  let store = emptyStore()
  for (const f of documentFixtures) {
    if (f.type !== 'document') continue
    store = createDocument(store, env, f.build(), { outputId: outputIdFor(f.id) }).store
  }
  return store
}

interface Workbench {
  store: RevisionStore
  env: DocumentEnv
  viewing: Readonly<Record<string, string>>
  deckId: string | null
  view: (outputId: string, revisionId: string | null) => void
  commit: (store: RevisionStore, message: string) => void
  setDeckId: (id: string) => void
}

export function DocumentWorkbench() {
  const [fixtureId, setFixtureId] = useState(FIXTURES[0].id)
  const fixture = getFixture(fixtureId) ?? FIXTURES[0]
  const [env] = useState(workbenchEnv)
  const [store, setStore] = useState(() => initialStore(env))
  const [viewing, setViewing] = useState<Record<string, string>>({})
  const [deckId, setDeckId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const wb: Workbench = {
    store, env, viewing, deckId, setDeckId,
    view: (outputId, revisionId) => setViewing((v) => {
      const next = { ...v }
      if (revisionId) next[outputId] = revisionId
      else delete next[outputId]
      return next
    }),
    commit: (next, message) => { setStore(next); setAnnouncement(message) },
  }

  const select = (id: string) => {
    setFixtureId(id)
    const next = getFixture(id)
    if (next) setAnnouncement(`Showing fixture ${next.prdNumber}: ${next.title}.`)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1 className={styles.title}>Document quality workbench</h1>
          <p className={styles.subtitle}>Prototype. Fixtures and local state only — no backend, AI, auth or sending.</p>
          <span className={styles.sampleTag}>{SAMPLE_LABEL}</span>
        </div>
      </header>

      <div className={styles.layout}>
        <FixturePicker fixtureId={fixture.id} onSelect={select} />
        <main className={styles.main} aria-labelledby="fixture-title">
          {fixture.type === 'scenario'
            ? <ScenarioInspector key={fixture.id} fixture={fixture} wb={wb} onOpenFixture={select} />
            : <DocumentInspector key={fixture.id} fixture={fixture} wb={wb} onOpenFixture={select} />}
        </main>
      </div>

      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </div>
  )
}

// ── Picker ──────────────────────────────────────────────────────────────────

function FixturePicker({ fixtureId, onSelect }: { fixtureId: string; onSelect: (id: string) => void }) {
  const optionLabel = (f: Fixture) => `${f.prdNumber}. ${f.title}`
  return (
    <nav aria-label="Fixtures">
      <div className={styles.pickerSelect}>
        <label className={styles.label} htmlFor="fixture-select">Fixture</label>
        <select id="fixture-select" className={styles.select} value={fixtureId} onChange={(e) => onSelect(e.target.value)}>
          <optgroup label="Documents">
            {documentFixtures.map((f) => <option key={f.id} value={f.id}>{optionLabel(f)}</option>)}
          </optgroup>
          <optgroup label="Scenarios">
            {scenarioFixtures.map((f) => <option key={f.id} value={f.id}>{optionLabel(f)}</option>)}
          </optgroup>
        </select>
      </div>

      <div className={styles.pickerList}>
        <FixtureGroup heading="Documents" fixtures={documentFixtures} fixtureId={fixtureId} onSelect={onSelect} />
        <FixtureGroup heading="Scenarios" fixtures={scenarioFixtures} fixtureId={fixtureId} onSelect={onSelect} />
      </div>
    </nav>
  )
}

function FixtureGroup({ heading, fixtures, fixtureId, onSelect }: { heading: string; fixtures: readonly Fixture[]; fixtureId: string; onSelect: (id: string) => void }) {
  const headingId = `fixture-group-${heading.toLowerCase()}`
  return (
    <>
      <h2 id={headingId} className={styles.groupHeading}>{heading}</h2>
      <ul className={styles.fixtureList} aria-labelledby={headingId}>
        {fixtures.map((f) => (
          <li key={f.id}>
            <button type="button" className={styles.fixtureButton} aria-current={f.id === fixtureId ? 'true' : undefined} onClick={() => onSelect(f.id)}>
              <span className={styles.fixtureNumber} aria-hidden="true">{f.prdNumber}</span>
              <span>
                <span className={styles.srOnly}>Fixture {f.prdNumber}: </span>
                {f.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── Document fixture ────────────────────────────────────────────────────────

function DocumentInspector({ fixture, wb, onOpenFixture }: { fixture: Fixture; wb: Workbench; onOpenFixture: (id: string) => void }) {
  const outputId = outputIdFor(fixture.id)
  const doc = getDocument(wb.store, outputId)
  const viewedId = wb.viewing[outputId] && doc.revisionIds.includes(wb.viewing[outputId]) ? wb.viewing[outputId] : doc.currentRevisionId
  const viewed = getRevision(wb.store, viewedId)
  const snapshot = viewed.snapshot
  const isCurrent = viewedId === doc.currentRevisionId
  const canEdit = isCurrent && snapshot.kind !== 'deck'

  const report = useMemo(() => validateSnapshot(snapshot), [snapshot])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [proposalState, setProposalState] = useState<ProposalState>({ kind: 'open' })
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!highlighted) return
    const timer = window.setTimeout(() => setHighlighted(null), 1600)
    return () => window.clearTimeout(timer)
  }, [highlighted])

  const goToField = (fieldId: string) => {
    const row = rowRefs.current.get(fieldId)
    if (!row) return
    row.focus()
    row.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setHighlighted(fieldId)
  }

  /** Runs a revision operation; a refused one comes back as its message, nothing changes. */
  const attempt = (op: () => { store: RevisionStore; revisionId?: string; message: string }): string | null => {
    try {
      const { store, message } = op()
      wb.commit(store, message)
      wb.view(outputId, null)
      return null
    } catch (e) {
      if (e instanceof RevisionError) return e.message
      throw e
    }
  }

  const save: SaveEdit = (edit: BoundedEdit) => attempt(() => {
    const { store, revision } = saveEdit(wb.store, wb.env, outputId, doc.currentRevisionId, edit)
    return { store, message: `Saved ${versionLabel(store, revision.revisionId)}: ${revision.changeSummary}.` }
  })

  const [opError, setOpError] = useState<string | null>(null)
  const restore = (revisionId: string) => setOpError(attempt(() => {
    const { store, revision } = restoreRevision(wb.store, wb.env, outputId, revisionId)
    return { store, message: `Saved ${versionLabel(store, revision.revisionId)}: ${revision.changeSummary}.` }
  }))
  const approve = (revisionId: string) => {
    try {
      const store = markApproved(wb.store, wb.env, revisionId, SAMPLE_REVIEWER)
      wb.commit(store, `${versionLabel(store, revisionId)} marked approved (sample).`)
      setOpError(null)
    } catch (e) {
      if (e instanceof RevisionError) setOpError(e.message)
      else throw e
    }
  }

  const template = PROPOSAL_TEMPLATES.find((t) => t.fixtureId === fixture.id)
  const proposal = useMemo(() => (template ? proposalFrom(template, outputId, doc.revisionIds[0]) : null), [template, outputId, doc.revisionIds])

  const scenarios = scenarioFixtures.filter((s) => s.type === 'scenario' && s.baseFixtureId === fixture.id)
  const targets = useMemo(() => textTargets(snapshot), [snapshot])

  return (
    <>
      <section className={styles.panel} aria-labelledby="fixture-title">
        <h2 id="fixture-title" className={styles.fixtureTitle}>{fixture.title}</h2>
        <p className={styles.muted}>Fixture {fixture.prdNumber} · {fixture.purpose}</p>
        <div className={styles.metaRow}>
          <span className={styles.pill} data-tone={report.readiness}>{READINESS_LABEL[report.readiness]}</span>
          <span className={styles.pill} data-tone="neutral">{snapshot.templateId}</span>
          <span className={styles.pill} data-tone="neutral">{snapshot.locale}</span>
          <span className={styles.pill} data-tone="neutral">{snapshot.layoutPreset}</span>
        </div>
        <RevisionBar store={wb.store} outputId={outputId} viewedId={viewedId} onViewCurrent={() => wb.view(outputId, null)} />
        {!isCurrent && <p className={styles.muted}>Older revisions are read-only. To work from this one, restore it — that creates a new current revision.</p>}
        {scenarios.length > 0 && (
          <p className={styles.muted}>
            Used by:{' '}
            {scenarios.map((s, i) => (
              <React.Fragment key={s.id}>
                {i > 0 && ', '}
                <a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); onOpenFixture(s.id) }}>{s.title}</a>
              </React.Fragment>
            ))}
          </p>
        )}
      </section>

      <PreviewPanel snapshot={snapshot} />

      <section className={styles.panel} aria-labelledby="issues-title">
        <h2 id="issues-title" className={styles.panelTitle}>Issues ({report.issues.length})</h2>
        {report.issues.length === 0
          ? <p className={styles.muted}>No issues. Every required fact is supplied and valid.</p>
          : (
            <ul className={styles.issueList}>
              {report.issues.map((issue) => {
                const fieldId = issue.target.kind === 'field' ? issue.target.fieldId : null
                return (
                  <li key={issue.id}>
                    <button type="button" className={styles.issueButton} disabled={!fieldId} onClick={() => fieldId && goToField(fieldId)}>
                      <span className={styles.pill} data-tone={issue.severity === 'warning' ? 'neutral' : issue.severity === 'error' ? 'invalid' : 'incomplete'}>{SEVERITY_LABEL[issue.severity]}</span>
                      <span>
                        {issue.message}
                        {fieldId && <span className={styles.srOnly}> Go to field.</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
      </section>

      <section className={styles.panel} aria-labelledby="fields-title">
        <h2 id="fields-title" className={styles.panelTitle}>Fields ({snapshot.fieldOrder.length})</h2>
        {snapshot.fieldOrder.length === 0
          ? <p className={styles.muted}>This document has no fields. Nothing has been supplied yet, so there is nothing to show — this is deliberate, not a loading failure.</p>
          : (
            <div className={styles.fieldList} role="list">
              {snapshot.fieldOrder.map((fieldId) => {
                const field = snapshot.fields[fieldId]
                if (!field) return null
                const fieldReport = report.fields[fieldId]
                const shown = describeFieldState(field, snapshot.locale)
                const editing = editingField === fieldId
                return (
                  <div
                    key={fieldId}
                    role="listitem"
                    tabIndex={-1}
                    ref={(el) => { if (el) rowRefs.current.set(fieldId, el); else rowRefs.current.delete(fieldId) }}
                    className={styles.fieldRow}
                    data-status={field.state.status}
                    data-required={field.required}
                    data-severity={fieldReport?.severity ?? undefined}
                    data-highlight={highlighted === fieldId}
                    aria-label={`${field.label}: ${shown.text}`}
                  >
                    <div className={styles.fieldLabel}>
                      {field.label}
                      {!field.required && <span className={styles.muted}> (optional)</span>}
                      <div className={styles.code}>{fieldId}</div>
                    </div>
                    <div>
                      <p className={styles.fieldValue} data-status={shown.status}>{shown.text}</p>
                      {canEdit && BRAND_OWNED_FIELDS[fieldId] && <p className={styles.muted} style={{ margin: 0 }}>{BRAND_OWNED_FIELDS[fieldId]}</p>}
                      {canEdit && !BRAND_OWNED_FIELDS[fieldId] && field.state.status !== 'not-applicable' && !editing && (
                        <Button id={`edit-field-${fieldId}`} variant="ghost" size="sm" onClick={() => setEditingField(fieldId)} aria-label={`${field.state.status === 'missing' ? 'Fill' : 'Edit'} ${field.label}`}>
                          {field.state.status === 'missing' ? 'Fill' : 'Edit'}
                        </Button>
                      )}
                    </div>
                    {editing && (
                      <div className={styles.fieldEditor}>
                        <FieldEditor field={field} snapshot={snapshot} onSave={save} onClose={() => { setEditingField(null); returnFocus(`edit-field-${fieldId}`) }} />
                      </div>
                    )}
                    {fieldReport && fieldReport.messages.length > 0 && (
                      <ul className={styles.fieldMessages}>
                        {fieldReport.messages.map((message) => <li key={message}>{message}</li>)}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
      </section>

      {snapshot.kind === 'invoice' && <InvoiceAmounts snapshot={snapshot} canEdit={canEdit} onSave={save} />}

      {targets.length > 0 && <TextEditPanel snapshot={snapshot} canEdit={canEdit} onSave={save} />}

      {proposal && (
        <ProposalPanel
          store={wb.store}
          proposal={proposal}
          state={proposalState}
          onAccept={() => {
            let saved = ''
            const refused = attempt(() => {
              const { store, revision } = acceptProposal(wb.store, wb.env, proposal)
              saved = `Accepted — saved as ${versionLabel(store, revision.revisionId)}.`
              return { store, message: `Saved ${versionLabel(store, revision.revisionId)}: ${revision.changeSummary}.` }
            })
            setProposalState(refused ? { kind: 'refused', message: refused } : { kind: 'accepted', message: saved })
          }}
          onReject={() => {
            rejectProposal(wb.store, proposal)
            setProposalState({ kind: 'rejected' })
          }}
        />
      )}

      {opError && <p className={styles.formError} role="alert">{opError}</p>}
      <HistoryPanel store={wb.store} outputId={outputId} viewedId={viewedId} onView={(id) => wb.view(outputId, id)} onRestore={restore} onApprove={approve} />
      <ComparePanel key={viewedId} store={wb.store} outputId={outputId} viewedId={viewedId} />

      <section className={styles.panel} aria-labelledby="brand-title">
        <h2 id="brand-title" className={styles.panelTitle}>Issuer brand</h2>
        <div className={styles.fieldList}>
          <BrandRow label="Issuer display name" value={snapshot.brand.issuerDisplayName} />
          <BrandRow label="Logo" value={snapshot.brand.logo ? `${snapshot.brand.logo.src} (status claimed: ${snapshot.brand.assetStatus}; load check happens when rendering)` : 'None supplied — a labelled neutral fallback will be used'} />
          <BrandRow label="Profile" value={`${snapshot.brand.profileId} v${snapshot.brand.version}`} />
          <BrandRow label="Typography theme" value={describeTheme(snapshot.brand.themeId)} />
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="blocks-title">
        <h2 id="blocks-title" className={styles.panelTitle}>Block structure ({snapshot.blocks.length})</h2>
        {snapshot.blocks.length === 0
          ? <p className={styles.muted}>No blocks.</p>
          : <ol className={styles.blockOutline}>{snapshot.blocks.map((b) => <li key={b.id}><span className={styles.code}>{b.id}</span> — {describeBlock(b)}</li>)}</ol>}
        {snapshot.citations.length > 0 && (
          <>
            <h3 className={styles.groupHeading} style={{ marginTop: 16 }}>Sources ({snapshot.citations.length}, all fictional)</h3>
            <ol className={styles.blockOutline}>
              {snapshot.citations.map((c) => <li key={c.id}><span className={styles.code}>{c.id}</span> — {c.title}, {c.publisher}{c.date ? `, ${c.date}` : ''}</li>)}
            </ol>
          </>
        )}
        <div style={{ marginTop: 12 }}>
          <Button variant="outline" size="sm" aria-expanded={showJson} aria-controls="snapshot-json" onClick={() => setShowJson((v) => !v)}>
            {showJson ? 'Hide snapshot JSON' : 'Show snapshot JSON'}
          </Button>
        </div>
        {showJson && <pre id="snapshot-json" className={styles.json} tabIndex={0}>{JSON.stringify(snapshot, null, 2)}</pre>}
      </section>
    </>
  )
}

/** After an editor closes, return focus to the control that opened it (or the panel, if a save removed it). */
function returnFocus(id: string) {
  window.setTimeout(() => {
    const el = document.getElementById(id)
    if (el) el.focus()
  }, 0)
}

function describeTheme(themeId: string): string {
  const { theme, fellBack } = resolveTheme(themeId)
  return fellBack ? `“${themeId}” is not a known theme — using ${theme.label}` : `${theme.id} — ${theme.label}`
}

// ── Text edits ──────────────────────────────────────────────────────────────

function TextEditPanel({ snapshot, canEdit, onSave }: { snapshot: DocumentSnapshot; canEdit: boolean; onSave: SaveEdit }) {
  const targets = textTargets(snapshot)
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState(false)
  const target = targets[Math.min(selected, targets.length - 1)]
  return (
    <section className={styles.panel} aria-labelledby="text-edit-title">
      <h2 id="text-edit-title" className={styles.panelTitle}>Edit one sentence or list item</h2>
      {!canEdit
        ? <p className={styles.muted}>Only the current revision can be edited.</p>
        : editing
          ? <TextEditor key={`${target.blockId}:${target.item}:${target.run}`} target={target} onSave={onSave} onClose={() => { setEditing(false); returnFocus('edit-text-button') }} />
          : (
            <>
              <label className={styles.label} htmlFor="text-target">Sentence or list item</label>
              <select id="text-target" className={styles.select} value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
                {targets.map((t, i) => <option key={`${t.blockId}:${t.item}:${t.run}`} value={i}>{t.label}: {t.text.slice(0, 60)}{t.text.length > 60 ? '…' : ''}</option>)}
              </select>
              <div className={styles.toolbar}>
                <Button id="edit-text-button" variant="outline" size="sm" onClick={() => setEditing(true)}>Edit this text</Button>
              </div>
            </>
          )}
    </section>
  )
}

// ── Preview ─────────────────────────────────────────────────────────────────

function previewStatus(state: PreviewState): string {
  if (state.status === 'loading') return 'Loading document fonts and checking image files…'
  if (state.status === 'fonts-failed') return 'Document fonts failed to load — no preview rather than a fallback face.'
  const { paged } = state
  if (paged.status === 'empty') return 'Nothing to lay out.'
  if (paged.status === 'error') return 'Layout refused — see the message below.'
  const n = paged.pages.length
  return `${n} page${n === 1 ? '' : 's'}, laid out with the committed document fonts.`
}

function PreviewPanel({ snapshot }: { snapshot: DocumentSnapshot }) {
  const [audience, setAudience] = useState<Audience>('recipient')
  const [preset, setPreset] = useState<'a4-portrait' | 'letter-portrait'>('a4-portrait')
  const [showHints, setShowHints] = useState(false)
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' })
  const onState = useCallback((s: PreviewState) => setPreviewState(s), [])
  const plan = useMemo(() => composeDocument(snapshot, { audience }), [snapshot, audience])

  return (
    <section className={styles.panel} aria-labelledby="preview-title">
      <h2 id="preview-title" className={styles.panelTitle}>Document preview</h2>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        Laid out from the viewed revision with the document fonts, tokens and primitives, and paginated by meaning. Not an export.
      </p>
      <div className={styles.toolbar} role="group" aria-label="Audience">
        <Button variant={audience === 'recipient' ? 'secondary' : 'ghost'} size="sm" aria-pressed={audience === 'recipient'} onClick={() => setAudience('recipient')}>
          Recipient view
        </Button>
        <Button variant={audience === 'internal' ? 'secondary' : 'ghost'} size="sm" aria-pressed={audience === 'internal'} onClick={() => setAudience('internal')}>
          Include internal notes
        </Button>
      </div>
      <div className={styles.toolbar} role="group" aria-label="Page size and hints">
        <Button variant={preset === 'a4-portrait' ? 'secondary' : 'ghost'} size="sm" aria-pressed={preset === 'a4-portrait'} onClick={() => setPreset('a4-portrait')}>
          A4
        </Button>
        <Button variant={preset === 'letter-portrait' ? 'secondary' : 'ghost'} size="sm" aria-pressed={preset === 'letter-portrait'} onClick={() => setPreset('letter-portrait')}>
          Letter
        </Button>
        <Button variant={showHints ? 'secondary' : 'ghost'} size="sm" aria-pressed={showHints} onClick={() => setShowHints((v) => !v)}>
          Show page-break reasons
        </Button>
      </div>
      <p className={styles.muted} role="status" data-preview-status={previewState.status === 'laid-out' ? previewState.paged.status : previewState.status}>
        {previewStatus(previewState)}
      </p>
      {plan.excludedBlocks.length > 0 && (
        <p className={styles.muted}>
          Left out of this view: {plan.excludedBlocks.map((b) => `${b.blockId} — ${b.reason}`).join(' ')}
        </p>
      )}
      <div className={styles.previewWell}>
        <DocumentPreview plan={plan} preset={preset} showHints={showHints} onState={onState} />
      </div>
    </section>
  )
}

function BrandRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldLabel}>{label}</div>
      <p className={styles.fieldValue}>{value}</p>
    </div>
  )
}

function describeBlock(block: Block): string {
  switch (block.type) {
    case 'heading': return `Heading (level ${block.level}): “${block.text}”`
    case 'paragraph': return `Paragraph${block.role && block.role !== 'body' ? ` (${block.role})` : ''}, ${block.runs.reduce((n, r) => n + (r.citationIds?.length ?? 0), 0)} citation marker(s)`
    case 'list': return `${block.ordered ? 'Numbered' : 'Bulleted'} list, ${block.items.length} items`
    case 'field-group': return `Field group “${block.title ?? 'Untitled'}”: ${block.fieldIds.length} field${block.fieldIds.length === 1 ? '' : 's'}`
    case 'table': return `Table, ${block.rows.length} rows`
    case 'line-items': return `Line items, ${block.items.length} rows`
    case 'totals': return `Totals (derived from ${block.lineItemsBlockId})`
    case 'image': return `Image: ${block.asset.alt}`
    case 'chart': return `Chart (${block.chartType}): ${block.title}`
    case 'callout': return `Callout (${block.tone}, ${block.audience === 'internal' ? 'internal — excluded from exports' : 'for recipient'})`
    case 'source-list': return 'Source list'
  }
}

// ── Invoice amounts ─────────────────────────────────────────────────────────

function InvoiceAmounts({ snapshot, canEdit, onSave }: { snapshot: InvoiceSnapshot; canEdit: boolean; onSave: SaveEdit }) {
  const totals = useMemo(() => computeInvoiceTotals(snapshot), [snapshot])
  const block = snapshot.blocks.find((b): b is Extract<Block, { type: 'line-items' }> => b.type === 'line-items')
  const items = block?.items ?? []
  const amountById = new Map(totals.lines.map((l) => [l.itemId, l.amount]))
  const { locale } = snapshot
  const [editing, setEditing] = useState<string | null>(null)
  const editingIndex = items.findIndex((i) => i.id === editing)

  const show = (amount: Amount, negate = false) => amount.known
    ? formatMoney(negate ? { ...amount.money, amountMinor: -amount.money.amountMinor || 0 } : amount.money, locale)
    : null

  const rows: [string, Amount, boolean?][] = [
    ['Subtotal', totals.subtotal],
    ['Discount', totals.discount, true],
    ['Taxable amount', totals.taxableBase],
    ['Tax', totals.tax],
    ['Total', totals.total],
  ]

  return (
    <section className={styles.panel} aria-labelledby="amounts-title">
      <h2 id="amounts-title" className={styles.panelTitle}>Line items and derived totals</h2>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        Computed from integer minor units ({totals.currency ?? 'no currency'}). Totals are derived on every render, never stored.
      </p>
      {block && editingIndex >= 0 && (
        <LineItemEditor key={editing} blockId={block.id} item={items[editingIndex]} index={editingIndex} snapshot={snapshot} onSave={onSave} onClose={() => { const id = editing; setEditing(null); returnFocus(`edit-line-${id}`) }} />
      )}
      <div className={styles.scrollBox} tabIndex={0} role="region" aria-label={`Line items, ${items.length} rows`}>
        <table className={`${styles.amountTable} ${styles.lineItems}`}>
          <thead>
            <tr><th scope="col">Description</th><th scope="col" className={styles.num}>Qty</th><th scope="col" className={styles.num}>Unit price</th><th scope="col" className={styles.num}>Amount</th>{canEdit && <th scope="col"><span className={styles.srOnly}>Edit</span></th>}</tr>
          </thead>
          <tbody>
            {items.map((li, i) => {
              const amount = amountById.get(li.id)
              return (
                <tr key={li.id}>
                  <td><span className={styles.cell}>{li.description}</span></td>
                  <td className={styles.num} data-label="Qty"><span className={styles.cell}>{formatQuantity(li.quantityMilli, locale)}{li.unit ? ` ${li.unit}` : ''}</span></td>
                  <td className={styles.num} data-label="Unit price"><span className={styles.cell}>{li.unitPrice ? formatMoney(li.unitPrice, locale) : <span className={styles.unknownAmount}>Missing</span>}</span></td>
                  <td className={styles.num} data-label="Amount"><span className={styles.cell}>{amount && show(amount) ? show(amount) : <span className={styles.unknownAmount}>Unknown</span>}</span></td>
                  {canEdit && (
                    <td data-label=""><span className={styles.cell}><Button id={`edit-line-${li.id}`} variant="ghost" size="sm" onClick={() => setEditing(li.id)} aria-label={`Edit line ${i + 1}`}>Edit</Button></span></td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <table className={styles.amountTable} style={{ marginTop: 12 }}>
        <caption className={styles.srOnly}>Totals</caption>
        <tbody>
          {rows.map(([label, amount, negate]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className={styles.num}>
                {amount.known
                  ? show(amount, negate)
                  : <span className={styles.unknownAmount}>Unknown — {amount.reasons.map((r) => r.message).join(' ')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!totals.complete && <p className={styles.muted}>The total is incomplete and is not presented as a final amount.</p>}
    </section>
  )
}

// ── Scenario fixture ────────────────────────────────────────────────────────

const RUNNERS: Partial<Record<string, () => ScenarioCheck[]>> = {
  'bounded-edit': runBoundedEdit,
  'approved-then-edited': runApprovedThenEdited,
  restore: runRestore,
}

function ScenarioInspector({ fixture, wb, onOpenFixture }: { fixture: Extract<Fixture, { type: 'scenario' }>; wb: Workbench; onOpenFixture: (id: string) => void }) {
  const base = fixture.baseFixtureId ? getFixture(fixture.baseFixtureId) : undefined
  const runner = RUNNERS[fixture.id]
  const [results, setResults] = useState<ScenarioCheck[] | null>(null)
  return (
    <section className={styles.panel} aria-labelledby="fixture-title">
      <h2 id="fixture-title" className={styles.fixtureTitle}>{fixture.title}</h2>
      <p className={styles.muted}>Fixture {fixture.prdNumber} · {fixture.purpose}</p>
      <div className={styles.metaRow}>
        <span className={styles.pill} data-tone="neutral">{RUNNABLE_NOW.has(fixture.runsIn) ? 'Scenario — runnable now' : `Scenario — runnable from ${STEP_LABEL[fixture.runsIn]}`}</span>
      </div>
      {base && (
        <p>
          Starts from:{' '}
          <a href={`#${base.id}`} onClick={(e) => { e.preventDefault(); onOpenFixture(base.id) }}>{base.title}</a>
        </p>
      )}
      <h3 className={styles.groupHeading} style={{ marginTop: 16 }}>What it checks</h3>
      <ol className={styles.stepsList}>{fixture.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {fixture.id === 'deck-from-brief'
        ? <DeckScenario wb={wb} />
        : runner
          ? (
            <>
              <p className={styles.muted}>Runs the steps on a fresh sample store with the real revision functions. To try it by hand, open {base?.title ?? 'the base document'} and use its edit, history and restore controls.</p>
              <div className={styles.toolbar}><Button size="sm" onClick={() => setResults(runner())}>{results ? 'Run again' : 'Run scenario'}</Button></div>
              {results && <CheckList checks={results} />}
            </>
          )
          : <p className={styles.muted} style={{ marginTop: 12 }}>Not runnable yet. Nothing on this page simulates its result.</p>}
    </section>
  )
}

function CheckList({ checks }: { checks: readonly { label: string; result: 'pass' | 'fail' | 'deferred'; detail: string }[] }) {
  return (
    <ul className={styles.issueList} aria-label="Results">
      {checks.map((c) => (
        <li key={c.label} className={styles.checkRow}>
          <span className={styles.pill} data-tone={c.result === 'pass' ? 'ready' : c.result === 'fail' ? 'invalid' : 'neutral'}>{c.result === 'pass' ? 'Pass' : c.result === 'fail' ? 'Fail' : 'Deferred'}</span>
          <span><strong>{c.label}.</strong> {c.detail}</span>
        </li>
      ))}
    </ul>
  )
}

// ── Fixture 5: brief → deck, with ancestry checked against real revisions ────

const BRIEF_FACTS = ['61%', '8 of 112', '15 of 109', 'week 3 (21%)']

function DeckScenario({ wb }: { wb: Workbench }) {
  const briefId = outputIdFor('brief-evidence')
  const brief = currentRevision(wb.store, briefId)
  const deckDoc = wb.deckId ? getDocument(wb.store, wb.deckId) : null
  const deckRev = deckDoc ? getRevision(wb.store, deckDoc.currentRevisionId) : null
  const ancestry = deckRev ? checkAncestry(wb.store, deckRev.revisionId) : null
  const [layout, setLayout] = useState<DeckLayout | null>(null)
  const onLayout = useCallback((l: DeckLayout | null) => setLayout(l), [])
  const [error, setError] = useState<string | null>(null)

  const derive = () => {
    try {
      const { store, outputId, revision } = deriveDeckRevision(wb.store, wb.env, briefId, brief.revisionId, wb.deckId ?? undefined)
      wb.setDeckId(outputId)
      wb.commit(store, `Deck ${versionLabel(store, revision.revisionId)}: ${revision.changeSummary}.`)
      setError(null)
    } catch (e) {
      if (e instanceof RevisionError) setError(e.message)
      else throw e
    }
  }

  const source = deckDoc?.derivedFrom ? getRevision(wb.store, deckDoc.derivedFrom.revisionId) : null
  const excluded = source ? deriveDeck(source.snapshot as BriefSnapshot, deckDoc!.derivedFrom!).excludedBlocks : []
  const checks = deckRev && layout && ancestry
    ? deckChecks(deckRev.snapshot as DeckSnapshot, layout, { facts: BRIEF_FACTS, citationCount: brief.snapshot.citations.length, ancestry, excludedBlocks: excluded })
    : []

  return (
    <>
      <h3 className={styles.groupHeading} style={{ marginTop: 16 }}>Result</h3>
      <p className={styles.muted}>
        The deck is derived from the evidence-backed brief in this workbench. Edit that brief and come back: the deck keeps pointing at the revision it came from until you derive again.
      </p>
      {!deckRev
        ? <div className={styles.toolbar}><Button size="sm" onClick={derive}>Derive deck from brief {versionLabel(wb.store, brief.revisionId)}</Button></div>
        : (
          <>
            <p className={styles.pill} data-tone={ancestry?.status === 'current' ? 'ready' : ancestry?.status === 'stale' ? 'incomplete' : 'invalid'} role="status">{ancestry?.label}</p>
            <p className={styles.muted}>Deck {versionLabel(wb.store, deckRev.revisionId)} · {deckRev.changeSummary}</p>
            {ancestry?.status === 'stale' && <div className={styles.toolbar}><Button size="sm" onClick={derive}>Derive again from brief {versionLabel(wb.store, brief.revisionId)}</Button></div>}
            {checks.length === 0 ? <p className={styles.muted}>Laying out slides…</p> : <CheckList checks={checks} />}
            <h4 className={styles.groupHeading}>Deck history ({history(wb.store, deckDoc!.outputId).length})</h4>
            <ol className={styles.blockOutline}>
              {history(wb.store, deckDoc!.outputId).map((r) => <li key={r.revisionId}>{versionLabel(wb.store, r.revisionId)} — {r.changeSummary} — {checkAncestry(wb.store, r.revisionId).label}</li>)}
            </ol>
            <div className={styles.previewWell}>
              <DeckPreview snapshot={deckRev.snapshot as DeckSnapshot} onLayout={onLayout} />
            </div>
          </>
        )}
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </>
  )
}
