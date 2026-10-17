// Session evals for the launch kinds (build-loop.md §8): runs each request in
// docs/output-system/evals/<set>.jsonl through the same loop the app uses, then
// applies the automatic checks. Rubric scores are not made here; they are
// advisory and recorded by hand in docs/output-system/gallery/scores.json.
//
//   npx vite-node scripts/output-system/lane-eval.ts -- --set chat --session 1
//   npx vite-node scripts/output-system/lane-eval.ts -- --set file --session 1 --runs 3 --no-cache
//
// --runs n      runs per request (gate runs: 3, with --no-cache)
// --no-cache    sample the model again (required for gate runs)
// --only ids    run only these ids
// --gallery     also write gallery items (outputs and files) for /output-verify/gallery
//
// Spend is charged to --session in docs/output-system/spend/ledger.jsonl, and
// a spend limit stops the run (exit 4).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { nodeResources } from '../../src/lib/documents/testing/nodeResources'
import { runTurn, type Made } from '../../src/lib/output-system/agent/loop'
import { modelCall, readRepoFiles, SpendLimitError } from '../../src/lib/output-system/agent/server'
import { buildFile } from '../../src/lib/output-system/files/build'
import { parseCsv } from '../../src/lib/output-system/files/csv'
import { buildDataset } from '../../src/lib/output-system/files/datasets'
import { applyChanges, describeUpload, readUpload, writeUpload } from '../../src/lib/output-system/files/upload'
import { readXlsx } from '../../src/lib/output-system/files/xlsx'
import { lowStock } from '../../src/lib/output-system/fixtures/aggregates'
import { ANCHOR_DATE, sampleStore, type StoreId } from '../../src/lib/output-system/fixtures/stores'
import { checkNumbers } from '../../src/lib/output-system/numbers'
import { parseLedger, summariseSpend } from '../../src/lib/output-system/spend'
import { findForbiddenWords } from '../../src/lib/output-system/words'

const ROOT = resolve(import.meta.dirname, '../..')
const DIR = join(ROOT, 'docs/output-system')
const args = process.argv.slice(2).filter((a) => a !== '--')
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined)
const set = flag('set') ?? 'chat'
const runs = Number(flag('runs') ?? 1)
const session = flag('session') ?? 'adhoc'
const only = flag('only')?.split(',')
const useCache = !args.includes('--no-cache')
const writeGallery = args.includes('--gallery')

if (existsSync(join(ROOT, '.env.local'))) process.loadEnvFile(join(ROOT, '.env.local'))

type Expect = {
  lane?: string
  /** Any of these is right (as in the routing set's ambiguous cases). */
  lanes?: string[]
  usesStoreData?: boolean
  format?: string
  dataset?: 'orders' | 'products' | 'customers'
  from?: string
  to?: string
  status?: string[]
  lowStockOnly?: boolean
  upload?: boolean
  keepsStructure?: boolean
  rowsAfter?: number
}
type Item = { id: string; store: StoreId; request: string; upload?: string; expect: Expect; note?: string }

type Check = { name: string; ok: boolean; detail?: string }

const items = readFileSync(join(DIR, `evals/${set}.jsonl`), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Item).filter((i) => !only || only.includes(i.id))

/** Rows the request should give, computed from the sample store (never from the model's spec). */
function expectedRows(item: Item): number | undefined {
  const s = sampleStore(item.store)
  const e = item.expect
  if (e.dataset === 'orders') return s.orders.filter((o) => (!e.from || o.date >= e.from) && (!e.to || o.date <= e.to) && (!e.status || e.status.includes(o.status))).length
  if (e.dataset === 'products') return e.lowStockOnly ? lowStock(s).length : s.products.length
  if (e.dataset === 'customers') return s.customers.length
  return undefined
}

