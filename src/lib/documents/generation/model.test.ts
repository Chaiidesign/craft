import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '@/app/api/document-model/route'
import { fixedEnv } from '@/lib/documents/fixtures/builders'
import { INVOICE_FIELDS as F } from '@/lib/documents/invoice'
import { emptyStore } from '@/lib/documents/revisions'

import { ClaudeModel, claudeModelFromEnv, DEFAULT_MODEL, DEFAULT_MODELS, providerFromEnv, SYSTEM_PROMPT, toModelError } from './claude'
import { ModelError, ScriptedModel, type GenerationRequest } from './model'
import { handleModelRequest, resetRateLimits, ROUTE_LIMITS, type ModelEvent } from './modelRoute'
import { RemoteModel } from './remote'
import { blankInvoice, generateDocument } from './tools'
import { documentView } from './view'

const proposal = {
  intent: { docType: 'invoice', audience: 'recipient', summary: 'Invoice to Acme' },
  statedAmount: { amount: '2400', evidence: '$2,400' },
  operations: [
    { op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Acme' }, provenance: { source: 'prompt', evidence: 'Acme' } },
    { op: 'setField', fieldId: F.currency, value: { type: 'currency', code: 'USD' }, provenance: { source: 'prompt', evidence: '$2,400' } },
    { op: 'addLineItem', description: null, quantity: '1', unitPrice: { amount: '2400' }, provenance: { source: 'prompt', evidence: '$2,400' } },
  ],
  followUp: 'What does the $2,400 cover?',
}

const request: GenerationRequest = {
  task: 'generate', docType: 'invoice', request: 'invoice for Acme, $2,400', conversation: [], document: documentView(blankInvoice()), today: '2026-10-01',
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/document-model', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

async function events(response: Response): Promise<ModelEvent[]> {
  return (await response.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as ModelEvent)
}

beforeEach(() => resetRateLimits())
afterEach(() => vi.unstubAllEnvs())

describe('/api/document-model (D-56)', () => {
  it('streams partial proposals, then the proposal', async () => {
    const response = await handleModelRequest(post(request), new ScriptedModel([proposal]))
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(await events(response)).toEqual([{ type: 'partial', proposal }, { type: 'proposal', proposal }])
  })

  it('answers model-unavailable, as an error event, when no key is set', async () => {
    const response = await handleModelRequest(post(request), claudeModelFromEnv({}))
    expect(await events(response)).toEqual([expect.objectContaining({ type: 'error', code: 'model-unavailable', retryable: false })])
  })

  it('refuses oversized, non-JSON and off-schema bodies before calling the model', async () => {
    const model = new ScriptedModel([proposal])
    const big = await handleModelRequest(post('x'.repeat(ROUTE_LIMITS.maxBodyBytes + 1)), model)
    expect(big.status).toBe(413)
    const notJson = await handleModelRequest(post('{nope'), model)
    expect(notJson.status).toBe(400)
    const offSchema = await handleModelRequest(post({ ...request, task: 'delete-everything' }), model)
    expect(offSchema.status).toBe(400)
    expect(await events(offSchema)).toEqual([expect.objectContaining({ code: 'bad-request', message: expect.stringContaining('task') })])
    expect(model.requests).toHaveLength(0)
  })

  it('rate-limits one address', async () => {
    const model = new ScriptedModel(Array(ROUTE_LIMITS.requestsPerWindow).fill(proposal))
    for (let i = 0; i < ROUTE_LIMITS.requestsPerWindow; i++) await handleModelRequest(post(request, { 'x-forwarded-for': '203.0.113.9' }), model)
    const over = await handleModelRequest(post(request, { 'x-forwarded-for': '203.0.113.9' }), model)
    expect(over.status).toBe(429)
    const other = await handleModelRequest(post(request, { 'x-forwarded-for': '198.51.100.1' }), new ScriptedModel([proposal]))
    expect(other.status).toBe(200)
  })

  it('404s in production, and is open on Vercel previews', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await POST(post(request))).status).toBe(404)
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('MODEL_PROVIDER', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const preview = await POST(post(request))
    expect(preview.status).toBe(200)
    expect(await events(preview)).toEqual([expect.objectContaining({ code: 'model-unavailable' })])
  })
})

