// Claude as the generation writer (D-52, D-57). Server and CLI only — it holds
// the API key and is never imported by browser code (the chat page reaches it
// through /api/document-model).
//
// Two providers, chosen from the environment (D-65): OpenRouter (Souvenir's
// key, through OpenRouter's Anthropic-compatible Messages endpoint, pinned to
// Anthropic's own servers) or the Anthropic API directly. Same SDK, same
// request; only the base URL, the credential header and the model name differ.
//
// The model gets one tool, `submit_proposal`, whose input is the generation
// schema, and is told to call it. Opus 5.5 rejects forced tool use (D-66), so
// tool_choice is "auto"; a reply without the tool call is retried by the loop.
// Its input streams as it is written, so the chat can draft the document
// progressively; nothing it sends is trusted until the gate has checked it.

import Anthropic from '@anthropic-ai/sdk'

import { ModelError, type GenerationModel, type GenerationRequest, type ProposeOptions } from './model'
import { proposalJsonSchema } from './ops'

export type Provider = 'openrouter' | 'anthropic'

/** Latest Opus for first-pass generation (D-59), named the way each provider names it. */
export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  openrouter: 'anthropic/claude-opus-5.5',
}
export const DEFAULT_MODEL = DEFAULT_MODELS.anthropic

/** The SDK appends /v1/messages, so this is OpenRouter's /api root, not /api/v1. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api'

/** OpenRouter routes only to Anthropic itself, so behavior matches the direct API (no Bedrock or Vertex). */
const OPENROUTER_ROUTING = { provider: { order: ['anthropic'], allow_fallbacks: false } }

const KEY_NAMES: Record<Provider, string> = { openrouter: 'OPENROUTER_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }
const PROVIDER_NAMES: Record<Provider, string> = { openrouter: 'OpenRouter', anthropic: 'Anthropic' }

export const LIMITS = {
  // Thinking is always on for Opus 5.5 and counts toward this (D-66). Only what
  // is generated is billed; a proposal itself is a few hundred tokens.
  maxTokens: 16_000,
  timeoutMs: 90_000,
} as const

/** Set explicitly, at the model's documented default, so a default change can't shift behavior (D-66). */
export const EFFORT = 'medium' as const

const TOOL_NAME = 'submit_proposal'

export const SYSTEM_PROMPT = `You fill in business documents for people by proposing operations against a fixed schema. A program checks every operation before anything is saved, and refuses the whole proposal if any check fails.

The one rule that matters most: never invent a fact. Every value you set must be stated in the person's own words, and you must quote those exact words as the evidence (copied verbatim from the request or the earlier conversation, never paraphrased). Numbers you set must appear in the quote. If something is not stated, do not set it: leave it unknown. An honest unknown is shown to the person as missing and they can fill it in; an invented value on a sent invoice destroys trust.

Invoices:
- "Bill to" (buyer.name) is who the invoice is for. The issuer (issuer.name) is who sends it; only set it if the person says who they are.
- A "$" amount means USD unless another dollar currency is named. Set invoice.currency, quoting the amount.
- An amount with no breakdown becomes one line item: quantity 1, unit price equal to the amount, description null unless the request says what it is for. Also report it as statedAmount so the program can check the line items add up to it.
- Do not set the invoice number, dates, tax, discount, addresses or payment terms unless the person states them. Today's date is given to you, but an invoice date is only set when the person says so (for example "dated today").
- "Due in 30 days" with no invoice date: set payment.terms to say so (for example "Due within 30 days of the invoice date."), quoting the request.
- Tax: set tax.applicability only when stated; "no tax" or "tax exempt" means "exempt", and then tax.rate is setNotApplicable. The same for discount ("none").

Revising an existing document:
- Change only what the request asks for. Every other field and line item must stay exactly as it is.
- Every operation on an existing field or line item must carry its expectedDigest, copied from the document you are given.
- Never re-add something that already exists; use updateLineItem or removeLineItem with the item's id.

Follow-up: if an important fact is still missing (for an invoice: what the charge is for, who issues it, the invoice date, tax), ask about the single most useful one in followUp, as one short plain question with no preamble. Otherwise followUp is null.

If you are given previousErrors, your last proposal was refused for exactly those reasons: fix every one of them.

If the request is for something other than an invoice (a memo, a report, a deck, a letter), set intent.docType to "other", propose no operations, and set followUp to null: this generator makes invoices only so far.

Always respond by calling ${TOOL_NAME}, exactly once.`

/** The user turn: the task and everything the model may quote from, as JSON. */
export function userMessage(request: GenerationRequest): string {
  return JSON.stringify({
    task: request.task,
    docType: request.docType,
    request: request.request,
    earlierMessages: request.conversation,
    today: request.today,
    document: request.document,
    ...(request.previousErrors ? { previousErrors: request.previousErrors } : {}),
  })
}

function inputSchema() {
  const schema = proposalJsonSchema() as Record<string, unknown>
  delete schema.$schema
  return schema as Anthropic.Tool.InputSchema
}

export class ClaudeModel implements GenerationModel {
  readonly id: string
  readonly provider: Provider
  private readonly client: Anthropic

  constructor(options: { key: string; provider?: Provider; model?: string; client?: Anthropic; fetch?: typeof fetch }) {
    this.provider = options.provider ?? 'anthropic'
    this.id = options.model ?? DEFAULT_MODELS[this.provider]
    // The SDK retries transient failures (429, 5xx, connection) itself, twice by default.
    const common = { timeout: LIMITS.timeoutMs, maxRetries: 2, ...(options.fetch ? { fetch: options.fetch } : {}) }
    this.client = options.client ?? (this.provider === 'openrouter'
      // OpenRouter takes its key as a bearer token. apiKey is nulled so the SDK
      // never sends an ANTHROPIC_API_KEY from the environment there as x-api-key.
      ? new Anthropic({ ...common, baseURL: OPENROUTER_BASE_URL, authToken: options.key, apiKey: null })
      : new Anthropic({ ...common, apiKey: options.key }))
  }

  async propose(request: GenerationRequest, options: ProposeOptions = {}): Promise<unknown> {
    try {
      const stream = this.client.messages.stream({
        model: this.id,
        max_tokens: LIMITS.maxTokens,
        system: SYSTEM_PROMPT,
        tools: [{ name: TOOL_NAME, description: 'Submit the operations that fill in or revise the document.', input_schema: inputSchema(), eager_input_streaming: true }],
        tool_choice: { type: 'auto' },
        output_config: { effort: EFFORT },
        messages: [{ role: 'user', content: userMessage(request) }],
        // OpenRouter's own routing field; the SDK passes it through in the body.
        ...(this.provider === 'openrouter' ? OPENROUTER_ROUTING : {}),
      }, { signal: options.signal })
      if (options.onPartial) stream.on('inputJson', (_delta, snapshot) => options.onPartial?.(snapshot))
      const message = await stream.finalMessage()
      if (message.stop_reason === 'refusal') throw new ModelError('model-refused', 'The model declined this request.')
      const call = message.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME)
      if (!call || call.type !== 'tool_use') throw new ModelError('model-refused', 'The model answered without proposing any operations.', true)
      if (message.stop_reason === 'max_tokens') throw new ModelError('model-failed', 'The proposal was cut off at the output limit.', true)
      return call.input
    } catch (e) {
      throw toModelError(e, this.provider)
    }
  }
}