async function checkFile(item: Item, made: Made): Promise<{ checks: Check[]; file?: { name: string; bytes: Uint8Array; rows: number; summary?: string[]; preview: unknown[][] } }> {
  const checks: Check[] = []
  const e = item.expect
  const store = sampleStore(item.store)
  if (made.kind === 'upload-change') {
    const original = readUpload(basename(item.upload!), new Uint8Array(readFileSync(join(DIR, 'evals', item.upload!))))
    const { upload: changed, summary } = applyChanges(original, made.changes)
    const bytes = writeUpload(changed)
    const back = original.format === 'csv' ? parseCsv(new TextDecoder().decode(bytes)) : readXlsx(bytes).rows
    const header = (back[0] ?? []).map(String)
    checks.push({ name: 'opens and parses back', ok: back.length > 0 })
    checks.push({ name: 'same format', ok: original.format === e.format, detail: original.format })
    checks.push({ name: 'same columns in the same order', ok: JSON.stringify(header) === JSON.stringify(original.header), detail: header.join(' | ') })
    if (original.format === 'xlsx') checks.push({ name: 'same sheet name', ok: readXlsx(bytes).sheetName === original.sheetName })
    if (e.rowsAfter !== undefined) checks.push({ name: `rows after the change = ${e.rowsAfter}`, ok: back.length - 1 === e.rowsAfter, detail: String(back.length - 1) })
    if (item.id === 'f07') {
      const col = header.findIndex((h) => /price/i.test(h))
      checks.push({ name: 'every price ends in .99 and is 5% higher before rounding', ok: back.slice(1).every((r, i) => String(r[col]).endsWith('.99') && Math.abs(Number(r[col]) - Number(original.rows[i][col]) * 1.05) <= 0.5) })
    }
    return { checks, file: { name: original.fileName.replace(/(\.[a-z]+)$/i, ' (changed)$1'), bytes, rows: back.length - 1, summary, preview: back.slice(0, 9) } }
  }
  if (made.kind !== 'file') return { checks }
  checks.push({ name: `format ${e.format}`, ok: made.spec.format === e.format, detail: made.spec.format })
  checks.push({ name: `dataset ${e.dataset}`, ok: made.spec.dataset === e.dataset, detail: made.spec.dataset })
  const file = await buildFile(store, made.spec, { resources: nodeResources })
  const want = expectedRows(item)
  checks.push({ name: `rows match the sample store (${want})`, ok: file.rows === want, detail: String(file.rows) })
  const { table } = buildDataset(store, made.spec)
  let preview: unknown[][] = [table.columns.map((c) => c.label), ...table.rows.slice(0, 8)]
  if (file.format === 'xlsx') {
    const back = readXlsx(file.bytes)
    checks.push({ name: 'opens and parses back, one header row', ok: JSON.stringify(back.rows[0]) === JSON.stringify(table.columns.map((c) => c.label)) && back.rows.length === file.rows + 1 })
    const dateCols = table.columns.map((c, i) => (c.type === 'date' ? i : -1)).filter((i) => i >= 0)
    checks.push({ name: 'dates are real dates (ISO when read)', ok: dateCols.every((i) => back.rows.slice(1).every((r) => r[i] === null || /^\d{4}-\d{2}-\d{2}$/.test(String(r[i])))) })
  } else if (file.format === 'csv') {
    const back = parseCsv(new TextDecoder().decode(file.bytes))
    checks.push({ name: 'opens and parses back, one header row', ok: back.length === file.rows + 1 && back[0].join() === table.columns.map((c) => c.label).join() })
    preview = back.slice(0, 9)
  } else if (file.format === 'json') {
    const parsed = JSON.parse(new TextDecoder().decode(file.bytes)) as { records: unknown[] }
    checks.push({ name: 'valid JSON, one record per row', ok: parsed.records.length === file.rows })
  } else {
    checks.push({ name: 'a real PDF', ok: new TextDecoder().decode(file.bytes.slice(0, 5)) === '%PDF-' })
  }
  checks.push({ name: 'currency in its own column', ok: table.columns.some((c) => c.key === 'currency') || made.spec.dataset !== 'orders' })
  return { checks, file: { name: file.fileName, bytes: file.bytes, rows: file.rows, preview } }
}

