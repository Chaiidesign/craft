'use client'

// Document-quality workbench (Step 1: fixture inspector).
//
// Shows each fictional fixture's typed fields, validation and derived totals
// exactly as the model holds them. No document rendering yet — that arrives
// in Step 2 — so nothing here is labelled as a preview.

import React, { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { describeFieldState } from '@/lib/documents/display'
import { FIXTURES, getFixture, SAMPLE_LABEL, type Fixture } from '@/lib/documents/fixtures'
import { computeInvoiceTotals, type Amount } from '@/lib/documents/invoice'
import type { Block, DocumentSnapshot, InvoiceSnapshot } from '@/lib/documents/model'
import { formatMoney, formatQuantity } from '@/lib/documents/money'
import { validateSnapshot, type Readiness, type ValidationIssue } from '@/lib/documents/validation'

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

const documentFixtures = FIXTURES.filter((f) => f.type === 'document')
const scenarioFixtures = FIXTURES.filter((f) => f.type === 'scenario')

export function DocumentWorkbench() {
  const [fixtureId, setFixtureId] = useState(FIXTURES[0].id)
  const fixture = getFixture(fixtureId) ?? FIXTURES[0]
  // Build once per fixture so the snapshot keeps its identity across renders.
  const snapshot = useMemo(() => (fixture.type === 'document' ? fixture.build() : null), [fixture])
  const [announcement, setAnnouncement] = useState('')

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
            ? <ScenarioInspector fixture={fixture} onOpenFixture={select} />
            : snapshot && <DocumentInspector key={fixture.id} fixture={fixture} snapshot={snapshot} onOpenFixture={select} />}
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

function DocumentInspector({ fixture, snapshot, onOpenFixture }: { fixture: Fixture; snapshot: DocumentSnapshot; onOpenFixture: (id: string) => void }) {
  const report = useMemo(() => validateSnapshot(snapshot), [snapshot])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
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

  const scenarios = scenarioFixtures.filter((s) => s.type === 'scenario' && s.baseFixtureId === fixture.id)

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
        <p className={styles.muted} style={{ marginTop: 12 }}>
          This is the structured model, not a rendered document. The document preview arrives in Step 2.
        </p>
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
                    <p className={styles.fieldValue} data-status={shown.status}>{shown.text}</p>
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

      {snapshot.kind === 'invoice' && <InvoiceAmounts snapshot={snapshot} />}

      <section className={styles.panel} aria-labelledby="brand-title">
        <h2 id="brand-title" className={styles.panelTitle}>Issuer brand</h2>
        <div className={styles.fieldList}>
          <BrandRow label="Issuer display name" value={snapshot.brand.issuerDisplayName} />
          <BrandRow label="Logo" value={snapshot.brand.logo ? `${snapshot.brand.logo.src} (status claimed: ${snapshot.brand.assetStatus}; load check happens when rendering)` : 'None supplied — a labelled neutral fallback will be used'} />
          <BrandRow label="Profile" value={`${snapshot.brand.profileId} v${snapshot.brand.version}`} />
          <BrandRow label="Typography theme" value={`${snapshot.brand.themeId} (resolved in Step 2)`} />
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

function InvoiceAmounts({ snapshot }: { snapshot: InvoiceSnapshot }) {
  const totals = useMemo(() => computeInvoiceTotals(snapshot), [snapshot])
  const items = snapshot.blocks.flatMap((b) => (b.type === 'line-items' ? b.items : []))
  const amountById = new Map(totals.lines.map((l) => [l.itemId, l.amount]))
  const { locale } = snapshot

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
      <div className={styles.scrollBox} tabIndex={0} role="region" aria-label={`Line items, ${items.length} rows`}>
        <table className={`${styles.amountTable} ${styles.lineItems}`}>
          <thead>
            <tr><th scope="col">Description</th><th scope="col" className={styles.num}>Qty</th><th scope="col" className={styles.num}>Unit price</th><th scope="col" className={styles.num}>Amount</th></tr>
          </thead>
          <tbody>
            {items.map((li) => {
              const amount = amountById.get(li.id)
              return (
                <tr key={li.id}>
                  <td><span className={styles.cell}>{li.description}</span></td>
                  <td className={styles.num} data-label="Qty"><span className={styles.cell}>{formatQuantity(li.quantityMilli, locale)}{li.unit ? ` ${li.unit}` : ''}</span></td>
                  <td className={styles.num} data-label="Unit price"><span className={styles.cell}>{li.unitPrice ? formatMoney(li.unitPrice, locale) : <span className={styles.unknownAmount}>Missing</span>}</span></td>
                  <td className={styles.num} data-label="Amount"><span className={styles.cell}>{amount && show(amount) ? show(amount) : <span className={styles.unknownAmount}>Unknown</span>}</span></td>
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

function ScenarioInspector({ fixture, onOpenFixture }: { fixture: Extract<Fixture, { type: 'scenario' }>; onOpenFixture: (id: string) => void }) {
  const base = fixture.baseFixtureId ? getFixture(fixture.baseFixtureId) : undefined
  return (
    <section className={styles.panel} aria-labelledby="fixture-title">
      <h2 id="fixture-title" className={styles.fixtureTitle}>{fixture.title}</h2>
      <p className={styles.muted}>Fixture {fixture.prdNumber} · {fixture.purpose}</p>
      <div className={styles.metaRow}>
        <span className={styles.pill} data-tone="neutral">Scenario — runnable from {STEP_LABEL[fixture.runsIn]}</span>
      </div>
      {base && (
        <p>
          Starts from:{' '}
          <a href={`#${base.id}`} onClick={(e) => { e.preventDefault(); onOpenFixture(base.id) }}>{base.title}</a>
        </p>
      )}
      <h3 className={styles.groupHeading} style={{ marginTop: 16 }}>What it will check</h3>
      <ol className={styles.stepsList}>{fixture.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className={styles.muted} style={{ marginTop: 12 }}>Not runnable yet. Nothing on this page simulates its result.</p>
    </section>
  )
}