describe('RemoteModel: the browser end of the route', () => {
  const through = (model: ScriptedModel) => new RemoteModel('/api/document-model', async (_url, init) => handleModelRequest(post(JSON.parse(String(init?.body))), model))

  it('generates through the route with the same gate, passing partials on', async () => {
    const partials: unknown[] = []
    const out = await generateDocument({ prompt: 'invoice for Acme, $2,400' }, { store: emptyStore(), env: fixedEnv(), model: through(new ScriptedModel([proposal])), propose: { onPartial: (p) => partials.push(p) } })
    expect(out).toMatchObject({ ok: true, result: { version: 1, readiness: 'incomplete' } })
    expect(partials).toEqual([proposal])
  })

  it('turns error events into ModelErrors with their codes', async () => {
    const remote = through(new ScriptedModel([new ModelError('model-refused', 'The model declined this request.')]))
    await expect(remote.propose(request)).rejects.toMatchObject({ code: 'model-refused', message: 'The model declined this request.' })
    const gone = new RemoteModel('/x', async () => new Response('Not found', { status: 404 }))
    await expect(gone.propose(request)).rejects.toMatchObject({ code: 'model-unavailable' })
    const offline = new RemoteModel('/x', async () => { throw new TypeError('fetch failed') })
    await expect(offline.propose(request)).rejects.toMatchObject({ code: 'model-failed', retryable: true })
  })
})

describe('ClaudeModel (with a stand-in client; no network)', () => {
  function fakeClient(message: Partial<Anthropic.Message>, snapshots: unknown[] = []) {
    const calls: Anthropic.MessageCreateParams[] = []
    const client = {
      messages: {
        stream(params: Anthropic.MessageCreateParams) {
          calls.push(params)
          let onJson: ((delta: string, snapshot: unknown) => void) | undefined
          return {
            on(event: string, fn: (delta: string, snapshot: unknown) => void) { if (event === 'inputJson') onJson = fn; return this },
            async finalMessage() { snapshots.forEach((s) => onJson?.('', s)); return { stop_reason: 'tool_use', content: [], ...message } },
          }
        },
      },
    }
    return { client: client as unknown as Anthropic, calls }
  }

  it('offers the proposal tool with the generation schema (auto, D-66) and returns its input', async () => {
    const { client, calls } = fakeClient({ content: [{ type: 'tool_use', id: 't1', name: 'submit_proposal', input: proposal } as Anthropic.ToolUseBlock] }, [{ intent: proposal.intent }])
    const partials: unknown[] = []
    const out = await new ClaudeModel({ key: 'test', client }).propose(request, { onPartial: (p) => partials.push(p) })
    expect(out).toEqual(proposal)
    expect(partials).toEqual([{ intent: proposal.intent }])
    const [params] = calls
    expect(params).toMatchObject({ model: DEFAULT_MODEL, system: SYSTEM_PROMPT, tool_choice: { type: 'auto' }, output_config: { effort: 'medium' } })
    expect(params).not.toHaveProperty('thinking')
    const tool = params.tools?.[0] as Anthropic.Tool
    expect(tool.input_schema).not.toHaveProperty('$schema')
    expect(JSON.stringify(tool.input_schema)).toContain('addLineItem')
    expect(JSON.parse((params.messages[0].content as string))).toMatchObject({ task: 'generate', request: 'invoice for Acme, $2,400', today: '2026-10-01' })
  })

  it('reports a refusal or a missing tool call as model-refused, and a cut-off as model-failed', async () => {
    await expect(new ClaudeModel({ key: 't', client: fakeClient({ stop_reason: 'refusal' }).client }).propose(request)).rejects.toMatchObject({ code: 'model-refused' })
    await expect(new ClaudeModel({ key: 't', client: fakeClient({ content: [{ type: 'text', text: 'hi' } as Anthropic.TextBlock] }).client }).propose(request)).rejects.toMatchObject({ code: 'model-refused' })
    const cut = fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't', name: 'submit_proposal', input: {} } as Anthropic.ToolUseBlock] })
    await expect(new ClaudeModel({ key: 't', client: cut.client }).propose(request)).rejects.toMatchObject({ code: 'model-failed', retryable: true })
  })

  it('never sends without a key', async () => {
    await expect(claudeModelFromEnv({ ANTHROPIC_API_KEY: '  ' }).propose(request)).rejects.toMatchObject({ code: 'model-unavailable' })
  })

  it('sends OpenRouter the same request, at its /api root, with a bearer key, pinned to Anthropic', async () => {
    const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) })
      return new Response('{"type":"error","error":{"type":"authentication_error","message":"bad key"}}', { status: 401, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof globalThis.fetch
    vi.stubEnv('ANTHROPIC_API_KEY', 'direct-key-must-not-leak')
    const model = new ClaudeModel({ key: 'or-key', provider: 'openrouter', fetch })
    await expect(model.propose(request)).rejects.toMatchObject({ code: 'model-unavailable', message: 'The OpenRouter API key was rejected.' })
    expect(sent[0].url).toBe('https://openrouter.ai/api/v1/messages')
    expect(sent[0].headers.get('authorization')).toBe('Bearer or-key')
    expect(sent[0].headers.get('x-api-key')).toBeNull()
    expect(sent[0].body).toMatchObject({ model: 'anthropic/claude-opus-5.5', stream: true, tool_choice: { type: 'auto' }, provider: { order: ['anthropic'], allow_fallbacks: false } })
  })

  it('sends the direct API its x-api-key and no OpenRouter routing', async () => {
    const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) })
      return new Response('{"type":"error","error":{"type":"authentication_error","message":"bad key"}}', { status: 401, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof globalThis.fetch
    vi.stubEnv('ANTHROPIC_BASE_URL', '')
    await expect(new ClaudeModel({ key: 'a-key', fetch }).propose(request)).rejects.toMatchObject({ message: 'The Anthropic API key was rejected.' })
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(sent[0].headers.get('x-api-key')).toBe('a-key')
    expect(sent[0].body).toMatchObject({ model: DEFAULT_MODEL })
    expect(sent[0].body).not.toHaveProperty('provider')
  })

  it('reports an account out of credits as unavailable', () => {
    expect(toModelError(new Anthropic.APIError(402, { error: { message: 'Insufficient credits' } }, 'Insufficient credits', new Headers()), 'openrouter'))
      .toMatchObject({ code: 'model-unavailable', message: 'The OpenRouter account has run out of credits.', retryable: false })
  })
})

