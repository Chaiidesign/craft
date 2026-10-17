// Response cache for model calls (build-loop.md §9): the same request, prompt
// version and guide version is not paid for twice. Keys are content hashes, so
// any change to the request, the prompt or the guide makes a new key. Pure key
// logic here; the server keeps entries on disk in .cache/output-system/
// (git-ignored). Routing verification runs bypass the cache on purpose: their
// point is to sample the model again.

import { createHash } from 'node:crypto'

export type CacheKeyParts = {
  /** Everything sent to the model that isn't the prompt or a guide: messages, tools, model id, effort. */
  request: unknown
  promptVersion: string
  /** Hash or version of the guide text sent with the request; "" when none. */
  guideVersion: string
}

/** Stable JSON: object keys sorted, so key order never changes the hash. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function cacheKey(parts: CacheKeyParts): string {
  return createHash('sha256').update(stableJson(parts)).digest('hex')
}

/** A short version id for a text (prompt or guide): the first 12 hex digits of its SHA-256. */
export function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}
