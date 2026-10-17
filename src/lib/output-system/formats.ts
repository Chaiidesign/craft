// Builds docs/output-system/formats.json: which formats each kind of thing can
// be exported to (D-76). Where the document engine has code, the answer is
// read from src/lib/documents/export/capabilities.ts, so the list cannot claim
// a format the engine doesn't export. Kinds with no code yet are marked
// "planned", and their formats are proposals, not capabilities.
//
// Regenerate with: npx vite-node scripts/output-system/build-formats.ts
// A test fails if the committed formats.json differs from this output.

import { capability, FORMAT_FILE, FORMAT_LABEL, formatsFor } from '../documents/export/capabilities'
import type { DocumentKind, ExportFormat } from '../documents/model'
import { LANE_LABELS, LANES, type Lane } from './lanes'

export const FORMATS_FORMAT_VERSION = 1

/** Formats with no exporter in the engine yet: named so planned kinds can refer to them. */
const PLANNED_FORMATS = {
  png: { label: 'PNG image', extension: 'png', mimeType: 'image/png' },
  xlsx: { label: 'Excel', extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { label: 'CSV', extension: 'csv', mimeType: 'text/csv' },
  json: { label: 'JSON', extension: 'json', mimeType: 'application/json' },
  link: { label: 'Private link', extension: null, mimeType: null },
} as const

type PlannedFormat = keyof typeof PLANNED_FORMATS
type AnyFormat = ExportFormat | PlannedFormat

/** The engine kinds behind each kind of thing, where there is code. */
const BUILT: Partial<Record<Lane, { kind: DocumentKind; covers: string; plannedTypes: string[] }>> = {
  strict_document: { kind: 'invoice', covers: 'Invoices', plannedTypes: ['quote', 'purchase order', 'receipt', 'returns policy'] },
  composed_document: { kind: 'brief', covers: 'Briefs, memos and reports', plannedTypes: ['campaign plan', 'spec sheet', 'guide', 'letter', 'one-pager', 'proposal'] },
  design: { kind: 'deck', covers: 'Slides and decks', plannedTypes: ['ad', 'social post', 'banner', 'product page mockup'] },
}

/** Proposed formats for what has no code yet (D-73: assumed until built). Closest first. */
const PLANNED: Record<Lane, { formats: AnyFormat[]; note: string }> = {
  chat_reply: { formats: [], note: 'A chat reply is not exported. To pass it on, it becomes a composed document first.' },
  message_card: { formats: [], note: 'A message is copied or sent, not exported.' },
  inline_chart: { formats: ['png', 'csv'], note: 'The picture of the chart, or the numbers behind it.' },
  strict_document: { formats: ['pdf', 'docx'], note: 'Planned types follow the invoice: PDF and Word, never slides.' },
  composed_document: { formats: ['pdf', 'docx'], note: 'Planned types follow the brief: PDF and Word, never slides.' },
  design: { formats: ['png', 'pdf'], note: 'Single designs (ads, posts, banners, mockups) as an image or PDF; slides keep the deck formats.' },
  dashboard: { formats: ['link', 'pdf', 'xlsx'], note: 'A dashboard lives at its link; a PDF or Excel file is a snapshot of one moment.' },
  published_page: { formats: ['link'], note: 'An interactive page only works at its link. It cannot become a document, slides or a spreadsheet.' },
  file: { formats: ['xlsx', 'csv', 'json', 'pdf'], note: 'Raw data exports, and changed uploads in the format they arrived in.' },
}

function formatTable() {
  const built = Object.fromEntries(
    (Object.keys(FORMAT_FILE) as ExportFormat[]).map((f) => [f, { label: FORMAT_LABEL[f], ...FORMAT_FILE[f], status: 'built' }]),
  )
  const planned = Object.fromEntries(Object.entries(PLANNED_FORMATS).map(([f, v]) => [f, { ...v, status: 'planned' }]))
  return { ...built, ...planned }
}

function builtExports(kind: DocumentKind) {
  return formatsFor(kind).map((format) => {
    const c = capability(kind, format)
    return c.supported ? { format, supported: true } : { format, supported: false, reason: c.reason }
  })
}

export function buildOutputFormats() {
  return {
    $comment:
      'Generated from src/lib/documents/export/capabilities.ts by scripts/output-system/build-formats.ts. Do not edit by hand. "built" exports are what the document engine does today; "planned" formats are proposals for kinds with no code yet. Formats are listed closest first, so the first supported one is the closest offer when a named format is not supported.',
    version: FORMATS_FORMAT_VERSION,
    formats: formatTable(),
    kinds: Object.fromEntries(
      LANES.map((lane) => {
        const built = BUILT[lane]
        const planned = PLANNED[lane]
        return [
          lane,
          {
            label: LANE_LABELS[lane],
            ...(built
              ? { status: 'built', built: { covers: built.covers, engineKind: built.kind, exports: builtExports(built.kind) }, planned: { types: built.plannedTypes, formats: planned.formats, note: planned.note } }
              : { status: 'planned', planned: { formats: planned.formats, note: planned.note } }),
          },
        ]
      }),
    ),
  }
}

export function outputFormatsJson(): string {
  return `${JSON.stringify(buildOutputFormats(), null, 2)}\n`
}