describe('choosing the provider from the environment (D-65)', () => {
  it('uses MODEL_PROVIDER when set, with that provider\'s key and model', () => {
    expect(providerFromEnv({ MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'or', ANTHROPIC_API_KEY: 'a' })).toEqual({ ok: true, provider: 'openrouter', key: 'or', model: DEFAULT_MODELS.openrouter })
    expect(providerFromEnv({ MODEL_PROVIDER: 'anthropic', OPENROUTER_API_KEY: 'or', ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'claude-sonnet-5-5' })).toEqual({ ok: true, provider: 'anthropic', key: 'a', model: 'claude-sonnet-5-5' })
    expect(providerFromEnv({ MODEL_PROVIDER: ' OpenRouter ', OPENROUTER_API_KEY: 'or', OPENROUTER_MODEL: 'anthropic/claude-sonnet-5.5' })).toMatchObject({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' })
  })

  it('unset or blank, prefers OpenRouter when its key exists, else Anthropic', () => {
    expect(providerFromEnv({ OPENROUTER_API_KEY: 'or', ANTHROPIC_API_KEY: 'a' })).toMatchObject({ provider: 'openrouter', key: 'or' })
    expect(providerFromEnv({ MODEL_PROVIDER: '', OPENROUTER_API_KEY: ' ', ANTHROPIC_API_KEY: 'a' })).toMatchObject({ provider: 'anthropic', key: 'a', model: DEFAULT_MODEL })
  })

  it('never falls back to the other provider when the named one has no key', () => {
    const choice = providerFromEnv({ MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: 'a' })
    expect(choice).toMatchObject({ ok: false, error: { code: 'model-unavailable', message: expect.stringContaining('MODEL_PROVIDER is openrouter but OPENROUTER_API_KEY is not set') } })
    expect(providerFromEnv({})).toMatchObject({ ok: false, error: { message: expect.stringContaining('Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set') } })
    expect(providerFromEnv({ MODEL_PROVIDER: 'bedrock', ANTHROPIC_API_KEY: 'a' })).toMatchObject({ ok: false, error: { message: 'MODEL_PROVIDER is "bedrock"; it must be "openrouter" or "anthropic".' } })
  })

  it('builds the model the choice names', () => {
    expect(claudeModelFromEnv({ OPENROUTER_API_KEY: 'or' })).toMatchObject({ id: 'anthropic/claude-opus-5.5', provider: 'openrouter' })
    expect(claudeModelFromEnv({ ANTHROPIC_API_KEY: 'a' })).toMatchObject({ id: DEFAULT_MODEL, provider: 'anthropic' })
  })
})
