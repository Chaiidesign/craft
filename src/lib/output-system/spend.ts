// Model spend tracking for the output-system build loop (build-loop.md §9).
// Every model call appends one entry to docs/output-system/spend/ledger.jsonl
// with the cost OpenRouter reports in `usage.cost` (US$). Limits are read from
// build-loop.md, so the designer changes them there and nowhere else.
//
// Pure functions here; the ledger file is read and written by the callers
// (the routing harness and, from Session 1, the lane server code).

export type SpendEntry = {
  at: string
  /** Build-loop session number, e.g. "0". */
  session: string
  /** Lane id, or "routing" for router evals. */
  lane: string
  /** Eval set or purpose, e.g. "routing-34" or "gallery". */
  purpose: string
  /** Prompt version the call used. */
  promptVersion: string
  model: string
  inputTokens: number
  outputTokens: number
  /** US$ as reported by the provider; null when it reported none. */
  costUsd: number | null
  /** True when costUsd is estimated from tokens because the provider reported none. */
  estimated?: boolean
  cached: boolean
}

/**
 * Rates used only when a provider reports no cost (for example the direct
 * Anthropic fallback), so the limits still apply. Taken from the cost_details
 * OpenRouter returned for anthropic/claude-opus-5.5 on 2026-10-17: US$0.000064
 * for 16 prompt tokens and US$0.00048 for 24 output tokens. Estimates are
 * labelled as such wherever they are reported.
 */
export const ESTIMATE_RATES_USD_PER_TOKEN = { input: 4 / 1e6, output: 20 / 1e6 }

/** The provider's cost, or an estimate from tokens when it reported none. */
export function priceCall(usage: unknown, inputTokens: number, outputTokens: number): { costUsd: number; estimated: boolean } {
  const reported = costOf(usage)
  if (reported !== null) return { costUsd: reported, estimated: false }
  const r = ESTIMATE_RATES_USD_PER_TOKEN
  return { costUsd: Math.round((inputTokens * r.input + outputTokens * r.output) * 1e6) / 1e6, estimated: true }
}

export type Limits = { perSessionUsd: number; totalUsd: number }

export const DEFAULT_LIMITS: Limits = { perSessionUsd: 20, totalUsd: 75 }

/** Reads "Per-session limit: US$20" and "Whole build limit: US$75" from build-loop.md. */
export function parseLimits(buildLoop: string): Limits {
  const num = (re: RegExp) => {
    const m = buildLoop.match(re)
    return m ? Number(m[1].replace(/,/g, '')) : undefined
  }
  return {
    perSessionUsd: num(/Per-session limit:\s*US\$([\d,.]+)/i) ?? DEFAULT_LIMITS.perSessionUsd,
    totalUsd: num(/Whole build limit:\s*US\$([\d,.]+)/i) ?? DEFAULT_LIMITS.totalUsd,
  }
}

/** The provider's reported cost for one response, in US$. OpenRouter puts it in usage.cost. */
export function costOf(usage: unknown): number | null {
  const cost = (usage as { cost?: unknown } | null | undefined)?.cost
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null
}

export function parseLedger(text: string): SpendEntry[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SpendEntry)
}

const add = (map: Record<string, number>, key: string, v: number) => {
  map[key] = round((map[key] ?? 0) + v)
}
const round = (v: number) => Math.round(v * 1e6) / 1e6

export type SpendSummary = {
  totalUsd: number
  bySession: Record<string, number>
  byLane: Record<string, number>
  byPurpose: Record<string, number>
  calls: number
  cachedCalls: number
  /** Calls priced by estimate from tokens; included in the totals. */
  estimatedCalls: number
  /** Calls with no cost and no estimate; not in the totals, and they trigger a warning. */
  unpricedCalls: number
}

export function summariseSpend(entries: SpendEntry[]): SpendSummary {
  const s: SpendSummary = { totalUsd: 0, bySession: {}, byLane: {}, byPurpose: {}, calls: entries.length, cachedCalls: 0, estimatedCalls: 0, unpricedCalls: 0 }
  for (const e of entries) {
    if (e.cached) s.cachedCalls++
    if (e.estimated) s.estimatedCalls++
    if (e.costUsd === null) {
      s.unpricedCalls++
      continue
    }
    s.totalUsd = round(s.totalUsd + e.costUsd)
    add(s.bySession, e.session, e.costUsd)
    add(s.byLane, e.lane, e.costUsd)
    add(s.byPurpose, e.purpose, e.costUsd)
  }
  return s
}

export type SpendStatus = { level: 'ok' | 'warn' | 'stop'; message: string }

/** At 80% of either limit: warn. At 100%: stop (build-loop.md §9). */
export function spendStatus(summary: SpendSummary, session: string, limits: Limits): SpendStatus {
  const sessionUsd = summary.bySession[session] ?? 0
  const share = Math.max(sessionUsd / limits.perSessionUsd, summary.totalUsd / limits.totalUsd)
  const est = summary.estimatedCalls ? ` (${summary.estimatedCalls} calls estimated from tokens)` : ''
  const text = `Session ${session}: US$${sessionUsd.toFixed(2)} of US$${limits.perSessionUsd}. Build: US$${summary.totalUsd.toFixed(2)} of US$${limits.totalUsd}${est}.`
  if (share >= 1) return { level: 'stop', message: `Spend limit reached. ${text}` }
  if (share >= 0.8) return { level: 'warn', message: `Over 80% of a spend limit. ${text}` }
  if (summary.unpricedCalls > 0) return { level: 'warn', message: `${summary.unpricedCalls} calls have no cost recorded, so the totals are too low. ${text}` }
  return { level: 'ok', message: text }
}
