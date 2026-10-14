// Glyph outlines from the committed TrueType files (glyf/loca), as SVG path
// data. Used where text must become shapes so it looks the same whatever
// fonts the viewer has: the chart picture in Word files, rasterised to PNG
// with no font lookup at all. Quadratic contours, simple and composite glyphs.

import { measureWidth, type FaceMetrics, type FontSet } from './metrics'
import type { TextStyle } from './tokens'

type Point = { x: number; y: number; on: boolean }

function tables(view: DataView, bytes: Uint8Array): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i * 16
    out.set(String.fromCharCode(...bytes.subarray(rec, rec + 4)), view.getUint32(rec + 8))
  }
  return out
}

export interface OutlineReader {
  /** Contours of a glyph in font units (y up). */
  contours(glyphId: number): Point[][]
}

export function outlineReader(bytes: Uint8Array): OutlineReader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const t = tables(view, bytes)
  const head = t.get('head'), loca = t.get('loca'), glyf = t.get('glyf'), maxp = t.get('maxp')
  if (head === undefined || loca === undefined || glyf === undefined || maxp === undefined) throw new Error('Font has no TrueType outlines (glyf/loca)')
  const longOffsets = view.getInt16(head + 50) === 1
  const numGlyphs = view.getUint16(maxp + 4)
  const offset = (g: number) => (longOffsets ? view.getUint32(loca + g * 4) : view.getUint16(loca + g * 2) * 2)

  const read = (g: number, depth: number): Point[][] => {
    if (g >= numGlyphs || depth > 8) throw new Error(`Glyph ${g} out of range`)
    const start = glyf + offset(g)
    if (offset(g + 1) === offset(g)) return []
    const n = view.getInt16(start)
    if (n >= 0) {
      const ends = Array.from({ length: n }, (_, i) => view.getUint16(start + 10 + i * 2))
      const count = n ? ends[n - 1] + 1 : 0
      let at = start + 10 + n * 2
      at += 2 + view.getUint16(at)
      const flags: number[] = []
      while (flags.length < count) {
        const f = view.getUint8(at++)
        flags.push(f)
        if (f & 8) { const r = view.getUint8(at++); for (let k = 0; k < r; k++) flags.push(f) }
      }
      const coords = (short: number, same: number) => {
        const out: number[] = []
        let v = 0
        for (const f of flags) {
          if (f & short) { const d = view.getUint8(at++); v += f & same ? d : -d }
          else if (!(f & same)) { v += view.getInt16(at); at += 2 }
          out.push(v)
        }
        return out
      }
      const xs = coords(2, 16)
      const ys = coords(4, 32)
      const contours: Point[][] = []
      let first = 0
      for (const end of ends) {
        contours.push(Array.from({ length: end - first + 1 }, (_, k) => ({ x: xs[first + k], y: ys[first + k], on: Boolean(flags[first + k] & 1) })))
        first = end + 1
      }
      return contours
    }
    // Composite glyph.
    const out: Point[][] = []
    let at = start + 10
    let more = true
    while (more) {
      const flags = view.getUint16(at)
      const child = view.getUint16(at + 2)
      at += 4
      let dx: number, dy: number
      if (flags & 1) { dx = view.getInt16(at); dy = view.getInt16(at + 2); at += 4 } else { dx = view.getInt8(at); dy = view.getInt8(at + 1); at += 2 }
      if (!(flags & 2)) throw new Error('Composite glyphs anchored by point numbers are not supported')
      let a = 1, b = 0, c = 0, d = 1
      const f2 = (o: number) => view.getInt16(o) / 16384
      if (flags & 8) { a = d = f2(at); at += 2 }
      else if (flags & 64) { a = f2(at); d = f2(at + 2); at += 4 }
      else if (flags & 128) { a = f2(at); b = f2(at + 2); c = f2(at + 4); d = f2(at + 6); at += 8 }
      for (const contour of read(child, depth + 1)) out.push(contour.map((p) => ({ x: a * p.x + c * p.y + dx, y: b * p.x + d * p.y + dy, on: p.on })))
      more = Boolean(flags & 32)
    }
    return out
  }
  return { contours: (g) => read(g, 0) }
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)

/** SVG path data for a contour list, mapped by `map` (font units → output units). */
export function contoursToPath(contours: Point[][], map: (x: number, y: number) => [number, number]): string {
  let d = ''
  for (const pts of contours) {
    if (!pts.length) continue
    // Start on an on-curve point (or the midpoint of two off-curve points).
    const startIndex = pts.findIndex((p) => p.on)
    const ring = startIndex >= 0 ? [...pts.slice(startIndex), ...pts.slice(0, startIndex)] : pts
    const startPt = startIndex >= 0 ? ring[0] : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, on: true }
    const [sx, sy] = map(startPt.x, startPt.y)
    d += `M${fmt(sx)} ${fmt(sy)}`
    const rest = startIndex >= 0 ? ring.slice(1) : ring
    let ctrl: Point | null = null
    for (const p of [...rest, startPt]) {
      if (p.on) {
        const [x, y] = map(p.x, p.y)
        if (ctrl) { const [cx, cy] = map(ctrl.x, ctrl.y); d += `Q${fmt(cx)} ${fmt(cy)} ${fmt(x)} ${fmt(y)}`; ctrl = null } else d += `L${fmt(x)} ${fmt(y)}`
      } else if (ctrl) {
        const mid = { x: (ctrl.x + p.x) / 2, y: (ctrl.y + p.y) / 2 }
        const [cx, cy] = map(ctrl.x, ctrl.y)
        const [mx, my] = map(mid.x, mid.y)
        d += `Q${fmt(cx)} ${fmt(cy)} ${fmt(mx)} ${fmt(my)}`
        ctrl = p
      } else ctrl = p
    }
    d += 'Z'
  }
  return d
}

/** Text as one SVG path, with its left end at x and its baseline at y (output units = pt). */
export function textPath(fonts: FontSet, fontBytes: ReadonlyMap<string, Uint8Array>, text: string, style: TextStyle, x: number, y: number): { d: string; width: number } {
  const { face, metrics } = fonts.face(style.role, style.weight, style.style)
  const bytes = fontBytes.get(face.file)
  if (!bytes) throw new Error(`Font bytes missing for ${face.file}`)
  const reader = readerFor(bytes)
  const s = style.uppercase ? text.toUpperCase() : text
  const scale = style.sizePt / metrics.unitsPerEm
  let cx = x
  let d = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    const g = (metrics as FaceMetrics).glyphId(cp)
    const adv = metrics.advance(cp)
    if (g === undefined || adv === undefined) measureWidth(ch, metrics, style.sizePt) // throws MissingGlyphError
    const ox = cx
    d += contoursToPath(reader.contours(g!), (gx, gy) => [ox + gx * scale, y - gy * scale])
    cx += adv! * scale + style.letterSpacingEm * style.sizePt
  }
  return { d, width: cx - x }
}

const readers = new WeakMap<Uint8Array, OutlineReader>()
function readerFor(bytes: Uint8Array): OutlineReader {
  let r = readers.get(bytes)
  if (!r) { r = outlineReader(bytes); readers.set(bytes, r) }
  return r
}