async function main() {
  const repo = readRepoFiles(ROOT)
  const out: unknown[] = []
  const gallery: unknown[] = []
  let right = 0
  let total = 0
  for (let run = 1; run <= runs; run++) {
    for (const item of items) {
      const { call } = modelCall({ root: ROOT, session, lane: set === 'chat' ? 'chat_reply' : set === 'chart' ? 'inline_chart' : 'file', purpose: `eval-${set}`, repo, cache: useCache, run: useCache ? 0 : run })
      const store = sampleStore(item.store)
      const upload = item.upload ? describeUpload(readUpload(basename(item.upload), new Uint8Array(readFileSync(join(DIR, 'evals', item.upload))))) : undefined
      const t0 = Date.now()
      let result
      try {
        result = await runTurn({ store, history: [], request: item.request, upload: upload as never, prompt: repo.prompt, guides: repo.guides, formats: repo.formats, call, today: ANCHOR_DATE })
      } catch (e) {
        if (e instanceof SpendLimitError) {
          process.stderr.write(`${e.message} Stopping.\n`)
          process.exit(4)
        }
        throw e
      }
      const seconds = Math.round((Date.now() - t0) / 100) / 10
      const made = result.made
      const checks: Check[] = []
      const e = item.expect
      const kind = made.kind === 'chart' ? 'inline_chart' : made.kind === 'reply' ? 'chat_reply' : made.kind === 'file' || made.kind === 'upload-change' ? 'file' : made.kind === 'format-options' ? 'format_not_supported' : made.kind === 'coming-later' ? made.lane : 'error'
      const lanes = e.lanes ?? [e.lane!]
      checks.push({ name: `made a ${lanes.join(' or ')}`, ok: lanes.includes(kind), detail: kind })
      // Tools in one model step run together, so order within a step doesn't matter; what matters is that the guide was read before the answer was written.
      // The chat-reply guide is sent with every turn (D-85); anything else must be read with read_guide before it is made.
      checks.push({ name: 'read the guide before answering', ok: made.kind === 'reply' || result.toolsUsed.includes('read_guide'), detail: result.toolsUsed.join(' → ') || 'chat-reply guide sent with the turn' })
      let file
      if (made.kind === 'reply') {
        const n = checkNumbers(made.text, [...result.storeAnswers, item.request])
        checks.push({ name: 'every store number matches the sample data', ok: n.ok, detail: n.unmatched.map((c) => c.text).join(', ') || `${n.claims.length} checked` })
        checks.push({ name: 'no system words on screen', ok: findForbiddenWords(made.text).length === 0 })
        if (e.usesStoreData !== undefined) checks.push({ name: e.usesStoreData ? 'asked the store' : 'needed no store data', ok: e.usesStoreData ? made.usedStore : true, detail: made.usedStore ? 'asked' : 'did not ask' })
      }
      if (made.kind === 'file' || made.kind === 'upload-change') {
        const f = await checkFile(item, made)
        checks.push(...f.checks)
        file = f.file
      }
      if (made.kind === 'chart') {
        const n = checkNumbers(made.lead, [made.chart.answer, ...result.storeAnswers, item.request])
        checks.push({ name: 'lead numbers match the chart', ok: n.ok, detail: n.unmatched.map((c) => c.text).join(', ') || `${n.claims.length} checked` })
        checks.push({ name: 'title in words, at most 12 bars or 24 points', ok: made.chart.title.length >= 3 && made.chart.points.length <= (made.chart.chartType === 'bar' ? 12 : 24) })
        checks.push({ name: 'no system words on screen', ok: findForbiddenWords(`${made.lead} ${made.chart.title}`).length === 0 })
      }
      if (made.kind === 'format-options') {
        const built = ['Excel', 'CSV', 'JSON', 'PDF']
        checks.push({ name: 'offers only formats the file kind exports', ok: made.offered.every((o) => built.some((b) => b.toLowerCase() === o.toLowerCase())), detail: made.offered.join(', ') })
        checks.push({ name: 'no system words on screen', ok: findForbiddenWords(made.message).length === 0 })
      }
      const ok = checks.every((c) => c.ok)
      right += ok ? 1 : 0
      total++
      process.stderr.write(`${ok ? 'pass' : 'FAIL'} ${item.id} run ${run} (${seconds}s, ${result.calls} calls)${ok ? '' : `: ${checks.filter((c) => !c.ok).map((c) => `${c.name} [${c.detail ?? ''}]`).join('; ')}`}\n`)
      out.push({ id: item.id, run, store: item.store, request: item.request, seconds, calls: result.calls, toolsUsed: result.toolsUsed, made, checks, ok })
      if (writeGallery && run === 1) {
        const dir = join(DIR, 'gallery/files')
        mkdirSync(dir, { recursive: true })
        if (file) writeFileSync(join(dir, `${item.id}-${file.name}`), file.bytes)
        gallery.push({ id: item.id, store: item.store, storeName: store.name, request: item.request, made, ok, checks, seconds, ...(file ? { file: { name: file.name, path: `files/${item.id}-${file.name}`, rows: file.rows, bytes: file.bytes.byteLength, preview: file.preview, summary: file.summary } } : {}) })
      }
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const ledger = parseLedger(readFileSync(join(DIR, 'spend/ledger.jsonl'), 'utf8'))
  const spend = summariseSpend(ledger)
  const rows = out as { id: string; run: number; request: string; ok: boolean; seconds: number; checks: Check[] }[]
  const md = [
    `# ${set} eval: ${right} of ${total} passed`,
    '',
    `${new Date().toISOString()} · session ${session} · ${runs} run(s) · cache ${useCache ? 'on (iterating)' : 'off (gate run)'} · prompt \`${repo.promptVersion}\` · guides \`${repo.guideVersion}\` · session spend so far US$${(spend.bySession[session] ?? 0).toFixed(2)}`,
    '',
    'Automatic checks only (build-loop.md §8). Rubric scores are advisory and kept in `docs/output-system/gallery/scores.json`.',
    '',
    '| | Id | Run | Request | Seconds | Failed checks |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.ok ? '✓' : '✗'} | ${r.id} | ${r.run} | ${r.request.replace(/\|/g, '\\|')} | ${r.seconds} | ${r.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ').replace(/\|/g, '\\|') || '—'} |`),
    '',
  ].join('\n')
  mkdirSync(join(DIR, 'evals/results'), { recursive: true })
  writeFileSync(join(DIR, `evals/results/${stamp}-${set}.json`), `${JSON.stringify({ set, session, runs, useCache, promptVersion: repo.promptVersion, guideVersion: repo.guideVersion, right, total, results: out }, null, 2)}\n`)
  writeFileSync(join(DIR, `evals/results/${stamp}-${set}.md`), md)
  if (writeGallery) writeFileSync(join(DIR, `gallery/${set}.json`), `${JSON.stringify(gallery, null, 2)}\n`)
  process.stdout.write(`${right} of ${total} passed. docs/output-system/evals/results/${stamp}-${set}.md · session ${session} spend US$${(spend.bySession[session] ?? 0).toFixed(2)}\n`)
}

void main()
