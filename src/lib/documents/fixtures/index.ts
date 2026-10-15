// Registry of every PRD §11 fixture. All fictional sample data.
//
// Document fixtures carry a full snapshot now. Scenario fixtures (revisions,
// exports, error recovery) name the document they start from and the steps
// they exercise; the build step that implements them is recorded so the
// gallery can say honestly what is not runnable yet.

import type { DocumentSnapshot } from '../model'
import { evidenceBrief } from './brief'
import { SAMPLE_LABEL } from './builders'
import {
  brandBrokenLogoInvoice,
  brandLongNameInvoice,
  brandNoLogoInvoice,
  completeInvoice,
  incompleteInvoice,
  longInvoice,
} from './invoices'

export { SAMPLE_LABEL }

export type BuildStep = 'step-3' | 'step-4' | 'step-5' | 'step-6'

interface FixtureBase {
  id: string
  /** The PRD §11 fixture number this covers. */
  prdNumber: number
  title: string
  purpose: string
}

export interface DocumentFixture extends FixtureBase {
  type: 'document'
  build: () => DocumentSnapshot
}

export interface ScenarioFixture extends FixtureBase {
  type: 'scenario'
  /** The document fixture the scenario starts from (absent for pure session-recovery cases). */
  baseFixtureId?: string
  steps: readonly string[]
  /** The build step that makes this scenario runnable. */
  runsIn: BuildStep
}

export type Fixture = DocumentFixture | ScenarioFixture

/** An empty document: no fields, no blocks. Must explain itself, not show a blank canvas. */
function emptyDocument(): DocumentSnapshot {
  const base = completeInvoice()
  return { ...base, fields: {}, fieldOrder: [], blocks: [] }
}

export const FIXTURES: readonly Fixture[] = [
  { id: 'invoice-complete', prdNumber: 1, type: 'document', title: 'Complete branded invoice', purpose: 'Issuer-branded invoice with exact expected integer arithmetic (USD).', build: () => completeInvoice() },
  { id: 'invoice-missing', prdNumber: 2, type: 'document', title: 'Invoice with missing facts', purpose: 'Missing billing address, due date and tax applicability; total shown as incomplete, never as a false final amount (EUR).', build: incompleteInvoice },
  { id: 'invoice-long', prdNumber: 3, type: 'document', title: 'Long invoice', purpose: '42 rows, long descriptions, one very tall row, totals near a page boundary (INR, Indian digit grouping).', build: longInvoice },
  { id: 'brief-evidence', prdNumber: 4, type: 'document', title: 'Evidence-backed brief', purpose: 'Citations beside claims, a long heading, a chart with units and data summary, an internal note excluded from exports, and a source list.', build: evidenceBrief },
  {
    id: 'deck-from-brief', prdNumber: 5, type: 'scenario', title: 'Brief → slide deck', baseFixtureId: 'brief-evidence', runsIn: 'step-3',
    purpose: 'Adapt the brief into a 16:9 deck that records the source brief revision and splits dense content by meaning.',
    steps: ['Derive a deck from a given brief revision', 'Check ancestry points at that exact brief revision', 'Check mandatory facts and citations survive', 'Check no slide text falls below the type floor'],
  },
  {
    id: 'bounded-edit', prdNumber: 6, type: 'scenario', title: 'One-line edit', baseFixtureId: 'invoice-complete', runsIn: 'step-4',
    purpose: 'Edit one line item or one sentence; every other block is unchanged.',
    steps: ['Change the quantity on line 2', 'Save — creates v2', 'Compare v1 and v2 block by block: only line 2 and derived totals differ', 'Cancel a second edit — nothing changes'],
  },
  {
    id: 'approved-then-edited', prdNumber: 7, type: 'scenario', title: 'Approved v1 → unapproved v2', baseFixtureId: 'invoice-complete', runsIn: 'step-4',
    purpose: 'A mock approval marker stays on v1; v2 is unapproved; an export targets the selected revision explicitly.',
    steps: ['Mark v1 approved (mock marker)', 'Edit — creates v2', 'v2 shows as unapproved', 'Export v1 while v2 is current — the file is v1'],
  },
  {
    id: 'restore', prdNumber: 8, type: 'scenario', title: 'Restore v1 after v3', baseFixtureId: 'invoice-complete', runsIn: 'step-4',
    purpose: 'Restoring creates v4 from v1’s content with ancestry; v2 and v3 stay in history; approval is not inherited.',
    steps: ['Create v2 and v3', 'Restore v1', 'v4 exists, parent v3, restored from v1', 'History still lists v1–v4'],
  },
  {
    id: 'partial-export', prdNumber: 9, type: 'scenario', title: 'PDF succeeds, DOCX fails, PPTX unsupported', baseFixtureId: 'invoice-complete', runsIn: 'step-5',
    purpose: 'Per-format results: the PDF stays usable, DOCX shows its own error and retries the same revision, PPTX is honestly unavailable for invoices.',
    steps: ['Export PDF — succeeds', 'Export DOCX with a forced renderer failure — fails with a typed error', 'PPTX — disabled with a reason', 'Retry DOCX — same revision'],
  },
  { id: 'brand-no-logo', prdNumber: 10, type: 'document', title: 'Brand: no logo supplied', purpose: 'Labelled neutral fallback in place of a logo — never an invented mark (GBP).', build: brandNoLogoInvoice },
  { id: 'brand-broken-logo', prdNumber: 10, type: 'document', title: 'Brand: broken logo file', purpose: 'Profile claims a logo, but the file does not exist; rendering must detect it and use the same fallback (GBP).', build: brandBrokenLogoInvoice },
  { id: 'brand-long-name', prdNumber: 10, type: 'document', title: 'Brand: very long issuer name', purpose: 'A 99-character issuer name wraps without clipping or shrinking (GBP).', build: brandLongNameInvoice },
  { id: 'empty-document', prdNumber: 11, type: 'document', title: 'Empty document', purpose: 'No fields and no blocks: the preview explains what is missing instead of showing a blank canvas.', build: emptyDocument },
  {
    id: 'errors-and-recovery', prdNumber: 11, type: 'scenario', title: 'Errors, cancellation and recovery', baseFixtureId: 'invoice-complete', runsIn: 'step-6',
    purpose: 'Renderer vs viewer errors, a cancelled render whose late result is ignored, duplicate filenames, and malformed local-session recovery.',
    steps: ['Force a renderer error — draft survives, retry offered', 'Force a viewer error — structured view offered', 'Cancel a render; a late result must not overwrite a newer snapshot', 'Two exports with the same filename keep distinct revision identity', 'Load each malformed session — specific message, usable default'],
  },
]

export function getFixture(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id)
}
