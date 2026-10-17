// Routing harness for the output system (Phase 1, D-68). Sends each request in
// docs/output-system/evals/requests.jsonl to the model with the system prompt
// in docs/output-system/system-prompt.md, asks which action it would take
// first, maps that action to a lane, and writes a results table comparing the
// chosen lane with the expected one.
//
//   npx vite-node scripts/output-system/route-eval.ts
//   npx vite-node scripts/output-system/route-eval.ts -- --only r01,r26 --env-file ../craft/.env.local
//
// Flags:
//   --only ids        run only these request ids (comma-separated)
//   --env-file path   load model variables from this file (default: .env.local, if present).
//                     Variables already set in the environment win. Nothing is printed from it.
//   --no-env-file     load no file; use the environment only
//   --concurrency n   requests in flight at once (default 4)
//   --label text      added to the results file name
//
// The key comes from the environment (D-65): OPENROUTER_API_KEY or
// ANTHROPIC_API_KEY, chosen by MODEL_PROVIDER. With no key the harness stops
// with exit code 3 and says which variable to set. Results go to
// docs/output-system/evals/results/: <stamp>.json (every reply) and <stamp>.md
// (the table), plus latest.md.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { EFFORT, LIMITS, OPENROUTER_BASE_URL, providerFromEnv } from '../../src/lib/documents/generation/claude'
import { isRight, lastMade, loadPrompt, parseEvalSet, summarise, type EvalRequest, type ResultRow } from '../../src/lib/output-system/evals'
import { ACTIONS, isAction, LANE_LABELS, isLane, outcomeOf, type Outcome } from '../../src/lib/output-system/lanes'

const ROOT = resolve(import.meta.dirname, '../..')
const DIR = join(ROOT, 'docs/output-system')

const args = process.argv.slice(2).filter((a) => a !== '--')
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

// ── The test instruction ─────────────────────────────────────────────────────
// Sent as a second system block after the prompt, so the prompt file stays the
// product prompt. It shapes the result, so it is recorded (with its hash) in
// every results file.
const HARNESS_INSTRUCTION = `This conversation is a routing test, not a real request. Do not make anything and do not read any guide. Decide what you would do first for the person's latest message, following the instructions above, and report it by calling report_choice exactly once.

Choose action from: ${Object.keys(ACTIONS).join(', ')}.
- reply_in_chat: you would answer in chat.
- ask_question: you would ask the person one question before making anything; put the question in question.
- update_existing: you would update something already made in this conversation as a new version.
- export_version: you would export something already made in this conversation in a format, without changing it.
- show_format_options: you would tell the person it can't be made in the format they named, and offer the closest formats.
- Any other action: the action named in the instructions above that you would use first.`

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report_choice',
  description: 'Report the first action you would take for the latest message.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: Object.keys(ACTIONS) },
      question: { type: 'string', description: 'The one question you would ask, when action is ask_question.' },
      reason: { type: 'string', description: 'One short sentence: which instruction decided it.' },
    },
    required: ['action', 'reason'],
  },
}

/** Same routing as the document model (D-65): Anthropic's own servers only. */
const OPENROUTER_ROUTING = { provider: { order: ['anthropic'], allow_fallbacks: false } }

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12)

function messagesFor(r: EvalRequest): Anthropic.MessageParam[] {
  const turns: Anthropic.MessageParam[] = (r.context ?? []).map((t) => ({
    role: t.role === 'person' ? 'user' : 'assistant',
    content: t.text,
  }))
  return [...turns, { role: 'user', content: r.request }]
}

type Choice = { action: string; question?: string; reason?: string }

function readChoice(message: Anthropic.Message): Choice | undefined {
  const call = message.content.find((c) => c.type === 'tool_use' && c.name === REPORT_TOOL.name)
  if (call?.type === 'tool_use') return call.input as Choice
  // A plain JSON reply also counts, if it names an action.
  const text = message.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n')
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  try {
    const parsed = json ? JSON.parse(json) : undefined
    if (parsed && typeof parsed.action === 'string') return parsed
  } catch {
    // fall through: unparsed
  }
  return undefined
}