export function toModelError(e: unknown, provider: Provider = 'anthropic'): ModelError {
  if (e instanceof ModelError) return e
  if (e instanceof Anthropic.APIUserAbortError) return new ModelError('model-failed', 'The request was cancelled.')
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ModelError('model-unavailable', `The ${PROVIDER_NAMES[provider]} API key was rejected.`)
  }
  if (e instanceof Anthropic.APIError && e.status === 402) {
    return new ModelError('model-unavailable', `The ${PROVIDER_NAMES[provider]} account has run out of credits.`)
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ModelError('model-failed', 'The model took too long to answer.', true)
  if (e instanceof Anthropic.RateLimitError) return new ModelError('model-failed', 'The model is rate-limited right now. Try again shortly.', true)
  if (e instanceof Anthropic.APIError) return new ModelError('model-failed', `The model request failed (${e.status ?? 'no status'}).`, true)
  return new ModelError('model-failed', e instanceof Error ? e.message : String(e), true)
}

export type ProviderChoice =
  | { ok: true; provider: Provider; key: string; model: string }
  | { ok: false; error: ModelError }

/**
 * Which provider, key and model the environment asks for (D-65). MODEL_PROVIDER
 * picks one; unset (or blank), OpenRouter is used when its key is set, else
 * Anthropic. A provider that is named but has no key is an error: it never
 * falls back to the other one.
 */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): ProviderChoice {
  const value = (name: string) => env[name]?.trim() || undefined
  const named = value('MODEL_PROVIDER')?.toLowerCase()
  if (named && named !== 'openrouter' && named !== 'anthropic') {
    return { ok: false, error: new ModelError('model-unavailable', `MODEL_PROVIDER is "${named}"; it must be "openrouter" or "anthropic".`) }
  }
  const provider: Provider = (named as Provider | undefined) ?? (value('OPENROUTER_API_KEY') ? 'openrouter' : 'anthropic')
  const key = value(KEY_NAMES[provider])
  if (!key) {
    const unset = named ? `MODEL_PROVIDER is ${provider} but ${KEY_NAMES[provider]} is not set` : 'Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set'
    return { ok: false, error: new ModelError('model-unavailable', `${unset}, so no model can generate. Set it in .env.local (development) or in the Vercel Preview environment.`) }
  }
  const model = value(provider === 'openrouter' ? 'OPENROUTER_MODEL' : 'ANTHROPIC_MODEL') ?? DEFAULT_MODELS[provider]
  return { ok: true, provider, key, model }
}

/** The Claude model the environment configures; otherwise a model that says what is missing on every call. */
export function claudeModelFromEnv(env: Record<string, string | undefined> = process.env): GenerationModel {
  const choice = providerFromEnv(env)
  if (!choice.ok) return { id: 'unavailable', propose: async () => { throw choice.error } }
  return new ClaudeModel({ key: choice.key, provider: choice.provider, model: choice.model })
}
