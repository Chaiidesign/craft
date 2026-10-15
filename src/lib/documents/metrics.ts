// Font metrics from the committed TTFs: glyph advances (hmtx), units per em
// and vertical metrics. The layout engine measures text with these, the same
// way jsPDF does for embedded TrueType fonts (advance × 1000 / unitsPerEm, no
// kerning), so page breaks computed here hold in the preview and the PDF.
// A character the face cannot draw is an error, never a zero width.

import { resolveTheme, type DocumentTheme, type FontRole, type FontStyle, type FontWeight, type ThemeFace } from './theme'

export interface FaceMetrics {
  file: string
  unitsPerEm: number
  /** hhea ascender/descender in font units (descender negative). */
  ascender: number
  descender: number
  /** OS/2 typo ascender/descender, for PDF baseline placement (Step 5). */
  typoAscender: number
  typoDescender: number
  /** Advance width in font units, or undefined when the face has no glyph for the code point. */
  advance(codePoint: number): number | undefined
  /** Glyph index for a code point (outlines.ts draws it), or undefined when the face has none. */
  glyphId(codePoint: number): number | undefined
}

function tables(view: DataView, bytes: Uint8Array): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i * 16
    out.set(String.fromCharCode(...bytes.subarray(rec, rec + 4)), view.getUint32(rec + 8))
  }
  return out
}

function tableAt(t: Map<string, number>, tag: string): number {
  const offset = t.get(tag)
  if (offset === undefined) throw new Error(`Font has no ${tag} table`)
  return offset
}

/** Unicode → glyph ID from the best Unicode cmap subtable (3/10 format 12, else 3/1 or 0/* format 4). */
function glyphMap(view: DataView, cmap: number): Map<number, number> {
  const count = view.getUint16(cmap + 2)
  const candidates: { score: number; offset: number }[] = []
  for (let i = 0; i < count; i++) {
    const platform = view.getUint16(cmap + 4 + i * 8)
    const encoding = view.getUint16(cmap + 4 + i * 8 + 2)
    const offset = cmap + view.getUint32(cmap + 4 + i * 8 + 4)
    const format = view.getUint16(offset)
    if (format === 12 && (platform === 3 && encoding === 10 || platform === 0)) candidates.push({ score: 2, offset })
    else if (format === 4 && (platform === 3 && encoding === 1 || platform === 0)) candidates.push({ score: 1, offset })
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best) throw new Error('Font has no Unicode cmap subtable')
  const map = new Map<number, number>()
  const { offset } = best
  if (view.getUint16(offset) === 12) {
    const groups = view.getUint32(offset + 12)
    for (let g = 0; g < groups; g++) {
      const start = view.getUint32(offset + 16 + g * 12)
      const end = view.getUint32(offset + 20 + g * 12)
      const glyph = view.getUint32(offset + 24 + g * 12)
      for (let c = start; c <= end; c++) map.set(c, glyph + (c - start))
    }
    return map
  }
  const segX2 = view.getUint16(offset + 6)
  const ends = offset + 14
  const starts = ends + segX2 + 2
  const deltas = starts + segX2
  const rangeOffsets = deltas + segX2
  for (let s = 0; s < segX2 / 2; s++) {
    const end = view.getUint16(ends + s * 2)
    const start = view.getUint16(starts + s * 2)
    const delta = view.getInt16(deltas + s * 2)
    const rangeAt = rangeOffsets + s * 2
    const rangeOffset = view.getUint16(rangeAt)
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff
      else {
        const raw = view.getUint16(rangeAt + rangeOffset + (c - start) * 2)
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
      }
      if (glyph !== 0) map.set(c, glyph)
    }
  }
  return map
}

export function readFaceMetrics(bytes: Uint8Array, file: string): FaceMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const t = tables(view, bytes)
  const head = tableAt(t, 'head')
  const hhea = tableAt(t, 'hhea')
  const hmtx = tableAt(t, 'hmtx')
  const os2 = tableAt(t, 'OS/2')
  const unitsPerEm = view.getUint16(head + 18)
  const numberOfHMetrics = view.getUint16(hhea + 34)
  const glyphs = glyphMap(view, tableAt(t, 'cmap'))
  const lastAdvance = view.getUint16(hmtx + (numberOfHMetrics - 1) * 4)
  const advances = new Map<number, number>()
  for (const [cp, glyph] of glyphs) {
    advances.set(cp, glyph < numberOfHMetrics ? view.getUint16(hmtx + glyph * 4) : lastAdvance)
  }
  return {
    file,
    unitsPerEm,
    ascender: view.getInt16(hhea + 4),
    descender: view.getInt16(hhea + 6),
    typoAscender: view.getInt16(os2 + 68),
    typoDescender: view.getInt16(os2 + 70),
    advance: (cp) => advances.get(cp),
    glyphId: (cp) => glyphs.get(cp),
  }
}

// ── Font sets ────────────────────────────────────────────────────────────────

export class MissingGlyphError extends Error {
  constructor(readonly characters: readonly string[], readonly face: string, readonly text: string) {
    super(`${face} cannot draw ${characters.map((c) => `“${c}” (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}`)
  }
}

/** Metrics for every face of one theme, looked up by role/weight/style. */
export interface FontSet {
  theme: DocumentTheme
  face(role: FontRole, weight: FontWeight, style: FontStyle): { face: ThemeFace; metrics: FaceMetrics }
}

export function createFontSet(theme: DocumentTheme, bytesByFile: ReadonlyMap<string, Uint8Array>): FontSet {
  const metrics = new Map<string, FaceMetrics>()
  for (const face of theme.faces) {
    const bytes = bytesByFile.get(face.file)
    if (!bytes) throw new Error(`Font bytes missing for ${face.file}`)
    metrics.set(face.file, readFaceMetrics(bytes, face.file))
  }
  return {
    theme,
    face(role, weight, style) {
      const face = theme.faces.find((f) => f.role === role && f.weight === weight && f.style === style)
      if (!face) throw new Error(`Theme ${theme.id} has no ${role} ${weight} ${style} face`)
      return { face, metrics: metrics.get(face.file)! }
    },
  }
}

/** Width in points. Letter-spacing (em) is added after every character, as CSS and jsPDF's charSpace do. */
export function measureWidth(text: string, metrics: FaceMetrics, sizePt: number, trackingEm = 0): number {
  let units = 0
  const missing: string[] = []
  let count = 0
  for (const ch of text) {
    const advance = metrics.advance(ch.codePointAt(0)!)
    if (advance === undefined) { if (!missing.includes(ch)) missing.push(ch); continue }
    units += advance
    count++
  }
  if (missing.length) throw new MissingGlyphError(missing, metrics.file, text)
  return (units / metrics.unitsPerEm) * sizePt + count * trackingEm * sizePt
}

/** Loads the theme's faces in the browser (cached per URL) — the same bytes FontFace registers. */
const byteCache = new Map<string, Promise<Uint8Array>>()
export function loadFontBytes(url: URL): Promise<Uint8Array> {
  let pending = byteCache.get(url.href)
  if (!pending) {
    pending = fetch(url.href).then(async (res) => {
      if (!res.ok) throw new Error(`Font request failed (${res.status})`)
      return new Uint8Array(await res.arrayBuffer())
    })
    pending.catch(() => byteCache.delete(url.href))
    byteCache.set(url.href, pending)
  }
  return pending
}

export function themeFor(themeId: string | undefined): DocumentTheme {
  return resolveTheme(themeId).theme
}
