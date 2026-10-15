// Minimal TrueType reader: which characters a font can draw (cmap formats 4
// and 12) and its name-table strings. No dependency; works on the same bytes in
// tests (fs) and in the browser (fetch). Used to refuse text a face cannot
// render instead of letting an exporter draw empty boxes or substitute silently.

function tableOffset(view: DataView, bytes: Uint8Array, tag: string): number {
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16
    if (String.fromCharCode(...bytes.subarray(rec, rec + 4)) === tag) return view.getUint32(rec + 8)
  }
  throw new Error(`Font has no ${tag} table`)
}

/** Every Unicode code point mapped by the font's cmap. */
export function readCodePoints(bytes: Uint8Array): Set<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const cmap = tableOffset(view, bytes, 'cmap')
  const points = new Set<number>()
  const subtables = view.getUint16(cmap + 2)
  for (let i = 0; i < subtables; i++) {
    const offset = cmap + view.getUint32(cmap + 4 + i * 8 + 4)
    const format = view.getUint16(offset)
    if (format === 4) {
      const segments = view.getUint16(offset + 6) / 2
      for (let s = 0; s < segments; s++) {
        const end = view.getUint16(offset + 14 + s * 2)
        const start = view.getUint16(offset + 16 + segments * 2 + s * 2)
        for (let c = start; c <= end && c !== 0xffff; c++) points.add(c)
      }
    } else if (format === 12) {
      const groups = view.getUint32(offset + 12)
      for (let g = 0; g < groups; g++) {
        const start = view.getUint32(offset + 16 + g * 12)
        const end = view.getUint32(offset + 20 + g * 12)
        for (let c = start; c <= end; c++) points.add(c)
      }
    }
  }
  return points
}

/** Windows/English name-table strings: 1 family, 2 subfamily, 6 PostScript, 16/17 typographic family/subfamily. */
export function readNames(bytes: Uint8Array): Partial<Record<1 | 2 | 6 | 16 | 17, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const name = tableOffset(view, bytes, 'name')
  const count = view.getUint16(name + 2)
  const strings = name + view.getUint16(name + 4)
  const out: Partial<Record<1 | 2 | 6 | 16 | 17, string>> = {}
  for (let i = 0; i < count; i++) {
    const rec = name + 6 + i * 12
    const platform = view.getUint16(rec)
    const language = view.getUint16(rec + 4)
    const id = view.getUint16(rec + 6)
    if (platform !== 3 || language !== 0x409 || ![1, 2, 6, 16, 17].includes(id)) continue
    const length = view.getUint16(rec + 8)
    const start = strings + view.getUint16(rec + 10)
    let text = ''
    for (let j = 0; j < length; j += 2) text += String.fromCharCode(view.getUint16(start + j))
    out[id as 1 | 2 | 6 | 16 | 17] = text
  }
  return out
}

/** Characters in `text` the font cannot draw, deduplicated, in order of first appearance. Whitespace controls are ignored. */
export function missingCharacters(text: string, covered: ReadonlySet<number>): string[] {
  const missing: string[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue
    if (!covered.has(cp) && !missing.includes(ch)) missing.push(ch)
  }
  return missing
}
