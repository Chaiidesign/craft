// Claude as the generation writer (D-52, D-57). Server and CLI only — it holds
// the API key and is never imported by browser code (the chat page reaches it
// through /api/document-model).
//
// The model gets one tool, `submit_proposal`, whose input is the generation
// schema, and is forced to call it. Its input streams as it is written, so the
// chat can draft the document progressively; nothing it sends is trusted until
// the gate has checked it.

import Anthropic from '@anthropic-ai/sdk'

import { ModelError, type GenerationModel, type GenerationRequest, type ProposeOptions } from './model'
import { proposalJsonSchema } from './ops'

/** Latest Opus for first-pass generation (D-59). */
export const DEFAULT_MODEL = 'claude-opus-5-5'

export const LIMITS = {
  maxTokens: 4096,
  timeoutMs: 90_000,
} as const

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
  private readonly client: Anthropic

  constructor(options: { apiKey: string; model?: string; client?: Anthropic }) {
    this.id = options.model ?? DEFAULT_MODEL
    // The SDK retries transient failures (429, 5xx, connection) itself, twice by default.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: LIMITS.timeoutMs, maxRetries: 2 })
  }

  async propose(request: GenerationRequest, options: ProposeOptions = {}): Promise<unknown> {
    try {
      const stream = this.client.messages.stream({
        model: this.id,
        max_tokens: LIMITS.maxTokens,
        system: SYSTEM_PROMPT,
        tools: [{ name: TOOL_NAME, description: 'Submit the operations that fill in or revise the document.', input_schema: inputSchema(), eager_input_streaming: true }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: userMessage(request) }],
      }, { signal: options.signal })
      if (options.onPartial) stream.on('inputJson', (_delta, snapshot) => options.onPartial?.(snapshot))
      const message = await stream.finalMessage()
      if (message.stop_reason === 'refusal') throw new ModelError('model-refused', 'The model declined this request.')
      const call = message.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME)
      if (!call || call.type !== 'tool_use') throw new ModelError('model-refused', 'The model answered without proposing any operations.', true)
      if (message.stop_reason === 'max_tokens') throw new ModelError('model-failed', 'The proposal was cut off at the output limit.', true)
      return call.input
    } catch (e) {
      throw toModelError(e)
    }
  }
}

export function toModelError(e: unknown): ModelError {
  if (e instanceof ModelError) return e
  if (e instanceof Anthropic.APIUserAbortError) return new ModelError('model-failed', 'The request was cancelled.')
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ModelError('model-unavailable', 'The Anthropic API key was rejected.')
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ModelError('model-failed', 'The model took too long to answer.', true)
  if (e instanceof Anthropic.RateLimitError) return new ModelError('model-failed', 'The model is rate-limited right now. Try again shortly.', true)
  if (e instanceof Anthropic.APIError) return new ModelError('model-failed', `The model request failed (${e.status ?? 'no status'}).`, true)
  return new ModelError('model-failed', e instanceof Error ? e.message : String(e), true)
}

/** The Claude model when `ANTHROPIC_API_KEY` is set; otherwise a model that says so on every call. */
export function claudeModelFromEnv(env: Record<string, string | undefined> = process.env): GenerationModel {
  const apiKey = env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    return {
      id: 'unavailable',
      propose: async () => { throw new ModelError('model-unavailable', 'ANTHROPIC_API_KEY is not set, so no model can generate. Set it in .env.local (development) or in the Vercel Preview environment.') },
    }
  }
  return new ClaudeModel({ apiKey, model: env.DOCUMENT_MODEL?.trim() || undefined })
}
