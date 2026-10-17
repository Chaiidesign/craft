// The lane registry (build-loop.md §5): one entry per lane, built on LANES, so
// one list drives the router outcomes, /output-verify and the formats list.
// Each lane declares its router action, guide, templates, exports and eval
// set. A lane added in a later build loop slots in here; its code lives in its
// own folder and is registered, never wired in by hand elsewhere.
//
// Session 0 registers every lane with no renderer yet. Launch lanes are
// "being built"; the rest show "coming later" (D-78).

import { ACTIONS, LANE_LABELS, LANES, type Action, type Lane } from './lanes'

/** Which build loop a lane belongs to (build-loop.md §1). */
export type LaneScope = 'launch' | 'if-time' | 'later'

/** Status as shown on /output-verify. Changes to "ready" only when its checks pass. */
export type LaneStatus = 'ready' | 'being-built' | 'coming-later'

export type TemplateEntry = {
  id: string
  label: string
  /** "exists" means the document engine already has it. */
  status: 'exists' | 'planned' | 'if-time'
}

export type LaneEntry = {
  lane: Lane
  label: string
  /** One plain sentence for the person: what this makes. */
  makes: string
  scope: LaneScope
  status: LaneStatus
  /** The prompt's action name for this lane. */
  action: Action
  guide: string
  templates: TemplateEntry[]
  /** Eval set for this lane's outputs; null until written in its session. */
  evalSet: string | null
}

const actionFor = (lane: Lane) => (Object.keys(ACTIONS) as Action[]).find((a) => ACTIONS[a] === lane) as Action

const guideFor = (lane: Lane) => `docs/output-system/guides/${lane.replace(/_/g, '-')}.md`

type Spec = Omit<LaneEntry, 'lane' | 'label' | 'action' | 'guide'>

const SPECS: Record<Lane, Spec> = {
  chat_reply: {
    makes: 'Answers and short copy, right in the conversation.',
    scope: 'launch',
    status: 'being-built',
    templates: [],
    evalSet: null,
  },
  file: {
    makes: 'Store data as Excel, CSV, JSON or PDF, and changes to files you upload.',
    scope: 'launch',
    status: 'being-built',
    templates: [
      { id: 'orders-export', label: 'Orders export', status: 'planned' },
      { id: 'products-export', label: 'Products export', status: 'planned' },
      { id: 'customers-export', label: 'Customers export', status: 'planned' },
      { id: 'uploaded-change', label: 'Change to an uploaded file', status: 'planned' },
    ],
    evalSet: null,
  },
  strict_document: {
    makes: 'Invoices, quotes, purchase orders and receipts, with exact totals.',
    scope: 'launch',
    status: 'being-built',
    templates: [
      { id: 'invoice', label: 'Invoice', status: 'exists' },
      { id: 'quote', label: 'Quote', status: 'planned' },
      { id: 'purchase-order', label: 'Purchase order', status: 'planned' },
      { id: 'receipt', label: 'Receipt', status: 'planned' },
      { id: 'credit-note', label: 'Credit note', status: 'if-time' },
      { id: 'packing-slip', label: 'Packing slip', status: 'if-time' },
      { id: 'returns-policy', label: 'Returns policy', status: 'if-time' },
    ],
    evalSet: null,
  },
  composed_document: {
    makes: 'Reports, plans and spec sheets to keep or share.',
    scope: 'launch',
    status: 'being-built',
    templates: [
      { id: 'brief', label: 'Brief', status: 'exists' },
      { id: 'sales-report', label: 'Sales report', status: 'planned' },
      { id: 'campaign-plan', label: 'Campaign plan', status: 'planned' },
      { id: 'spec-sheet', label: 'Product spec sheet', status: 'planned' },
      { id: 'product-descriptions', label: 'Product descriptions', status: 'if-time' },
      { id: 'sop', label: 'Standard operating procedure', status: 'if-time' },
    ],
    evalSet: null,
  },
  message_card: {
    makes: 'Emails and replies to customers and suppliers, ready to copy.',
    scope: 'if-time',
    status: 'coming-later',
    templates: [],
    evalSet: null,
  },
  inline_chart: {
    makes: 'A quick chart of your numbers.',
    scope: 'if-time',
    status: 'being-built',
    templates: [],
    evalSet: null,
  },
  design: { makes: 'Ads, social posts, mockups and slides.', scope: 'later', status: 'coming-later', templates: [], evalSet: null },
  dashboard: { makes: 'Numbers you check every week.', scope: 'later', status: 'coming-later', templates: [], evalSet: null },
  published_page: { makes: 'Calculators, size guides and quizzes at a private link.', scope: 'later', status: 'coming-later', templates: [], evalSet: null },
}

export const REGISTRY: LaneEntry[] = LANES.map((lane) => ({
  lane,
  label: LANE_LABELS[lane],
  action: actionFor(lane),
  guide: guideFor(lane),
  ...SPECS[lane],
}))

export function laneEntry(lane: Lane): LaneEntry {
  return REGISTRY.find((e) => e.lane === lane) as LaneEntry
}

/** The format-not-supported card is not a lane, but launch lanes need it (build-loop.md §4). */
export const FORMAT_NOT_SUPPORTED = { status: 'being-built' as LaneStatus, scope: 'launch' as LaneScope }
