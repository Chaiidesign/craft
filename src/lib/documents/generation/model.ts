// The writer behind generation (D-52). The pipeline only ever talks to this
// interface: a scripted model in tests, Claude in dev and on previews, and in
// the browser a client for the model route. A model proposes; it never saves.

import type { GateError } from './errors'
import type { GeneratableKind } from './ops'
import type { DocumentView } from './view'

export interface GenerationRequest {
  task: 'generate' | 'revise'
  docType: GeneratableKind
  /** What the person asked for this time, verbatim. */
  request: string
  /** Earlier messages from the person in this conversation, oldest first, verbatim. */
  conversation: readonly string[]
  /** The document as it stands (blank for `generate`), with IDs and digests. */
  document: DocumentView
  /** Today's date, YYYY-MM-DD, so "due in 30 days" can be worked out. */
  today: string
  /** The gate's errors from the previous attempt, when this is a retry. */
  previousErrors?: readonly GateError[]
}

export type ModelErrorCode = 'model-unavailable' | 'model-failed' | 'model-refused'

/** A model that could not produce a proposal at all. Never retried by the loop, never replaced by a fallback. */
export class ModelError extends Error {
  constructor(readonly code: ModelErrorCode, message: string, readonly retryable = false) {
    super(message)
    this.name = 'ModelError'
  }
}

export interface ProposeOptions {
  signal?: AbortSignal
  /** Partial proposals as they stream in, for a progressive preview. Never gated, never saved. */
  onPartial?: (partial: unknown) => void
}

export interface GenerationModel {
  /** A short name for logs and revision authorship, e.g. "claude-opus-5-5". */
  readonly id: string
  /** Returns the model's raw proposal. The gate decides whether any of it is usable. */
  propose(request: GenerationRequest, options?: ProposeOptions): Promise<unknown>
}

/**
 * Plays back fixed proposals, one per call, and records every request it was given.
 * Tests use it to drive the gate and the retry loop, including deliberately bad output.
 */
export class ScriptedModel implements GenerationModel {
  readonly id = 'scripted'
  readonly requests: GenerationRequest[] = []
  private readonly script: (unknown | ((request: GenerationRequest) => unknown))[]

  constructor(script: (unknown | ((request: GenerationRequest) => unknown))[]) {
    this.script = [...script]
  }

  async propose(request: GenerationRequest, options?: ProposeOptions): Promise<unknown> {
    this.requests.push(request)
    const next = this.script.shift()
    if (next === undefined) throw new ModelError('model-failed', 'Scripted model has no more proposals.')
    const value = typeof next === 'function' ? (next as (r: GenerationRequest) => unknown)(request) : next
    if (value instanceof Error) throw value
    options?.onPartial?.(value)
    return value
  }
}
