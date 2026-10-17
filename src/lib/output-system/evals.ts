// The routing eval set (docs/output-system/evals/requests.jsonl): parsing,
// coverage checks and scoring. Pure functions; the harness in
// scripts/output-system/ does the I/O and the model calls.

import { isLane, isOutcome, laneOf, LANES, type Lane, type Outcome } from './lanes'

export type Turn = { role: 'person' | 'souvenir'; text: string; made?: Lane }

export type EvalRequest = {
  id: string
  request: string
  /** Earlier turns, for router step 1 (changes to something already made) and the upgrade rule. */
  context?: Turn[]
  /** Every acceptable outcome. Ambiguous cases list more than one. */
  expected: Outcome[]
  /** Asking one question is also right: the format is truly open. */
  ask_ok: boolean
  ambiguous: boolean
  note?: string
}

export class EvalSetError extends Error {}

function fail(line: number, message: string): never {
  throw new EvalSetError(`requests.jsonl line ${line}: ${message}`)
}

export function parseEvalSet(text: string): EvalRequest[] {
  const out: EvalRequest[] = []
  const ids = new Set<string>()
  text.split('\n').forEach((raw, i) => {
    const line = i + 1
    if (!raw.trim()) return
    let r: Record<string, unknown>
    try {
      r = JSON.parse(raw)
    } catch {
      fail(line, 'not valid JSON')
    }
    if (typeof r.id !== 'string' || !r.id) fail(line, 'id must be a non-empty string')
    if (ids.has(r.id)) fail(line, `duplicate id ${r.id}`)
    ids.add(r.id)
    if (typeof r.request !== 'string' || !r.request.trim()) fail(line, 'request must be a non-empty string')
    if (!Array.isArray(r.expected) || r.expected.length === 0) fail(line, 'expected must list at least one outcome')
    for (const e of r.expected) if (!isOutcome(e) || e === 'unparsed' || e === 'update:unknown' || e === 'export:unknown') fail(line, `unknown expected outcome ${JSON.stringify(e)}`)
    if (typeof r.ask_ok !== 'boolean') fail(line, 'ask_ok must be true or false')
    if (typeof r.ambiguous !== 'boolean') fail(line, 'ambiguous must be true or false')
    if (r.context !== undefined) {
      if (!Array.isArray(r.context)) fail(line, 'context must be a list of turns')
      for (const t of r.context as Record<string, unknown>[]) {
        if (t.role !== 'person' && t.role !== 'souvenir') fail(line, 'each turn needs role "person" or "souvenir"')
        if (typeof t.text !== 'string' || !t.text) fail(line, 'each turn needs text')
        if (t.made !== undefined && !isLane(t.made)) fail(line, `unknown lane in made: ${JSON.stringify(t.made)}`)
      }
    }
    if (r.note !== undefined && typeof r.note !== 'string') fail(line, 'note must be a string')
    out.push(r as unknown as EvalRequest)
  })
  return out
}

/** The lane of the most recent thing Souvenir made in the context, which an update or export acts on. */
export function lastMade(request: EvalRequest): Lane | undefined {
  return request.context?.filter((t) => t.made).at(-1)?.made
}

export type Coverage = { total: number; ambiguous: number; missingLanes: Lane[]; byLane: Record<Lane, number> }

/** Counts, per lane, the requests whose first expected outcome is that lane. */
export function coverage(set: EvalRequest[]): Coverage {
  const byLane = Object.fromEntries(LANES.map((l) => [l, 0])) as Record<Lane, number>
  for (const r of set) {
    const lane = laneOf(r.expected[0])
    if (lane) byLane[lane]++
  }
  return {
    total: set.length,
    ambiguous: set.filter((r) => r.ambiguous).length,
    missingLanes: LANES.filter((l) => byLane[l] === 0),
    byLane,
  }
}

export function isRight(request: EvalRequest, chosen: Outcome): boolean {
  if (request.expected.includes(chosen)) return true
  return chosen === 'ask' && request.ask_ok
}

export type ResultRow = {
  id: string
  request: string
  expected: Outcome[]
  ask_ok: boolean
  chosen: Outcome
  right: boolean
  /** The model's one-line reason, or the question it would ask. */
  reason: string
  question?: string
}

export function summarise(rows: ResultRow[]): { right: number; total: number; misses: ResultRow[] } {
  const misses = rows.filter((r) => !r.right)
  return { right: rows.length - misses.length, total: rows.length, misses }
}

/** The prompt file without its leading HTML comment, which is for editors only. */
export function loadPrompt(text: string): string {
  return text.replace(/^\s*<!--[\s\S]*?-->\s*/, '').trimEnd()
}
