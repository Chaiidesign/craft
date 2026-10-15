import type Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '@/app/api/document-model/route'
import { fixedEnv } from '@/lib/documents/fixtures/builders'
import { INVOICE_FIELDS as F } from '@/lib/documents/invoice'
import { emptyStore } from '@/lib/documents/revisions'

import { ClaudeModel, claudeModelFromEnv, DEFAULT_MODEL, SYSTEM_PROMPT } from './claude'
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

  it('forces the proposal tool with the generation schema and returns its input', async () => {
    const { client, calls } = fakeClient({ content: [{ type: 'tool_use', id: 't1', name: 'submit_proposal', input: proposal } as Anthropic.ToolUseBlock] }, [{ intent: proposal.intent }])
    const partials: unknown[] = []
    const out = await new ClaudeModel({ apiKey: 'test', client }).propose(request, { onPartial: (p) => partials.push(p) })
    expect(out).toEqual(proposal)
    expect(partials).toEqual([{ intent: proposal.intent }])
    const [params] = calls
    expect(params).toMatchObject({ model: DEFAULT_MODEL, system: SYSTEM_PROMPT, tool_choice: { type: 'tool', name: 'submit_proposal' } })
    const tool = params.tools?.[0] as Anthropic.Tool
    expect(tool.input_schema).not.toHaveProperty('$schema')
    expect(JSON.stringify(tool.input_schema)).toContain('addLineItem')
    expect(JSON.parse((params.messages[0].content as string))).toMatchObject({ task: 'generate', request: 'invoice for Acme, $2,400', today: '2026-10-01' })
  })

  it('reports a refusal or a missing tool call as model-refused, and a cut-off as model-failed', async () => {
    await expect(new ClaudeModel({ apiKey: 't', client: fakeClient({ stop_reason: 'refusal' }).client }).propose(request)).rejects.toMatchObject({ code: 'model-refused' })
    await expect(new ClaudeModel({ apiKey: 't', client: fakeClient({ content: [{ type: 'text', text: 'hi' } as Anthropic.TextBlock] }).client }).propose(request)).rejects.toMatchObject({ code: 'model-refused' })
    const cut = fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't', name: 'submit_proposal', input: {} } as Anthropic.ToolUseBlock] })
    await expect(new ClaudeModel({ apiKey: 't', client: cut.client }).propose(request)).rejects.toMatchObject({ code: 'model-failed', retryable: true })
  })

  it('uses DOCUMENT_MODEL when set, and never sends without a key', async () => {
    expect(claudeModelFromEnv({ ANTHROPIC_API_KEY: 'k', DOCUMENT_MODEL: 'claude-sonnet-5-5' }).id).toBe('claude-sonnet-5-5')
    expect(claudeModelFromEnv({ ANTHROPIC_API_KEY: 'k' }).id).toBe(DEFAULT_MODEL)
    await expect(claudeModelFromEnv({ ANTHROPIC_API_KEY: '  ' }).propose(request)).rejects.toMatchObject({ code: 'model-unavailable' })
  })
})
