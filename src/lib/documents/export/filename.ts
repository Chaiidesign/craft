// Export filenames: {issuer}_{document number or title}_v{n}_{short revision ID}.{ext}
// (approved pattern). The revision ID stays the identity — the name only helps
// a person tell files apart; nothing ever parses it back.

import { BRIEF_FIELDS } from '../brief'
import { formatFieldValue } from '../display'
import { INVOICE_FIELDS } from '../invoice'
import type { DocumentSnapshot, ExportFormat, RevisionId } from '../model'
import { FORMAT_FILE } from './capabilities'

/** Each name part is capped at this many characters, cut at a hyphen where possible (approved). */
export const FILENAME_PART_MAX = 40

function slug(text: string, keepCase: boolean): string {
  const ascii = text.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const s = (keepCase ? ascii : ascii.toLowerCase()).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (s.length <= FILENAME_PART_MAX) return s
  const cut = s.slice(0, FILENAME_PART_MAX)
  const hyphen = cut.lastIndexOf('-')
  return (hyphen > FILENAME_PART_MAX / 2 ? cut.slice(0, hyphen) : cut).replace(/-+$/, '')
}

/** The low four hex digits of FNV-1a over the revision ID: short, stable, never parsed. */
export function shortRevisionId(revisionId: RevisionId): string {
  let h = 0x811c9dc5
  for (let i = 0; i < revisionId.length; i++) {
    h ^= revisionId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(-4)
}

function provided(snapshot: DocumentSnapshot, fieldId: string): string | null {
  const f = snapshot.fields[fieldId]
  return f?.state.status === 'provided' ? formatFieldValue(f.state.value, snapshot.locale, f) : null
}

export function exportFilename(snapshot: DocumentSnapshot, format: ExportFormat, version: number, revisionId: RevisionId): string {
  // An unbranded document (D-61) names its issuer only in the issuer field, if at all.
  const issuer = slug(snapshot.brand.issuerDisplayName || provided(snapshot, INVOICE_FIELDS.issuerName) || '', false) || 'issuer'
  const number = snapshot.kind === 'invoice' ? provided(snapshot, INVOICE_FIELDS.number) : null
  const title = snapshot.kind === 'invoice' ? null : provided(snapshot, BRIEF_FIELDS.title)
  const what = (number ? slug(number, true) : title ? slug(title, false) : '') || snapshot.kind
  return `${issuer}_${what}_v${version}_${shortRevisionId(revisionId)}.${FORMAT_FILE[format].extension}`
}
