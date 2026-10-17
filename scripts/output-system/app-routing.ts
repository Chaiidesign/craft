// Does the app route the way the routing check says? (D-80) The routing check
// (route-eval.ts) asks the model to name an action under a test instruction.
// This runs the same 34 requests through the app's real loop (real tools, the
// guides, the store) and maps what it actually made to a lane, then scores it
// against the same expected lanes.
//
//   npx vite-node scripts/output-system/app-routing.ts -- --session 1
//
// Mapping, recorded here because it is a judgment:
// - a chat reply that is short, quotes no store figures and ends with a question → "ask";
// - a kind not built yet (a "coming later" card) → that kind's lane;
// - "coming later" for the same kind as the last thing made in the conversation → "update:<lane>";
// - the export action → "export:<lane of the last thing made>".
// r31 and r32 mention an attached file, so the eval uploads are attached to them.
// Where the context says an invoice was already made (r28), a real one is made
// first from that earlier message's own words, so "make it a PDF" has a document
// to export (Session 2).

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { runTurn, type Made } from '../../src/lib/output-system/agent/loop'
import { modelCall, readRepoFiles } from '../../src/lib/output-system/agent/server'
import { isRight, lastMade, parseEvalSet } from '../../src/lib/output-system/evals'
import { describeUpload, readUpload } from '../../src/lib/output-system/files/upload'
import { ANCHOR_DATE, sampleStore } from '../../src/lib/output-system/fixtures/stores'
import type { Lane, Outcome } from '../../src/lib/output-system/lanes'
import { emptyStore } from '../../src/lib/documents/revisions'
import { makeStrictDocument } from '../../src/lib/output-system/strict'

const ROOT = resolve(import.meta.dirname, '../..')
const DIR = join(ROOT, 'docs/output-system')
const args = process.argv.slice(2).filter((a) => a !== '--')
const session = args.includes('--session') ? args[args.indexOf('--session') + 1] : 'adhoc'
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
process.loadEnvFile(join(ROOT, '.env.local'))

const UPLOADS: Record<string, string> = { r31: 'fernhill-wholesale-prices.xlsx', r32: 'saffron-customers.csv' }

function outcome(made: Made, previous: Lane | undefined): Outcome | 'error' {
  switch (made.kind) {
    case 'reply': {
      const t = made.text.trim()
      return t.endsWith('?') && t.length < 300 && made.claims.length === 0 ? 'ask' : 'chat_reply'
    }
    case 'chart':
      return 'inline_chart'
    case 'file':
    case 'upload-change':
      return 'file'
    case 'format-options':
      return 'format_not_supported' as Outcome
    case 'document':
      return made.created ? 'strict_document' : 'update:strict_document'
    case 'export':
      return 'export:strict_document'
    case 'coming-later':
      if (made.lane === 'export') return previous ? `export:${previous}` : 'export:unknown'
      return previous && made.lane === previous ? `update:${previous}` : made.lane
    case 'error':
      return 'error'
  }
}

async function main() {
  const repo = readRepoFiles(ROOT)
  const set = parseEvalSet(readFileSync(join(DIR, 'evals/requests.jsonl'), 'utf8')).filter((r) => !only || only.includes(r.id))
  const { call } = modelCall({ root: ROOT, session, lane: 'routing', purpose: 'app-routing-34', repo, cache: false })
  const rows = []
  for (const r of set) {
    const store = sampleStore('fernhill-goods')
    const upload = UPLOADS[r.id] ? describeUpload(readUpload(UPLOADS[r.id], new Uint8Array(readFileSync(join(DIR, 'evals/uploads', UPLOADS[r.id]))))) : undefined
    let documents
    const env = { now: () => `${ANCHOR_DATE}T10:00:00.000Z`, nextId: (p: string) => `${p}-${r.id}-${Math.random().toString(16).slice(2, 8)}` }
    if (lastMade(r) === 'strict_document' && r.id === 'r28') {
      const said = r.context![0].text
      const made = makeStrictDocument({ type: 'invoice', operations: [
        { op: 'setField', fieldId: 'buyer.name', value: { type: 'text', text: 'Bloom & Co' }, provenance: { source: 'prompt', evidence: 'Invoice Bloom & Co' } },
        { op: 'addLineItem', description: 'Ceramic planters', quantity: '40', unitPrice: { amount: '18' }, provenance: { source: 'prompt', evidence: '40 ceramic planters at $18 each' } },
      ] }, { store, today: ANCHOR_DATE, env, sourceText: said, revisions: emptyStore() })
      if (!made.ok) throw new Error(`r28 seed: ${made.errors.join('; ')}`)
      documents = { revisions: made.revisions, current: made.outputId }
    }
    const result = await runTurn({ store, history: (r.context ?? []).map((t) => ({ role: t.role, text: t.text })), request: r.request, upload: upload as never, prompt: repo.prompt, guides: repo.guides, formats: repo.formats, call, today: ANCHOR_DATE, documents, env })
    const chosen = outcome(result.made, lastMade(r))
    const right = chosen !== 'error' && isRight(r, chosen as Outcome)
    process.stderr.write(`${right ? 'right' : 'MISS '} ${r.id} → ${chosen}\n`)
    rows.push({ id: r.id, request: r.request, expected: r.expected, ask_ok: r.ask_ok, chosen, right, made: result.made.kind, tools: result.toolsUsed, ...(result.made.kind === 'reply' ? { text: result.made.text } : {}) })
  }
  const right = rows.filter((x) => x.right).length
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const md = [
    `# App routing (real loop): ${right} of ${rows.length} right${only ? ` (only ${only.join(', ')})` : ''}`,
    '',
    `${new Date().toISOString()} · session ${session} · prompt \`${repo.promptVersion}\` · guides \`${repo.guideVersion}\` · one run, no cache`,
    '',
    'The 34 routing requests through the app’s own loop (scripts/output-system/app-routing.ts). The mapping from what was made to a lane is in the script header.',
    '',
    '| | Id | Request | Expected | Made (lane) | Tools used |',
    '|---|---|---|---|---|---|',
    ...rows.map((x) => `| ${x.right ? '✓' : '✗'} | ${x.id} | ${x.request.replace(/\|/g, '\\|')} | ${x.expected.join(' or ')}${x.ask_ok ? ' (asking is fine)' : ''} | ${x.chosen} | ${x.tools.join(' → ')} |`),
    '',
  ].join('\n')
  writeFileSync(join(DIR, `evals/results/${stamp}-app-routing.md`), md)
  writeFileSync(join(DIR, `evals/results/${stamp}-app-routing.json`), `${JSON.stringify(rows, null, 2)}\n`)
  process.stdout.write(`${right} of ${rows.length} right. docs/output-system/evals/results/${stamp}-app-routing.md\n`)
}

void main()
