// Machine-readable gate errors. Every refusal names a code, where in the
// proposal it came from, the document target if there is one, and whether a
// caller can fix it by trying again with different operations.

export type GateErrorCode =
  | 'schema'
  | 'wrong-kind'
  | 'unknown-target'
  | 'missing-digest'
  | 'stale-target'
  | 'wrong-type'
  | 'invalid-value'
  | 'brand-owned'
  | 'currency-required'
  | 'provenance-not-allowed'
  | 'evidence-not-found'
  | 'no-change'
  | 'sum-mismatch'
  | 'semantic'

export interface GateError {
  code: GateErrorCode
  /** Where in the proposal, e.g. `operations[2].value.amount`. */
  path: string
  /** The document target, as a provenance key (`field:<id>`, `line:<id>`), when the error is about one. */
  target?: string
  message: string
  retryable: boolean
}

export const gateError = (code: GateErrorCode, path: string, message: string, target?: string, retryable = true): GateError =>
  ({ code, path, message, retryable, ...(target ? { target } : {}) })
