// Propose → gate → retry with the gate's errors, at most `maxRetries` times.
// The loop never loosens the gate and never substitutes content: it either
// returns a proposal that passed, or a structured failure with every error.

import type { GateError } from './errors'
import type { GateResult } from './gate'
import { ModelError, type GenerationModel, type GenerationRequest, type ModelErrorCode, type ProposeOptions } from './model'
import type { Proposal } from './ops'

export const MAX_RETRIES = 2

export type LoopResult =
  | { ok: true; gated: Extract<GateResult, { ok: true }>; proposal: Proposal; attempts: number }
  | { ok: false; code: 'gate-failed'; errors: GateError[]; attempts: number }
  | { ok: false; code: ModelErrorCode; message: string; retryable: boolean; attempts: number }

export async function proposeUntilValid(
  model: GenerationModel,
  request: GenerationRequest,
  gate: (raw: unknown) => GateResult & { proposal?: Proposal },
  options: ProposeOptions & { maxRetries?: number } = {},
): Promise<LoopResult> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES
  let previousErrors: GateError[] | undefined
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let raw: unknown
    try {
      raw = await model.propose(previousErrors ? { ...request, previousErrors } : request, options)
    } catch (e) {
      if (e instanceof ModelError) return { ok: false, code: e.code, message: e.message, retryable: e.retryable, attempts: attempt }
      return { ok: false, code: 'model-failed', message: e instanceof Error ? e.message : String(e), retryable: true, attempts: attempt }
    }
    const result = gate(raw)
    if (result.ok && result.proposal) return { ok: true, gated: result, proposal: result.proposal, attempts: attempt }
    if (!result.ok) {
      previousErrors = result.errors
      // Nothing a retry could fix (e.g. a document type the generator can't make): stop asking.
      if (result.errors.every((e) => !e.retryable)) return { ok: false, code: 'gate-failed', errors: result.errors, attempts: attempt }
    }
  }
  return { ok: false, code: 'gate-failed', errors: previousErrors ?? [], attempts: maxRetries + 1 }
}
