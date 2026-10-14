// What each document kind can be exported as. A format button is a capability
// claim (PRD §10), so the workbench reads this table and nothing else: an
// unsupported pair is shown disabled with its reason, never offered and then
// renamed or faked. Invoices and briefs never become slides; decks never
// become Word files.

import type { DocumentKind, ExportFormat } from '../model'

export const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint' }

export const FORMAT_FILE: Record<ExportFormat, { extension: string; mimeType: string }> = {
  pdf: { extension: 'pdf', mimeType: 'application/pdf' },
  docx: { extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { extension: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
}

export type Capability = { supported: true } | { supported: false; reason: string }

const NO_SLIDES = 'Invoices and briefs have no slide format.'
const DECK_ONLY = 'Decks export as PowerPoint or PDF.'

const TABLE: Record<DocumentKind, Record<ExportFormat, Capability>> = {
  invoice: { pdf: { supported: true }, docx: { supported: true }, pptx: { supported: false, reason: NO_SLIDES } },
  brief: { pdf: { supported: true }, docx: { supported: true }, pptx: { supported: false, reason: NO_SLIDES } },
  deck: { pptx: { supported: true }, pdf: { supported: true }, docx: { supported: false, reason: DECK_ONLY } },
}

/** Formats in the order the workbench offers them for a kind (supported first). */
export function formatsFor(kind: DocumentKind): ExportFormat[] {
  const order: ExportFormat[] = kind === 'deck' ? ['pptx', 'pdf', 'docx'] : ['pdf', 'docx', 'pptx']
  return order
}

export function capability(kind: DocumentKind, format: ExportFormat): Capability {
  return TABLE[kind][format]
}
