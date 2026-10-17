// The nine output lanes (docs/output-system/plan.md, "The output lanes") and
// the action names the draft system prompt uses for each. The action names
// are placeholders for engineering to rename (D-68); the model sees them, the
// person never does.

export const LANES = [
  'chat_reply',
  'message_card',
  'inline_chart',
  'strict_document',
  'composed_document',
  'design',
  'dashboard',
  'published_page',
  'file',
] as const

export type Lane = (typeof LANES)[number]

/** Names a designer reads in the results table and the guides. */
export const LANE_LABELS: Record<Lane, string> = {
  chat_reply: 'Chat reply',
  message_card: 'Message card',
  inline_chart: 'Inline chart',
  strict_document: 'Strict document',
  composed_document: 'Composed document',
  design: 'Design',
  dashboard: 'Dashboard',
  published_page: 'Published page',
  file: 'File',
}

/**
 * What the model can say it would do first. Every lane has one action; two
 * more are not lanes: asking one question (allowed only when the format is
 * truly open) and updating something already made as a new version (router
 * step 1), which keeps the lane of the thing it updates.
 */
export const ACTIONS = {
  reply_in_chat: 'chat_reply',
  show_message_card: 'message_card',
  show_chart: 'inline_chart',
  create_strict_document: 'strict_document',
  create_document: 'composed_document',
  create_design: 'design',
  create_dashboard: 'dashboard',
  publish_page: 'published_page',
  build_file: 'file',
  ask_question: 'ask',
  update_existing: 'update',
  export_existing: 'export',
} as const satisfies Record<string, Lane | 'ask' | 'update' | 'export'>

export type Action = keyof typeof ACTIONS

/** A routing result: a lane, "ask", "update:<lane>" or "export:<lane>" (the lane of the thing acted on). */
export type Outcome = Lane | 'ask' | `update:${Lane}` | `export:${Lane}` | 'update:unknown' | 'export:unknown' | 'unparsed'

export function isLane(value: unknown): value is Lane {
  return typeof value === 'string' && (LANES as readonly string[]).includes(value)
}

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && Object.hasOwn(ACTIONS, value)
}

/** Turns the model's action into an outcome. `existing` is the lane of the thing an update or export acts on. */
export function outcomeOf(action: Action, existing: Lane | undefined): Outcome {
  const target = ACTIONS[action]
  if (target === 'update') return existing ? `update:${existing}` : 'update:unknown'
  if (target === 'export') return existing ? `export:${existing}` : 'export:unknown'
  return target
}

/** The lane an outcome acts on: the lane itself, or the lane of the thing updated or exported. */
export function laneOf(outcome: Outcome): Lane | undefined {
  if (isLane(outcome)) return outcome
  const tail = outcome.replace(/^(update|export):/, '')
  return isLane(tail) ? tail : undefined
}

export function isOutcome(value: unknown): value is Outcome {
  if (typeof value !== 'string') return false
  if (value === 'ask' || value === 'unparsed' || value === 'update:unknown' || value === 'export:unknown') return true
  const m = value.match(/^(update|export):(.+)$/)
  return isLane(value) || (m !== null && isLane(m[2]))
}
