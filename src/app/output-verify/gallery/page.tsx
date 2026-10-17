import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import type { Made } from '@/lib/output-system/agent/loop'
import { sampleStore, type StoreId } from '@/lib/output-system/fixtures/stores'

import chartItems from '../../../../docs/output-system/gallery/chart.json'
import chatItems from '../../../../docs/output-system/gallery/chat.json'
import fileItems from '../../../../docs/output-system/gallery/file.json'
import scores from '../../../../docs/output-system/gallery/scores.json'
import { ChartView } from '../ChartView'
import { RichText } from '../RichText'
import styles from '../outputVerify.module.css'

export const metadata: Metadata = {
  title: 'Output gallery (prototype)',
  robots: { index: false, follow: false },
}

// The best current example of each template, plus the two weakest results, so
// problems stay visible (build-loop.md §7). Items come from the last gate run
// (scripts/output-system/lane-eval.ts --gallery); scores are Claude's advisory
// rubric scores (gallery/scores.json), never a pass on their own.

type Item = {
  id: string
  store: StoreId
  storeName: string
  request: string
  made: Made
  ok: boolean
  checks: { name: string; ok: boolean; detail?: string }[]
  file?: { name: string; path: string; rows: number; bytes: number; preview: unknown[][]; summary?: string[] }
}

type Scored = { scores: Record<string, number>; evidence?: Record<string, string> }

const DIMENSIONS: [string, string][] = [
  ['hierarchy', 'Hierarchy'],
  ['brandFit', 'Brand fit'],
  ['readability', 'Readability'],
  ['facts', 'Facts and numbers'],
  ['standard', 'Fit to its standard'],
  ['phone', 'Phone legibility'],
]

const TEMPLATES: { id: string; label: string; of: (i: Item) => boolean }[] = [
  { id: 'chat-reply', label: 'Chat reply', of: (i) => i.made.kind === 'reply' },
  { id: 'inline-chart', label: 'Inline chart', of: (i) => i.made.kind === 'chart' },
  { id: 'orders-export', label: 'Orders export', of: (i) => i.made.kind === 'file' && i.made.spec.dataset === 'orders' },
  { id: 'products-export', label: 'Products export', of: (i) => i.made.kind === 'file' && i.made.spec.dataset === 'products' },
  { id: 'customers-export', label: 'Customers export', of: (i) => i.made.kind === 'file' && i.made.spec.dataset === 'customers' },
  { id: 'uploaded-change', label: 'Change to an uploaded file', of: (i) => i.made.kind === 'upload-change' },
  { id: 'format-not-supported', label: 'Format not supported', of: (i) => i.made.kind === 'format-options' },
]

const scoreOf = (id: string) => (scores.items as Record<string, Scored>)[id]
const average = (id: string) => {
  const s = scoreOf(id)?.scores
  return s ? Object.values(s).reduce((a, b) => a + b, 0) / Object.values(s).length : 0
}

function Output({ item }: { item: Item }) {
  const m = item.made
  if (m.kind === 'reply') return <RichText text={m.text} />
  if (m.kind === 'chart') {
    const p = sampleStore(item.store).brand.palette
    return (
      <div className={styles.chartReply}>
        <RichText text={m.lead} />
        <ChartView chart={m.chart} accent={p.accent} ink={p.ink} muted={p.muted} />
      </div>
    )
  }
  if (m.kind === 'format-options') {
    return (
      <div className={styles.card}>
        <p className={styles.cardTitle}>{m.requestedFormat} isn’t available for this</p>
        <p className={styles.cardNote}>{m.message}</p>
        <div className={styles.formatButtons}>{m.offered.map((o) => <span key={o} className={styles.secondary}>{o}</span>)}</div>
      </div>
    )
  }
  if ((m.kind === 'file' || m.kind === 'upload-change') && item.file) {
    const [head = [], ...rows] = item.file.preview
    return (
      <div className={styles.card}>
        <p className={styles.cardTitle}>{item.file.name}</p>
        <p className={styles.cardMeta}>{item.file.rows} rows · {(item.file.bytes / 1024).toFixed(1)} KB · committed at docs/output-system/gallery/{item.file.path}</p>
        {item.file.summary?.length ? <ul className={styles.changes}>{item.file.summary.map((s) => <li key={s}>{s}</li>)}</ul> : null}
        <div className={styles.previewScroll}>
          <table className={styles.preview}>
            <thead><tr>{head.map((h, i) => <th key={i}>{String(h ?? '')}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 6).map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c === null ? '' : String(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    )
  }
  return <p className={styles.error}>{m.kind === 'error' ? m.message : 'Not shown here.'}</p>
}

function Entry({ item, tag }: { item: Item; tag: string }) {
  const s = scoreOf(item.id)
  return (
    <article className={styles.galleryItem}>
      <p className={styles.note}>{tag} · {item.id} · {item.storeName}</p>
      <p className={styles.person}>{item.request}</p>
      <Output item={item} />
      <details className={styles.scoreBox}>
        <summary>Advisory score {average(item.id).toFixed(1)} of 5 · automatic checks {item.checks.every((c) => c.ok) ? 'all passed' : 'failed'}</summary>
        <ul>
          {DIMENSIONS.map(([k, label]) => (
            <li key={k}>{label}: {s?.scores[k] ?? '—'}{s?.evidence?.[k] ? ` — ${s.evidence[k]}` : ''}</li>
          ))}
        </ul>
      </details>
    </article>
  )
}

export default function OutputGalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const items = [...chatItems, ...chartItems, ...fileItems] as unknown as Item[]
  const best = TEMPLATES.map((t) => ({ t, item: items.filter(t.of).sort((a, b) => average(b.id) - average(a.id) || a.id.localeCompare(b.id))[0] })).filter((x) => x.item)
  const weakest = [...items].sort((a, b) => average(a.id) - average(b.id) || a.id.localeCompare(b.id)).slice(0, 2)
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Gallery</h1>
        <Link className={styles.link} href="/output-verify">Back to Make something</Link>
      </header>
      <p className={styles.sample}>The best example of each kind, then the two weakest results. Scores are Claude’s own and advisory; the designer’s review decides.</p>
      <section className={styles.section} aria-labelledby="best-heading">
        <h2 id="best-heading" className={styles.heading}>Best of each kind</h2>
        {best.map(({ t, item }) => <Entry key={t.id} item={item} tag={t.label} />)}
      </section>
      <section className={styles.section} aria-labelledby="weak-heading">
        <h2 id="weak-heading" className={styles.heading}>Two weakest results</h2>
        {weakest.map((item) => <Entry key={item.id} item={item} tag="Weak" />)}
      </section>
    </main>
  )
}
