// Server and script side of the output loop: reads the prompt, guides and
// formats.json from the repo, and makes model calls with spend tracking and a
// response cache (D-79, D-80). Node only: it reads files and holds the API key,
// so only the API route and scripts import it, never browser code.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { EFFORT, LIMITS, OPENROUTER_BASE_URL, providerFromEnv } from '../../documents/generation/claude'
import { cacheKey, versionOf } from '../cache'
import { loadPrompt } from '../evals'
import { LANES, type Lane } from '../lanes'
import { parseLedger, parseLimits, priceCall, spendStatus, summariseSpend, type SpendEntry } from '../spend'
import type { ModelCall } from './loop'

export class SpendLimitError extends Error {}
export class ModelUnavailableError extends Error {}

export type RepoFiles = { prompt: string; promptVersion: string; guides: Record<Lane, string>; guideVersion: string; formats: { kinds: Record<string, unknown>; formats: Record<string, { label: string }> } }

export function readRepoFiles(root = process.cwd()): RepoFiles {
  const dir = join(root, 'docs/output-system')
  const prompt = loadPrompt(readFileSync(join(dir, 'system-prompt.md'), 'utf8'))
  const guides = Object.fromEntries(LANES.map((l) => [l, readFileSync(join(dir, 'guides', `${l.replace(/_/g, '-')}.md`), 'utf8')])) as Record<Lane, string>
  const formatsText = readFileSync(join(dir, 'formats.json'), 'utf8')
  return {
    prompt,
    promptVersion: versionOf(prompt),
    guides,
    guideVersion: versionOf(LANES.map((l) => guides[l]).join('\n') + formatsText),
    formats: JSON.parse(formatsText),
  }
}

/** OpenRouter's routing field: Anthropic's own servers only (D-65). */
const OPENROUTER_ROUTING = { provider: { order: ['anthropic'], allow_fallbacks: false } }

export type CallOptions = {
  root?: string
  /** Build-loop session to charge (build-loop.md §9). */
  session: string
  lane: string
  purpose: string
  repo: RepoFiles
  /** Use cached responses for identical calls. Off for gate runs, which must sample the model again. */
  cache: boolean
  /** Varies the cache key, so repeated eval runs never share a cached answer. */
  run?: number
}

export function modelCall(options: CallOptions): { call: ModelCall; modelId: string } {
  const choice = providerFromEnv()
  if (!choice.ok) throw new ModelUnavailableError(choice.error.message)
  const root = options.root ?? process.cwd()
  const ledgerPath = join(root, 'docs/output-system/spend/ledger.jsonl')
  const buildLoop = join(root, 'docs/output-system/build-loop.md')
  const cacheDir = join(root, '.cache/output-system')
  const client =
    choice.provider === 'openrouter'
      ? new Anthropic({ baseURL: OPENROUTER_BASE_URL, authToken: choice.key, apiKey: null, timeout: LIMITS.timeoutMs, maxRetries: 2 })
      : new Anthropic({ apiKey: choice.key, timeout: LIMITS.timeoutMs, maxRetries: 2 })

  const call: ModelCall = async ({ system, messages, tools }) => {
    const params = { model: choice.model, max_tokens: LIMITS.maxTokens, system, messages, tools, tool_choice: { type: 'auto' as const }, output_config: { effort: EFFORT } }
    const key = cacheKey({ request: { ...params, system: system.slice(1), run: options.run ?? 0 }, promptVersion: options.repo.promptVersion, guideVersion: options.repo.guideVersion })
    const cached = join(cacheDir, `${key}.json`)
    const record = (message: Anthropic.Message, fromCache: boolean) => {
      const price = fromCache ? { costUsd: 0, estimated: false } : priceCall(message.usage, message.usage.input_tokens, message.usage.output_tokens)
      const entry: SpendEntry = {
        at: new Date().toISOString(),
        session: options.session,
        lane: options.lane,
        purpose: options.purpose,
        promptVersion: options.repo.promptVersion,
        model: message.model,
        inputTokens: fromCache ? 0 : message.usage.input_tokens,
        outputTokens: fromCache ? 0 : message.usage.output_tokens,
        costUsd: price.costUsd,
        ...(price.estimated ? { estimated: true } : {}),
        cached: fromCache,
      }
      mkdirSync(join(root, 'docs/output-system/spend'), { recursive: true })
      appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`)
    }
    if (options.cache && existsSync(cached)) {
      const message = JSON.parse(readFileSync(cached, 'utf8')) as Anthropic.Message
      record(message, true)
      return message
    }
    // Checked before every call, not once per request (build-loop.md §9).
    const ledger = existsSync(ledgerPath) ? parseLedger(readFileSync(ledgerPath, 'utf8')) : []
    const status = spendStatus(summariseSpend(ledger), options.session, parseLimits(existsSync(buildLoop) ? readFileSync(buildLoop, 'utf8') : ''))
    if (status.level === 'stop') throw new SpendLimitError(status.message)
    // Prompt caching: the tool definitions and the prompt are the same on every call, so they are
    // marked once (tools, then the first system block) and read back at a tenth of the input price.
    const cachedTools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t))
    const cachedSystem = system.map((b, i) => (i === 0 ? { ...b, cache_control: { type: 'ephemeral' as const } } : b))
    const message = await client.messages.create({
      ...params,
      tools: cachedTools,
      system: cachedSystem,
      ...(choice.provider === 'openrouter' ? { ...OPENROUTER_ROUTING, usage: { include: true } } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming)
    record(message, false)
    if (options.cache) {
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(cached, JSON.stringify(message))
    }
    return message
  }
  return { call, modelId: choice.model }
}