async function main() {
  if (!args.includes('--no-env-file')) {
    const envFile = resolve(flag('env-file') ?? join(ROOT, '.env.local'))
    if (existsSync(envFile)) process.loadEnvFile(envFile)
    else if (flag('env-file')) {
      process.stderr.write(`No env file at ${envFile}.\n`)
      process.exit(2)
    }
  }

  const prompt = loadPrompt(readFileSync(join(DIR, 'system-prompt.md'), 'utf8'))
  const only = flag('only')?.split(',').map((s) => s.trim())
  const set = parseEvalSet(readFileSync(join(DIR, 'evals/requests.jsonl'), 'utf8')).filter((r) => !only || only.includes(r.id))
  if (set.length === 0) {
    process.stderr.write('No requests match --only.\n')
    process.exit(2)
  }

  const choice = providerFromEnv()
  if (!choice.ok) {
    process.stderr.write(
      `The harness is built but cannot run: ${choice.error.message}\n` +
        'Set OPENROUTER_API_KEY (or MODEL_PROVIDER=anthropic and ANTHROPIC_API_KEY) in the environment or in the file passed with --env-file, then run again.\n',
    )
    process.exit(3)
  }

  const client = choice.provider === 'openrouter'
    ? new Anthropic({ baseURL: OPENROUTER_BASE_URL, authToken: choice.key, apiKey: null, timeout: LIMITS.timeoutMs, maxRetries: 2 })
    : new Anthropic({ apiKey: choice.key, timeout: LIMITS.timeoutMs, maxRetries: 2 })

  async function route(r: EvalRequest): Promise<ResultRow & { raw: unknown; modelId?: string }> {
    let last: Anthropic.Message | undefined
    let picked: Choice | undefined
    let error: string | undefined
    // One retry when the reply names no action (tool use can't be forced on Opus 5.5, D-66).
    for (let attempt = 0; attempt < 2 && !picked; attempt++) {
      try {
        last = await client.messages.create({
          model: choice.ok ? choice.model : '',
          max_tokens: LIMITS.maxTokens,
          system: [{ type: 'text', text: prompt }, { type: 'text', text: HARNESS_INSTRUCTION }],
          tools: [REPORT_TOOL],
          tool_choice: { type: 'auto' },
          output_config: { effort: EFFORT },
          messages: messagesFor(r),
          ...(choice.ok && choice.provider === 'openrouter' ? OPENROUTER_ROUTING : {}),
        })
        picked = readChoice(last)
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
        break
      }
    }
    const chosen: Outcome = picked && isAction(picked.action) ? outcomeOf(picked.action, lastMade(r)) : 'unparsed'
    return {
      id: r.id,
      request: r.request,
      expected: r.expected,
      ask_ok: r.ask_ok,
      chosen,
      right: isRight(r, chosen),
      reason: error ? `error: ${error}` : (picked?.reason ?? 'no action named'),
      ...(picked?.question ? { question: picked.question } : {}),
      raw: last?.content.filter((c) => c.type !== 'thinking') ?? null,
      modelId: last?.model,
    }
  }

  const concurrency = Math.max(1, Number(flag('concurrency') ?? 4))
  const rows: Awaited<ReturnType<typeof route>>[] = new Array(set.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, set.length) }, async () => {
      while (next < set.length) {
        const i = next++
        rows[i] = await route(set[i])
        process.stderr.write(`${rows[i].right ? 'right' : 'MISS '} ${rows[i].id} → ${rows[i].chosen}\n`)
      }
    }),
  )

  const { right, total, misses } = summarise(rows)
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19) + (flag('label') ? `-${flag('label')}` : '')
  const answeredBy = [...new Set(rows.map((r) => r.modelId).filter(Boolean))].join(', ') || 'none'
  const meta = {
    date: now.toISOString(),
    provider: choice.provider,
    modelRequested: choice.model,
    modelAnswered: answeredBy,
    effort: EFFORT,
    promptSha: sha(prompt),
    instructionSha: sha(HARNESS_INSTRUCTION),
    right,
    total,
  }

  const label = (o: Outcome) => {
    if (isLane(o)) return LANE_LABELS[o]
    const acted = o.match(/^(update|export):(.+)$/)
    if (acted && isLane(acted[2])) return `${acted[1] === 'update' ? 'Update' : 'Export'} (${LANE_LABELS[acted[2]]})`
    if (o === 'format_not_supported') return 'Format not supported (offer closest)'
    return o === 'ask' ? 'Ask a question' : o
  }
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const md = [
    `# Routing results: ${right} of ${total} right`,
    '',
    `${meta.date} · ${meta.provider} · requested \`${meta.modelRequested}\`, answered by \`${meta.modelAnswered}\` · effort ${meta.effort} · prompt \`${meta.promptSha}\` · test instruction \`${meta.instructionSha}\``,
    '',
    'Generated by `scripts/output-system/route-eval.ts`. "Right" means the chosen lane is one of the expected lanes, or the model asked a question where asking is allowed.',
    '',
    '| | Id | Request | Expected | Chosen | Reason given |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) =>
      `| ${r.right ? '✓' : '✗'} | ${r.id} | ${cell(r.request)} | ${cell(r.expected.map(label).join(' or ') + (r.ask_ok ? ' (asking is fine)' : ''))} | ${cell(label(r.chosen))} | ${cell(r.question ? `Asks: "${r.question}" ${r.reason}` : r.reason)} |`,
    ),
    '',
    misses.length ? `## Misses (${misses.length})\n\n${misses.map((m) => `- **${m.id}** "${cell(m.request)}": expected ${m.expected.map(label).join(' or ')}, chose ${label(m.chosen)}.`).join('\n')}` : '## Misses\n\nNone.',
    '',
  ].join('\n')

  const out = join(DIR, 'evals/results')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${stamp}.json`), `${JSON.stringify({ meta, instruction: HARNESS_INSTRUCTION, rows }, null, 2)}\n`)
  writeFileSync(join(out, `${stamp}.md`), md)
  writeFileSync(join(out, 'latest.md'), md)
  process.stdout.write(`${right} of ${total} right. Results: docs/output-system/evals/results/${stamp}.md\n`)
}

void main()
