// Session 2 evals for strict documents (build-loop.md §8): each item in
// docs/output-system/evals/strict.jsonl is one conversation of one or more
// turns, run through the app's own loop with the documents carried from turn to
// turn, exactly as /output-verify does. After each turn the automatic checks run:
//
// - the right thing was made (document kind, export, format card, coming later, a reply);
// - every value on the document has a source: copied from the store, or quoting the person;
// - store values match the store exactly (order totals; catalogue titles and prices;
//   never a selling price on a purchase order);
// - nothing is invented: what the item says stays Missing stays Missing;
// - a follow-up changes only what was asked, as a new version, keeping the old one;
// - an export is of the version asked for, and the file opens (PDF and Word, rendered here).
//
//   npx vite-node scripts/output-system/strict-eval.ts -- --session 2
//   npx vite-node scripts/output-system/strict-eval.ts -- --session 2 --runs 3 --no-cache --gallery
//
// Spend is charged to --session; a spend limit stops the run (exit 4).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { exportDocument } from '../../src/lib/documents/generation/tools'
import { computeInvoiceTotals, INVOICE_FIELDS as F } from '../../src/lib/documents/invoice'
import type { DocumentEnv, InvoiceSnapshot } from '../../src/lib/documents/model'
import { currentRevision, emptyStore, getRevision, history, type RevisionStore } from '../../src/lib/documents/revisions'
import { nodeResources } from '../../src/lib/documents/testing/nodeResources'
import { validateSnapshot } from '../../src/lib/documents/validation'
import { runTurn, type Made, type Turn } from '../../src/lib/output-system/agent/loop'
import { modelCall, readRepoFiles, SpendLimitError } from '../../src/lib/output-system/agent/server'
import { ANCHOR_DATE, sampleStore, type StoreId } from '../../src/lib/output-system/fixtures/stores'
import { madeText } from '../../src/lib/output-system/history'
import { parseLedger, summariseSpend } from '../../src/lib/output-system/spend'
import { findOrder } from '../../src/lib/output-system/strict'
import { findForbiddenWords } from '../../src/lib/output-system/words'

const ROOT = resolve(import.meta.dirname, '../..')
const DIR = join(ROOT, 'docs/output-system')
const args = process.argv.slice(2).filter((a) => a !== '--')
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined)
const runs = Number(flag('runs') ?? 1)
const session = flag('session') ?? 'adhoc'
const only = flag('only')?.split(',')
const useCache = !args.includes('--no-cache')
const writeGallery = args.includes('--gallery')

if (existsSync(join(ROOT, '.env.local'))) process.loadEnvFile(join(ROOT, '.env.local'))

type LineExpect = { sku: string; quantity: number; unitCost?: string | null }
type Expect = {
  made: 'document' | 'export' | 'format-options' | 'coming-later' | 'reply'
  docKind?: string
  version?: number
  lines?: LineExpect[]
  linesAdded?: LineExpect[]
  /** Lines in the person's words (no catalogue line): how many, with which quantities, every price Missing. */
  unpricedLines?: number[]
  fromOrder?: string
  provided?: Record<string, string>
  missing?: string[]
  ready?: boolean
  /** Fields the follow-up may change; nothing else may. Lines are compared separately. */
  changed?: string[]
  format?: 'pdf' | 'docx'
  offered?: string[]
  lane?: string
}
type Item = { id: string; store: StoreId; note?: string; turns: { request: string; expect: Expect }[] }
type Check = { name: string; ok: boolean; detail?: string }

