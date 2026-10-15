// The body of /api/document-model, kept apart from the route file so it can be
// tested with any model. Input is checked against a schema and size caps; the
// answer is NDJSON: zero or more `partial` events while the proposal streams,
// then exactly one `proposal` or `error`.

import { z } from 'zod'

import { GENERATABLE_KINDS } from './ops'
import { ModelError, type GenerationModel, type GenerationRequest } from './model'

export const ROUTE_LIMITS = {
  /** Largest request body accepted, in bytes. */
  maxBodyBytes: 256 * 1024,
  /** Requests per client address per window. Best effort: counted per server instance. */
  requestsPerWindow: 40,
  windowMs: 10 * 60_000,
  /** Least time between two `partial` events. */
  partialIntervalMs: 120,
} as const

const GateErrorSchema = z.object({ code: z.string().max(40), path: z.string().max(200), target: z.string().max(200).optional(), message: z.string().max(1000), retryable: z.boolean() })

export const GenerationRequestSchema = z.object({
  task: z.enum(['generate', 'revise']),
  docType: z.enum(GENERATABLE_KINDS),
  request: z.string().min(1).max(4000),
  conversation: z.array(z.string().max(4000)).max(40),
  document: z.record(z.string(), z.unknown()),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  previousErrors: z.array(GateErrorSchema).max(60).optional(),
}).strict()

export type ModelEvent =
  | { type: 'partial'; proposal: unknown }
  | { type: 'proposal'; proposal: unknown }
  | { type: 'error'; code: ModelError['code'] | 'bad-request' | 'too-large' | 'rate-limited'; message: string; retryable: boolean }

const hits = new Map<string, number[]>()

/** True when this address is over its budget; records the hit otherwise. */
export function rateLimited(address: string, now = Date.now()): boolean {
  const recent = (hits.get(address) ?? []).filter((t) => now - t < ROUTE_LIMITS.windowMs)
  if (recent.length >= ROUTE_LIMITS.requestsPerWindow) {
    hits.set(address, recent)
    return true
  }
  hits.set(address, [...recent, now])
  return false
}

export const resetRateLimits = () => hits.clear()

const json = (event: ModelEvent, status: number) =>
  new Response(`${JSON.stringify(event)}\n`, { status, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })

export async function handleModelRequest(request: Request, model: GenerationModel): Promise<Response> {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (rateLimited(address)) return json({ type: 'error', code: 'rate-limited', message: 'Too many requests. Wait a few minutes and try again.', retryable: true }, 429)

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > ROUTE_LIMITS.maxBodyBytes) return json({ type: 'error', code: 'too-large', message: 'The request is too large.', retryable: false }, 413)
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > ROUTE_LIMITS.maxBodyBytes) return json({ type: 'error', code: 'too-large', message: 'The request is too large.', retryable: false }, 413)

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json({ type: 'error', code: 'bad-request', message: 'The request is not JSON.', retryable: false }, 400)
  }
  const parsed = GenerationRequestSchema.safeParse(body)
  if (!parsed.success) {
    return json({ type: 'error', code: 'bad-request', message: `The request does not match the schema: ${parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ')}.`, retryable: false }, 400)
  }
  const generationRequest = parsed.data as unknown as GenerationRequest

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ModelEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      let last = 0
      try {
        const proposal = await model.propose(generationRequest, {
          signal: request.signal,
          onPartial: (partial) => {
            const now = Date.now()
            if (now - last < ROUTE_LIMITS.partialIntervalMs) return
            last = now
            send({ type: 'partial', proposal: partial })
          },
        })
        send({ type: 'proposal', proposal })
      } catch (e) {
        const error = e instanceof ModelError ? e : new ModelError('model-failed', 'The model request failed.', true)
        send({ type: 'error', code: error.code, message: error.message, retryable: error.retryable })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
}
