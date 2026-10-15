// Content digests for edit safety. A revise operation names the digest of the
// value it expects to change; if the value has moved on since the caller read
// it, the digest no longer matches and the operation is refused instead of
// overwriting newer content. Not a security hash: it detects staleness only.

/** JSON with object keys sorted, so equal content always serialises the same way. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

/** FNV-1a, 32-bit, as 8 hex digits. */
export function digest(value: unknown): string {
  const text = canonical(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