const items = readFileSync(join(DIR, 'evals/strict.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Item).filter((i) => !only || only.includes(i.id))

const linesOf = (s: InvoiceSnapshot) => s.blocks.flatMap((b) => (b.type === 'line-items' ? b.items : []))

function valueText(s: InvoiceSnapshot, id: string): string | null {
  const st = s.fields[id]?.state
  if (st?.status !== 'provided') return null
  const v = st.value
  return v.type === 'text' ? v.text : v.type === 'date' ? v.iso : v.type === 'choice' ? v.option : v.type === 'currency' ? v.code : JSON.stringify(v)
}

function checkLines(s: InvoiceSnapshot, store: ReturnType<typeof sampleStore>, want: LineExpect[], items = linesOf(s), label = 'lines'): Check[] {
  const checks: Check[] = [{ name: `${want.length} ${label}`, ok: items.length === want.length, detail: String(items.length) }]
  want.forEach((w, i) => {
    const p = store.products.find((x) => x.sku === w.sku)!
    const li = items[i]
    if (!li) return
    checks.push({ name: `line ${i + 1} is ${w.quantity} × ${p.title}`, ok: li.description === p.title && li.quantityMilli === w.quantity * 1000, detail: `${li.quantityMilli / 1000} × ${li.description}` })
    if (s.kind === 'purchase-order') {
      const cost = w.unitCost === undefined || w.unitCost === null ? null : Math.round(Number(w.unitCost) * 100)
      checks.push({ name: cost === null ? `line ${i + 1}: no price (the store's selling price is never used)` : `line ${i + 1}: the stated cost ${w.unitCost}`, ok: (li.unitPrice?.amountMinor ?? null) === cost, detail: String(li.unitPrice?.amountMinor ?? null) })
    } else {
      checks.push({ name: `line ${i + 1}: the store's price`, ok: li.unitPrice?.amountMinor === p.priceMinor && li.unitPrice.currency === store.currency, detail: String(li.unitPrice?.amountMinor) })
    }
  })
  return checks
}

/** Every provided field and every line has a source; store-copied values are checked against the store. */
function sourceChecks(s: InvoiceSnapshot, store: ReturnType<typeof sampleStore>, requestText: string): Check[] {
  const prov = s.provenance ?? {}
  const unsourced = s.fieldOrder.filter((id) => s.fields[id].state.status === 'provided' && !prov[`field:${id}`])
  const lines = linesOf(s)
  const unsourcedLines = lines.filter((li) => !prov[`line:${li.id}`])
  const badStore: string[] = []
  for (const li of lines) {
    const p = prov[`line:${li.id}`]
    if (p?.source !== 'store') continue
    if (p.ref.startsWith('product ')) {
      const prod = store.products.find((x) => x.sku === p.ref.slice(8))
      // On a purchase order a catalogue line carries no price: the selling price is never what the store pays.
      const price = s.kind === 'purchase-order' ? null : prod?.priceMinor
      if (!prod || li.description !== prod.title || (li.unitPrice?.amountMinor ?? null) !== price) badStore.push(`${li.description}`)
    } else if (p.ref.startsWith('order ')) {
      const order = findOrder(store, p.ref.slice(6))
      if (!order?.lines.some((l) => l.title === li.description && l.unitPriceMinor === li.unitPrice?.amountMinor && l.quantity * 1000 === li.quantityMilli)) badStore.push(`${li.description}`)
    }
  }
  const quotes = Object.entries(prov).filter(([, p]) => p.source === 'prompt').map(([k, p]) => [k, (p as { evidence: string }).evidence] as const)
  const norm = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')
  const badQuotes = quotes.filter(([, q]) => !norm(requestText).includes(norm(q)))
  return [
    { name: 'every value has a source (the store or the person)', ok: unsourced.length === 0 && unsourcedLines.length === 0, detail: [...unsourced, ...unsourcedLines.map((l) => l.id)].join(', ') || `${Object.keys(prov).length} sourced` },
    { name: 'store values match the store exactly', ok: badStore.length === 0, detail: badStore.join(', ') || 'all match' },
    { name: 'every quote is in what the person wrote', ok: badQuotes.length === 0, detail: badQuotes.map(([k]) => k).join(', ') || `${quotes.length} quotes` },
  ]
}

async function main() {
  const repo = readRepoFiles(ROOT)
  const out: unknown[] = []
  const gallery: unknown[] = []
  let right = 0
  let total = 0
  for (let run = 1; run <= runs; run++) {
    for (const item of items) {
      const store = sampleStore(item.store)
      let n = 0
      const env: DocumentEnv = { now: () => `${ANCHOR_DATE}T10:00:00.000Z`, nextId: (p) => `${p}-${item.id}-r${run}-${++n}` }
      let revisions: RevisionStore = emptyStore()
      let current: string | null = null
      const historyTurns: Turn[] = []
      const said: string[] = []
      const turnResults: unknown[] = []
      let itemOk = true
      let seconds = 0
      for (const [t, turn] of item.turns.entries()) {
        const { call } = modelCall({ root: ROOT, session, lane: 'strict_document', purpose: 'eval-strict', repo, cache: useCache, run: useCache ? 0 : run })
        const t0 = Date.now()
        let result
        try {
          result = await runTurn({ store, history: historyTurns, request: turn.request, prompt: repo.prompt, guides: repo.guides, formats: repo.formats, call, today: ANCHOR_DATE, documents: { revisions, current }, env })
        } catch (e) {
          if (e instanceof SpendLimitError) {
            process.stderr.write(`${e.message} Stopping.\n`)
            process.exit(4)
          }
          throw e
        }
        seconds += (Date.now() - t0) / 1000
        said.push(turn.request)
        const made: Made = result.made
        const before = revisions
        const beforeCurrent = current
        if (result.revisions) revisions = result.revisions
        if (made.kind === 'document') current = made.outputId
        const e = turn.expect
        const checks: Check[] = [{ name: `made: ${e.made}`, ok: made.kind === e.made, detail: made.kind === 'error' ? made.message : made.kind }]
        checks.push({ name: 'read the guide before making a new document', ok: !(made.kind === 'document' && made.created) || result.toolsUsed.includes('read_guide'), detail: result.toolsUsed.join(' → ') })

        if (made.kind === 'document') {
          const s = getRevision(revisions, made.revisionId).snapshot as InvoiceSnapshot
          if (e.docKind) checks.push({ name: `a ${e.docKind}`, ok: s.kind === e.docKind, detail: s.kind })
          if (e.version) checks.push({ name: `version ${e.version}`, ok: made.version === e.version, detail: String(made.version) })
          checks.push(...sourceChecks(s, store, said.join('\n')))
          if (e.lines) checks.push(...checkLines(s, store, e.lines))
          if (e.unpricedLines) {
            const ls = linesOf(s)
            checks.push({ name: `${e.unpricedLines.length} line(s) of ${e.unpricedLines.join(', ')}`, ok: JSON.stringify(ls.map((l) => l.quantityMilli / 1000)) === JSON.stringify(e.unpricedLines), detail: ls.map((l) => `${l.quantityMilli / 1000} × ${l.description}`).join('; ') })
            checks.push({ name: 'no price invented: every price Missing', ok: ls.every((l) => l.unitPrice === null), detail: ls.map((l) => l.unitPrice?.amountMinor ?? 'missing').join(', ') })
          }
          if (e.fromOrder) {
            const order = findOrder(store, e.fromOrder)!
            const totals = computeInvoiceTotals(s)
            checks.push({ name: `made from order ${e.fromOrder}`, ok: valueText(s, F.orderNumber) === order.number, detail: valueText(s, F.orderNumber) ?? 'none' })
            checks.push({ name: 'total equals the order’s total', ok: totals.total.known && totals.total.money.amountMinor === order.totalMinor, detail: totals.total.known ? String(totals.total.money.amountMinor) : 'unknown' })
          }
          for (const [id, want] of Object.entries(e.provided ?? {})) checks.push({ name: `${s.fields[id]?.label ?? id} is ${want}`, ok: valueText(s, id) === want, detail: valueText(s, id) ?? 'missing' })
          for (const id of e.missing ?? []) checks.push({ name: `${s.fields[id]?.label ?? id} stays Missing`, ok: s.fields[id]?.state.status === 'missing', detail: s.fields[id]?.state.status })
          if (e.ready !== undefined) checks.push({ name: e.ready ? 'ready to send' : 'still a draft', ok: (validateSnapshot(s).readiness === 'ready') === e.ready, detail: validateSnapshot(s).readiness })
          if (made.followUp) checks.push({ name: 'no system words in the question', ok: findForbiddenWords(made.followUp).length === 0, detail: made.followUp })
          if (!made.created && beforeCurrent) {
            const prev = currentRevision(before, beforeCurrent).snapshot as InvoiceSnapshot
            const changedFields = Object.keys(s.fields).filter((id) => JSON.stringify(s.fields[id].state) !== JSON.stringify(prev.fields[id]?.state))
            const allowed = new Set(e.changed ?? [])
            checks.push({ name: `only ${e.changed?.length ? e.changed.join(', ') : 'no fields'} changed`, ok: changedFields.every((id) => allowed.has(id)) && [...allowed].every((id) => changedFields.includes(id)), detail: changedFields.join(', ') || 'none' })
            const prevLines = linesOf(prev)
            const nowLines = linesOf(s)
            const kept = prevLines.every((li, i) => JSON.stringify(nowLines[i]) === JSON.stringify(li))
            checks.push({ name: 'existing lines unchanged', ok: kept })
            if (e.linesAdded) checks.push(...checkLines(s, store, e.linesAdded, nowLines.slice(prevLines.length), 'lines added'))
            else checks.push({ name: 'no lines added', ok: nowLines.length === prevLines.length })
            const prevId = currentRevision(before, beforeCurrent).revisionId
            const kept2 = history(revisions, made.outputId).some((r) => r.revisionId === prevId && JSON.stringify(r.snapshot) === JSON.stringify(prev))
            checks.push({ name: 'the earlier version is kept, unchanged', ok: kept2 && history(revisions, made.outputId).length === made.version })
          }
          for (const format of ['pdf', 'docx'] as const) {
            const x = await exportDocument({ revisionId: made.revisionId, format }, { store: revisions, env, resources: nodeResources })
            const bytes = x.ok ? x.result.bytes : new Uint8Array()
            const magic = format === 'pdf' ? '%PDF-' : 'PK'
            checks.push({ name: `${format === 'pdf' ? 'PDF' : 'Word'} file opens`, ok: x.ok && new TextDecoder().decode(bytes.slice(0, magic.length)) === magic, detail: x.ok ? `${x.result.pageCount} page(s)${x.result.draft ? ', marked Draft' : ''}` : x.error.message })
            if (writeGallery && run === 1 && x.ok && t === item.turns.length - 1) {
              mkdirSync(join(DIR, 'gallery/files'), { recursive: true })
              writeFileSync(join(DIR, 'gallery/files', `${item.id}-${x.result.filename}`), bytes)
            }
          }
        }
        if (made.kind === 'export') {
          const versions = current ? history(revisions, current) : []
          const want = versions[(e.version ?? versions.length) - 1]
          checks.push({ name: `exports version ${e.version}`, ok: !!want && made.revisionId === want.revisionId, detail: `version ${made.version}` })
          if (e.format) checks.push({ name: `as ${e.format}`, ok: made.format === e.format, detail: made.format })
          const x = await exportDocument({ revisionId: made.revisionId, format: made.format }, { store: revisions, env, resources: nodeResources })
          checks.push({ name: 'the file opens', ok: x.ok && x.result.bytes.byteLength > 0, detail: x.ok ? x.result.filename : x.error.message })
        }
        if (made.kind === 'format-options' && e.offered) checks.push({ name: `offers ${e.offered.join(', ')}`, ok: e.offered.every((o) => made.offered.includes(o)) && made.offered.every((o) => e.offered!.includes(o)), detail: made.offered.join(', ') })
        if (made.kind === 'coming-later' && e.lane) checks.push({ name: `coming later: ${e.lane}`, ok: made.lane === e.lane, detail: made.lane })
        if (made.kind === 'reply') checks.push({ name: 'no system words on screen', ok: findForbiddenWords(made.text).length === 0 })

        const ok = checks.every((c) => c.ok)
        itemOk &&= ok
        process.stderr.write(`${ok ? 'pass' : 'FAIL'} ${item.id} turn ${t + 1} run ${run} (${result.calls} calls)${ok ? '' : `: ${checks.filter((c) => !c.ok).map((c) => `${c.name} [${c.detail ?? ''}]`).join('; ')}`}\n`)
        turnResults.push({ request: turn.request, made, toolsUsed: result.toolsUsed, calls: result.calls, checks, ok })
        historyTurns.push({ role: 'person', text: turn.request }, { role: 'souvenir', text: madeText(made, revisions) })
        if (writeGallery && run === 1 && t === item.turns.length - 1) {
          const docId = made.kind === 'document' || made.kind === 'export' ? made.revisionId : null
          gallery.push({ id: item.id, store: item.store, storeName: store.name, requests: item.turns.map((x) => x.request), made, ok: itemOk, checks, ...(docId ? { snapshot: getRevision(revisions, docId).snapshot, versions: current ? history(revisions, current).length : 0 } : {}) })
        }
      }
      right += itemOk ? 1 : 0
      total++
      out.push({ id: item.id, run, store: item.store, seconds: Math.round(seconds * 10) / 10, ok: itemOk, turns: turnResults })
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const spend = summariseSpend(parseLedger(readFileSync(join(DIR, 'spend/ledger.jsonl'), 'utf8')))
  const rows = out as { id: string; run: number; ok: boolean; seconds: number; turns: { request: string; checks: Check[] }[] }[]
  const md = [
    `# strict eval: ${right} of ${total} conversations passed`,
    '',
    `${new Date().toISOString()} · session ${session} · ${runs} run(s) · cache ${useCache ? 'on (iterating)' : 'off (gate run)'} · prompt \`${repo.promptVersion}\` · guides \`${repo.guideVersion}\` · session spend so far US$${(spend.bySession[session] ?? 0).toFixed(2)}`,
    '',
    'Automatic checks only (build-loop.md §8). Each row is one conversation; a conversation passes only if every turn passes. Rubric scores are advisory and kept in `docs/output-system/gallery/scores.json`.',
    '',
    '| | Id | Run | Turns | Seconds | Failed checks |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.ok ? '✓' : '✗'} | ${r.id} | ${r.run} | ${r.turns.map((x) => x.request).join(' → ').replace(/\|/g, '\\|')} | ${r.seconds} | ${r.turns.flatMap((x, i) => x.checks.filter((c) => !c.ok).map((c) => `turn ${i + 1}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`)).join('; ').replace(/\|/g, '\\|') || '—'} |`),
    '',
  ].join('\n')
  mkdirSync(join(DIR, 'evals/results'), { recursive: true })
  writeFileSync(join(DIR, `evals/results/${stamp}-strict.json`), `${JSON.stringify({ set: 'strict', session, runs, useCache, promptVersion: repo.promptVersion, guideVersion: repo.guideVersion, right, total, results: out }, null, 2)}\n`)
  writeFileSync(join(DIR, `evals/results/${stamp}-strict.md`), md)
  if (writeGallery) writeFileSync(join(DIR, 'gallery/strict.json'), `${JSON.stringify(gallery, null, 2)}\n`)
  process.stdout.write(`${right} of ${total} passed. docs/output-system/evals/results/${stamp}-strict.md · session ${session} spend US$${(spend.bySession[session] ?? 0).toFixed(2)}\n`)
}

void main()
