// Document-quality prototype: the typed content model.
//
// One immutable `DocumentSnapshot` is the only input every preview and
// renderer reads. Source values are typed (`FieldValue`, `Money` in integer
// minor units); display text is always derived from them, never stored in
// their place. Output and revision identity are explicit IDs — nothing here
// is parsed from a filename.
//
// Mock-data prototype. These are frontend contracts for the document-quality
// workbench, not production endpoint shapes.

// ── Identity ─────────────────────────────────────────────────────────────────

export type OutputId = string
export type RevisionId = string
export type FieldId = string
export type BlockId = string
export type CitationId = string
export type ExportId = string

export type DocumentKind = 'invoice' | 'brief' | 'deck'

/** Clock + ID source. Injected so tests and fixtures are deterministic. */
export interface DocumentEnv {
  /** ISO-8601 timestamp. */
  now(): string
  /** A new unique ID with the given prefix (e.g. `rev`, `exp`). */
  nextId(prefix: string): string
}

// ── Money and typed values ──────────────────────────────────────────────────

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR' | 'JPY'

/** An amount in integer minor units (cents, paise…). Never a float, never a string. */
export interface Money {
  amountMinor: number
  currency: CurrencyCode
}

export type FieldValue =
  | { type: 'text'; text: string }
  | { type: 'multiline'; lines: readonly string[] }
  /** Calendar date, `YYYY-MM-DD`. */
  | { type: 'date'; iso: string }
  | { type: 'money'; money: Money }
  | { type: 'currency'; code: CurrencyCode }
  /** Percentage in basis points (1% = 100). */
  | { type: 'percent'; basisPoints: number }
  /** A choice from the field's declared options. */
  | { type: 'choice'; option: string }

export type FieldValueType = FieldValue['type']

// ── Fields ───────────────────────────────────────────────────────────────────

/**
 * Why a field may be "not applicable". Each rule is documented in
 * `validation.ts` and checked there — not-applicable is never a way to
 * dismiss a missing fact.
 */
export type NotApplicableRule = 'tax-rate-when-exempt' | 'discount-when-none'

export type FieldState =
  | { status: 'provided'; value: FieldValue }
  | { status: 'missing' }
  | { status: 'not-applicable'; rule: NotApplicableRule }

export type FieldStatus = FieldState['status']

