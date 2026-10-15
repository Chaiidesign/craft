// The document tools from a terminal, for agents and scripts (D-51). Each call
// reads the revision store from a file, runs one tool, writes the store back,
// and prints the tool result as JSON on stdout. No UI is involved.
//
//   npx vite-node scripts/documents/agent.ts -- schemas
//   npx vite-node scripts/documents/agent.ts -- generate --store s.json --input '{"prompt":"invoice for Acme, $2,400"}'
//   npx vite-node scripts/documents/agent.ts -- revise   --store s.json --input '{"revisionId":"rev-…","instruction":"add a line item: design review, $600"}'
//   npx vite-node scripts/documents/agent.ts -- export   --store s.json --input '{"revisionId":"rev-…","format":"pdf"}' --out ./exports
//   npx vite-node scripts/documents/agent.ts -- show     --store s.json --input '{"revisionId":"rev-…"}'
//
// `--input-file f.json` reads the input from a file instead. Prompts and
// instructions need ANTHROPIC_API_KEY (read from the environment or from
// .env.local); `operations` inputs need no model. The exit code is 0 when the
// result is ok, 1 when the tool refused, 2 for a usage error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { emptyExports } from '../../src/lib/documents/export/jobs'
import { claudeModelFromEnv } from '../../src/lib/documents/generation/claude'
import { exportDocument, generateDocument, reviseDocument, toolSchemas } from '../../src/lib/documents/generation/tools'
import { documentView } from '../../src/lib/documents/generation/view'
import type { DocumentEnv } from '../../src/lib/documents/model'
import { emptyStore, getRevision, versionNumber, type RevisionStore } from '../../src/lib/documents/revisions'
import { parseSession, serializeSession } from '../../src/lib/documents/session'
import { nodeResources } from '../../src/lib/documents/testing/nodeResources'

function usage(message: string): never {
  process.stderr.write(`${message}\nUsage: agent.ts <schemas|generate|revise|export|show> --store <file> (--input '<json>' | --input-file <file>) [--out <dir>]\n`)
  process.exit(2)
}

const args = process.argv.slice(2).filter((a) => a !== '--')
const command = args[0]
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

if (!command) usage('No command given.')
if (command === 'schemas') {
  process.stdout.write(`${JSON.stringify(toolSchemas(), null, 2)}\n`)
  process.exit(0)
}

const storePath = flag('store') ?? usage('--store is required.')
const inputText = flag('input') ?? (flag('input-file') ? readFileSync(flag('input-file')!, 'utf8') : usage('--input or --input-file is required.'))
let input: unknown
try {
  input = JSON.parse(inputText)
} catch {
  usage('The input is not valid JSON.')
}

if (existsSync('.env.local') && !process.env.ANTHROPIC_API_KEY) process.loadEnvFile('.env.local')

// IDs carry a per-run token, so revisions made by separate runs never collide.
const run = Date.now().toString(36)
const counters = new Map<string, number>()
const env: DocumentEnv = {
  now: () => new Date().toISOString(),
  nextId: (prefix) => {
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    return `${prefix}-${run}-${String(n).padStart(3, '0')}`
  },
}

function loadStore(): RevisionStore {
  if (!existsSync(storePath)) return emptyStore()
  const loaded = parseSession(readFileSync(storePath, 'utf8'), env)
  if (loaded.status === 'loaded') return loaded.session.store
  if (loaded.status === 'empty') return emptyStore()
  process.stderr.write(`The store file ${storePath} can't be read: ${loaded.reason}. It was left unchanged.\n`)
  process.exit(2)
}

const saveStore = (store: RevisionStore) => writeFileSync(storePath, serializeSession({ store, exports: emptyExports(), deckId: null }))

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

const store = loadStore()
const ctx = { store, env, model: claudeModelFromEnv() }

switch (command) {
  case 'generate':
  case 'revise': {
    const out = command === 'generate' ? await generateDocument(input, ctx) : await reviseDocument(input, ctx)
    if (out.ok) saveStore(out.store)
    print(out.ok ? { ok: true, result: out.result } : { ok: false, error: out.error })
    process.exit(out.ok ? 0 : 1)
    break
  }
  case 'export': {
    const out = await exportDocument(input, { ...ctx, resources: nodeResources })
    if (!out.ok) {
      print({ ok: false, error: out.error })
      process.exit(1)
    }
    const dir = resolve(flag('out') ?? '.')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, out.result.filename)
    writeFileSync(path, out.result.bytes)
    const { bytes, ...result } = out.result
    print({ ok: true, result: { ...result, path, byteLength: bytes.byteLength } })
    process.exit(0)
    break
  }
  case 'show': {
    const revisionId = (input as { revisionId?: string }).revisionId ?? usage('show needs {"revisionId": "…"}.')
    try {
      const revision = getRevision(store, revisionId)
      print({ ok: true, result: { revisionId, outputId: revision.outputId, version: versionNumber(store, revisionId), changeSummary: revision.changeSummary, document: documentView(revision.snapshot) } })
      process.exit(0)
    } catch (e) {
      print({ ok: false, error: { code: 'not-found', message: e instanceof Error ? e.message : String(e), retryable: false } })
      process.exit(1)
    }
    break
  }
  default:
    usage(`Unknown command “${command}”.`)
}
