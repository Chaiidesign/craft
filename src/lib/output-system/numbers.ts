// The automatic number check for chat replies (build-loop.md §8: "every number
// in a chat reply matches the fixtures exactly"). It finds the claims a reply
// makes about the store, namely money, percentages and counts of store things
// (orders, units, customers, products, items, refunds), and checks each one by
// value against the numbers in the store answers and the request (D-82).
//
// Values, not strings: "₹39,93,259.35", "₹3,993,259" and "₹39.9 lakh" are the
// same number at different precisions. A rounded claim passes when some source
// number rounds to it at the precision it was written with ("about $76k").
// Durations and other plain numbers ("30 days", "under 60 characters") are not
// store claims and are not checked.

export type Claim = { text: string; value: number; precision: number; kind: 'money' | 'percent' | 'count' }

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7 }

function precisionOf(digits: string): number {
  const dot = digits.indexOf('.')
  return dot < 0 ? 1 : 10 ** -(digits.length - dot - 1)
}

const NUM = '(\\d{1,3}(?:,\\d{2,3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)'
const MONEY = new RegExp(`(?:₹|Rs\\.?\\s?|INR\\s?|US\\$|\\$|USD\\s?)${NUM}(?:\\s?(k|m|thousand|million|lakhs?|crores?)\\b)?`, 'gi')
const PERCENT = new RegExp(`${NUM}\\s?(?:%|per\\s?cent|percent)`, 'gi')
const COUNT = new RegExp(`\\b${NUM}\\s+(?:[a-z-]+\\s+)?(orders?|units?|customers?|products?|items?|refunds?|sales)\\b`, 'gi')

export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = []
  const taken: [number, number][] = []
  const overlaps = (i: number, j: number) => taken.some(([a, b]) => i < b && j > a)
  for (const m of text.matchAll(MONEY)) {
    const digits = m[1].replace(/,/g, '')
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : 1
    claims.push({ text: m[0], value: Number(digits) * scale, precision: precisionOf(digits) * scale, kind: 'money' })
    taken.push([m.index!, m.index! + m[0].length])
  }
  for (const m of text.matchAll(PERCENT)) {
    if (overlaps(m.index!, m.index! + m[0].length)) continue
    const digits = m[1].replace(/,/g, '')
    claims.push({ text: m[0], value: Number(digits), precision: precisionOf(digits), kind: 'percent' })
    taken.push([m.index!, m.index! + m[0].length])
  }
  for (const m of text.matchAll(COUNT)) {
    if (overlaps(m.index!, m.index! + m[0].length)) continue
    const digits = m[1].replace(/,/g, '')
    claims.push({ text: m[0], value: Number(digits), precision: precisionOf(digits), kind: 'count' })
  }
  return claims
}

/** Every number in a store answer: plain numbers, and numbers inside display strings like "₹1,234.50". */
export function sourceNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  else if (typeof value === 'string') for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(Number(m[0].replace(/,/g, '')))
  else if (Array.isArray(value)) for (const v of value) sourceNumbers(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) sourceNumbers(v, out)
  return out
}

/** A claim passes when some source number, rounded to the claim's precision, equals it. Percentages compare by size, since "down 12%" is −12. */
export function claimMatches(claim: Claim, sources: number[]): boolean {
  const eps = claim.precision * 1e-6
  return sources.some((raw) => {
    const x = claim.kind === 'percent' ? Math.abs(raw) : raw
    const rounded = Math.round(x / claim.precision) * claim.precision
    return Math.abs(rounded - claim.value) <= eps + 1e-9
  })
}

export type NumberCheck = { ok: boolean; claims: Claim[]; unmatched: Claim[] }

export function checkNumbers(reply: string, sources: unknown[]): NumberCheck {
  const claims = extractClaims(reply)
  const numbers = sources.flatMap((s) => sourceNumbers(s))
  const unmatched = claims.filter((c) => !claimMatches(c, numbers))
  return { ok: unmatched.length === 0, claims, unmatched }
}