export interface Field {
  id: FieldId
  label: string
  /** The value type this field accepts. A provided value of another type is invalid. */
  valueType: FieldValueType
  /** Required for this fixture/template — not a universal legal or tax rule. */
  required: boolean
  state: FieldState
  /** For `choice` fields: the permitted options, with display labels. */
  options?: readonly { value: string; label: string }[]
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/** A run of inline text. Citations sit beside the claim they support. */
export interface TextRun {
  text: string
  emphasis?: boolean
  citationIds?: readonly CitationId[]
}

export interface InvoiceLineItem {
  id: string
  description: string
  /** Quantity in thousandths (1.5 hours = 1500), so arithmetic stays integral. */
  quantityMilli: number
  unit?: string
  /** `null` when the unit price was not supplied — never zero as "unknown". */
  unitPrice: Money | null
}

export interface TableColumn {
  id: string
  label: string
  align: 'start' | 'end'
  /** Numeric columns render in the Money role with tabular figures. */
  numeric: boolean
}

export interface ChartSeries {
  id: string
  label: string
  points: readonly { x: string; y: number }[]
}

export type CalloutTone = 'note' | 'warning'

export type AssetStatus = 'supplied' | 'missing' | 'broken'

export interface ImageAsset {
  assetId: string
  /** Local path under /public or a data: URI. Never a remote URL. */
  src: string
  alt: string
  widthPx: number
  heightPx: number
}

export type Block =
  | { id: BlockId; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: BlockId; type: 'paragraph'; runs: readonly TextRun[]; role?: 'body' | 'summary' | 'pull-quote' }
  | { id: BlockId; type: 'list'; ordered: boolean; items: readonly (readonly TextRun[])[] }
  | { id: BlockId; type: 'field-group'; title?: string; fieldIds: readonly FieldId[] }
  | { id: BlockId; type: 'table'; caption?: string; columns: readonly TableColumn[]; rows: readonly { id: string; cells: Readonly<Record<string, string>> }[]; citationIds?: readonly CitationId[] }
  | { id: BlockId; type: 'line-items'; items: readonly InvoiceLineItem[] }
  /** Totals are derived from the line items and tax/discount fields at render time — never stored. */
  | { id: BlockId; type: 'totals'; lineItemsBlockId: BlockId }
  | { id: BlockId; type: 'image'; asset: ImageAsset; caption: string; citationIds?: readonly CitationId[] }
  | { id: BlockId; type: 'chart'; chartType: 'bar' | 'line'; title: string; unit: string; xLabel: string; yLabel: string; series: readonly ChartSeries[]; dataSummary: string; citationIds?: readonly CitationId[] }
  /** `internal` callouts are working notes: shown in the workbench, excluded from recipient exports by default. */
  | { id: BlockId; type: 'callout'; tone: CalloutTone; audience: 'recipient' | 'internal'; runs: readonly TextRun[] }
  | { id: BlockId; type: 'source-list' }

export type BlockType = Block['type']

// ── Citations ────────────────────────────────────────────────────────────────

/** A fixture source. Visibly fictional; carries no URL, so nothing can pass for a real link. */
export interface Citation {
  id: CitationId
  title: string
  publisher: string
  /** `YYYY-MM` or `YYYY-MM-DD`. */
  date?: string
  locator?: string
  fictional: true
}

// ── Brand ────────────────────────────────────────────────────────────────────

export interface BrandProfile {
  profileId: string
  version: number
  issuerDisplayName: string
  /** `null` when no logo was supplied. A missing logo gets a labelled neutral fallback, never an invented mark. */
  logo: ImageAsset | null
  /** What we were told about the logo. A `supplied` logo can still fail to load at render time. */
  assetStatus: AssetStatus
  /** Permitted palette, hex. Accent is used sparingly (rules, letterhead mark). */
  palette: { ink: string; muted: string; rule: string; accent: string }
  /** Typography theme ID, resolved by `theme.ts`. Brand profiles never name a font family. */
  themeId: string
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export type LayoutPreset = 'a4-portrait' | 'letter-portrait' | 'slide-16x9'

export interface SlidePlan {
  id: string
  layout: 'title' | 'content' | 'chart' | 'closing'
  blockIds: readonly BlockId[]
  /** Set when the slide deliberately summarises source content (which stays in the model). */
  summaryOf?: readonly BlockId[]
}

interface SnapshotBase {
  schemaVersion: 1
  locale: string
  brand: BrandProfile
  fields: Readonly<Record<FieldId, Field>>
  /** Order of `fieldIds` for inspection and the missing-field summary. */
  fieldOrder: readonly FieldId[]
  blocks: readonly Block[]
  citations: readonly Citation[]
  layoutPreset: LayoutPreset
}

export interface InvoiceSnapshot extends SnapshotBase {
  kind: 'invoice'
  templateId: 'invoice@1'
}

export interface BriefSnapshot extends SnapshotBase {
  kind: 'brief'
  templateId: 'brief@1'
}

export interface DeckSnapshot extends SnapshotBase {
  kind: 'deck'
  templateId: 'deck@1'
  slides: readonly SlidePlan[]
}

export type DocumentSnapshot = InvoiceSnapshot | BriefSnapshot | DeckSnapshot

// ── Documents and revisions ─────────────────────────────────────────────────

export interface DocumentRecord {
  outputId: OutputId
  kind: DocumentKind
  title: string
  currentRevisionId: RevisionId
  /** Oldest first. History is never rewritten. */
  revisionIds: readonly RevisionId[]
  /** For a deck: the brief revision it was adapted from. */
  derivedFrom?: { outputId: OutputId; revisionId: RevisionId }
}

export interface RevisionAuthor {
  id: string
  name: string
  kind: 'person' | 'system'
}

export type RevisionOperation =
  | { type: 'create' }
  | { type: 'edit'; target: { kind: 'field'; fieldId: FieldId } | { kind: 'block'; blockId: BlockId } }
  | { type: 'accept-proposal'; proposalId: string }
  | { type: 'restore'; fromRevisionId: RevisionId }
  | { type: 'derive'; from: { outputId: OutputId; revisionId: RevisionId } }

export interface Revision {
  revisionId: RevisionId
  outputId: OutputId
  /** `null` only for the first revision. */
  parentRevisionId: RevisionId | null
  createdAt: string
  author: RevisionAuthor
  changeSummary: string
  operation: RevisionOperation
  /** Frozen at creation (deep-frozen by `revisions.ts`). Renderers read this, never "current" state. */
  snapshot: DocumentSnapshot
}

// ── Review marker (mock) ─────────────────────────────────────────────────────

/** A stored mock marker on one exact revision. Not an approval workflow. */
export interface ReviewMarker {
  reviewer: string
  decision: 'approved' | 'changes-requested'
  timestamp: string
  revisionId: RevisionId
  mock: true
}

// ── Exports ──────────────────────────────────────────────────────────────────

export type ExportFormat = 'pdf' | 'docx' | 'pptx'

export type ExportErrorCode =
  | 'unsupported-format'
  | 'validation-blocked'
  | 'renderer-failed'
  | 'font-missing-glyph'
  | 'cancelled'

export interface ExportError {
  code: ExportErrorCode
  message: string
}

export interface ExportArtifact {
  filename: string
  mimeType: string
  byteSize: number
  /** Object URL for the generated bytes (browser) or a local file path (tests/samples). */
  localUrl: string
}

interface ExportBase {
  exportId: ExportId
  outputId: OutputId
  /** Fixed when the job starts. Later edits never retarget it. */
  revisionId: RevisionId
  format: ExportFormat
  /** True when exported with missing required fields — the artifact carries a visible draft marker. */
  draft: boolean
  /** Set on a retry: the export it repeats (same revision, same format). */
  retryOf?: ExportId
}

export type ExportRecord =
  | (ExportBase & { status: 'pending' })
  | (ExportBase & { status: 'succeeded'; artifact: ExportArtifact })
  | (ExportBase & { status: 'failed'; error: ExportError })
  | (ExportBase & { status: 'unsupported'; error: ExportError })
