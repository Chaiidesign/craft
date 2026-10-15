// The browser's GenerationModel: it asks /api/document-model and reads the
// NDJSON answer. The key stays on the server; the gate still runs here, on
// whatever comes back.

import { ModelError, type GenerationModel, type GenerationRequest, type ModelErrorCode, type ProposeOptions } from './model'
import type { ModelEvent } from './modelRoute'

export const MODEL_ROUTE = '/api/document-model'

export class RemoteModel implements GenerationModel {
  readonly id = 'remote'

  constructor(private readonly url = MODEL_ROUTE, private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  async propose(request: GenerationRequest, options: ProposeOptions = {}): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: options.signal })
    } catch (e) {
      throw new ModelError('model-failed', e instanceof Error && e.name === 'AbortError' ? 'The request was cancelled.' : 'Could not reach the document model. Check your connection and try again.', true)
    }
    if (response.status === 404) throw new ModelError('model-unavailable', 'The document model is not available on this deployment.')
    if (!response.body) throw new ModelError('model-failed', `The document model answered with status ${response.status} and no body.`, true)

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (value) buffer += value
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        const event = JSON.parse(line) as ModelEvent
        if (event.type === 'partial') options.onPartial?.(event.proposal)
        else if (event.type === 'proposal') return event.proposal
        else {
          const code: ModelErrorCode = event.code === 'model-unavailable' || event.code === 'model-refused' ? event.code : 'model-failed'
          throw new ModelError(code, event.message, event.retryable)
        }
      }
      if (done) break
    }
    throw new ModelError('model-failed', 'The document model stopped before sending a proposal.', true)
  }
}
