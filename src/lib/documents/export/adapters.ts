// The PRD §5 renderer contract: each adapter states its capabilities,
// validates a frozen snapshot, and renders it to bytes with a typed success
// or error. Adapters never read "current" state — they get one snapshot.

import { MissingGlyphError } from '../metrics'
import type { DocumentKind, DocumentSnapshot, ExportError, ExportFormat } from '../model'
import { validateSnapshot } from '../validation'
import { capability, FORMAT_LABEL, type Capability } from './capabilities'
import { renderDocx } from './docx'
import { LayoutRefusedError, renderDeckPdf, renderDocumentPdf } from './pdf'
import { renderPptx } from './pptx'
import type { ExportResources } from './resources'

export interface RenderOptions {
  resources: ExportResources
  title: string
  subject: string
  /** ISO time of the export, written as the file's creation date where the format has one. */
  createdAt: string
  /** Scenario 9 only: make this renderer fail at its render step, deliberately and visibly. */
  forceFailure?: boolean
}

export type Validation =
  | { ok: true; draft: boolean; missingCount: number }
  | { ok: false; error: ExportError }

export type RenderOutcome =
  | { ok: true; bytes: Uint8Array; pageCount: number }
  | { ok: false; error: ExportError }

export interface ExportAdapter {
  format: ExportFormat
  capabilities(kind: DocumentKind): Capability
  validate(snapshot: DocumentSnapshot): Validation
  render(snapshot: DocumentSnapshot, options: RenderOptions): Promise<RenderOutcome>
}

export const FORCED_FAILURE_MESSAGE = 'Forced renderer failure (scenario 9 only)'

function validate(format: ExportFormat, snapshot: DocumentSnapshot): Validation {
  const cap = capability(snapshot.kind, format)
  if (!cap.supported) return { ok: false, error: { code: 'unsupported-format', message: cap.reason } }
  if (snapshot.blocks.length === 0 && snapshot.fieldOrder.length === 0) {
    return { ok: false, error: { code: 'validation-blocked', message: `This ${snapshot.kind} has no fields and no content blocks, so there is nothing to export.` } }
  }
  const report = validateSnapshot(snapshot)
  if (report.readiness === 'invalid') {
    return { ok: false, error: { code: 'validation-blocked', message: report.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ') } }
  }
  return { ok: true, draft: report.readiness === 'incomplete', missingCount: report.issues.filter((i) => i.severity === 'missing').length }
}

function failure(e: unknown): ExportError {
  if (e instanceof LayoutRefusedError) {
    return { code: e.refusal.kind === 'missing-glyph' ? 'font-missing-glyph' : 'validation-blocked', message: e.refusal.message }
  }
  if (e instanceof MissingGlyphError) return { code: 'font-missing-glyph', message: e.message }
  return { code: 'renderer-failed', message: e instanceof Error ? e.message : String(e) }
}

function adapter(format: ExportFormat, render: (s: DocumentSnapshot, o: RenderOptions) => Promise<{ bytes: Uint8Array; pageCount: number }>): ExportAdapter {
  return {
    format,
    capabilities: (kind) => capability(kind, format),
    validate: (snapshot) => validate(format, snapshot),
    async render(snapshot, options) {
      const checked = validate(format, snapshot)
      if (!checked.ok) return checked
      try {
        if (options.forceFailure) throw new Error(FORCED_FAILURE_MESSAGE)
        const out = await render(snapshot, options)
        if (out.bytes.byteLength === 0) return { ok: false, error: { code: 'renderer-failed', message: `${FORMAT_LABEL[format]} renderer produced an empty file` } }
        return { ok: true, ...out }
      } catch (e) {
        return { ok: false, error: failure(e) }
      }
    },
  }
}

export const ADAPTERS: Record<ExportFormat, ExportAdapter> = {
  pdf: adapter('pdf', async (s, o) => {
    const meta = { title: o.title, subject: o.subject, createdAt: o.createdAt }
    const r = s.kind === 'deck' ? await renderDeckPdf(s, o.resources, meta) : await renderDocumentPdf(s, o.resources, meta)
    return { bytes: r.bytes, pageCount: r.pageCount }
  }),
  docx: adapter('docx', async (s, o) => {
    if (s.kind === 'deck') throw new Error('unreachable: decks have no Word format')
    const r = await renderDocx(s, o.resources, { title: o.title, subject: o.subject })
    return { bytes: r.bytes, pageCount: r.enginePages }
  }),
  pptx: adapter('pptx', async (s, o) => {
    if (s.kind !== 'deck') throw new Error('unreachable: only decks have a slide format')
    const r = await renderPptx(s, o.resources, { title: o.title, subject: o.subject })
    return { bytes: r.bytes, pageCount: r.slideCount }
  }),
}
