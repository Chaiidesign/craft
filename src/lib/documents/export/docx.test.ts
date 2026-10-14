import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { evidenceBrief } from '../fixtures/brief'
import { completeInvoice, incompleteInvoice, longInvoice } from '../fixtures/invoices'
import type { DocumentSnapshot } from '../model'
import { resolveTheme } from '../theme'
import { nodeResources } from '../testing/nodeResources'
import { readZip, zipText } from '../testing/zip'
import { renderDocx } from './docx'

const render = async (s: Exclude<DocumentSnapshot, { kind: 'deck' }>) => {
  const r = await renderDocx(s, nodeResources(s), { title: 'Test', subject: 'Revision rev-001' })
  const zip = readZip(r.bytes)
  return { r, zip, xml: zipText(zip, 'word/document.xml') }
}
const text = (xml: string) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
const { theme } = resolveTheme('placeholder')

/** Undo the ODTTF obfuscation (first 32 bytes XORed with the reversed GUID key). */
function deobfuscate(data: Uint8Array, key: string): Uint8Array {
  const hex = key.replace(/[{}-]/g, '')
  const keyBytes = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).reverse()
  const out = data.slice()
  for (let i = 0; i < 32; i++) out[i] ^= keyBytes[i % 16]
  return out
}

describe('Word renderer', () => {
  it('writes a real .docx: a zip with the WordprocessingML parts and core properties', async () => {
    const { r, zip } = await render(completeInvoice())
    expect([...r.bytes.subarray(0, 2)]).toEqual([0x50, 0x4b])
    expect(zipText(zip, '[Content_Types].xml')).toContain('wordprocessingml.document.main+xml')
    expect(zipText(zip, 'docProps/core.xml')).toContain('<dc:title>Test</dc:title>')
  })

  it('native text and tables: line items, totals and parties are editable content, not images', async () => {
    const { xml } = await render(completeInvoice())
    const t = text(xml)
    for (const s of ['Invoice', 'HRS-2026-0142', 'Brand identity system', '$4,800.00', 'Total due', '$7,514.82', 'Net 30.']) expect(t).toContain(s)
    expect(xml.match(/<w:tbl>/g)!.length).toBeGreaterThanOrEqual(4)
    // The body ends on content plus, after a final table, one 1pt paragraph — never a full-height
    // empty line that would spill onto a blank page.
    const body = xml.slice(0, xml.lastIndexOf('<w:sectPr'))
    const tail = body.slice(body.lastIndexOf('</w:tbl>'))
    expect(text(body.slice(body.lastIndexOf('<w:tbl>')))).toContain('Net 30.')
    expect(tail.match(/<w:p>|<w:p /g)?.length ?? 0).toBeLessThanOrEqual(1)
    expect(text(tail)).toBe('')
    if (/<w:p[ >]/.test(tail)) expect(tail).toContain('w:line="20"')
  })

  it('names fonts exactly as their TTF name tables and never fakes bold', async () => {
    const { xml } = await render(evidenceBrief())
    const named = new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]))
    for (const n of named) expect(theme.faces.map((f) => f.nameTable.family)).toContain(n)
    expect(xml).not.toMatch(/<w:b\/>|<w:b w:val="true"\/>/)
    // The italic cut is the voice role's italic face, named by its family with italics on.
    const italicFamily = theme.faces.find((f) => f.nameTable.subfamily === 'Italic')!.nameTable.family
    expect(xml).toMatch(new RegExp(`w:ascii="${italicFamily}"[^]*?<w:i/>`))
  })

  it('embeds all eight faces, de-obfuscating to the committed TTF bytes', async () => {
    const { r, zip } = await render(completeInvoice())
    const fontTable = zipText(zip, 'word/fontTable.xml')
    const rels = zipText(zip, 'word/_rels/fontTable.xml.rels')
    expect(zipText(zip, 'word/settings.xml')).toContain('<w:embedTrueTypeFonts/>')
    const embeds = [...fontTable.matchAll(/<w:font w:name="([^"]+)">([^]*?)<\/w:font>/g)].flatMap((m) => [...m[2].matchAll(/<w:embed(Regular|Italic) [^>]*r:id="([^"]+)"[^>]*w:fontKey="([^"]+)"/g)].map((e) => ({ family: m[1], slot: e[1], rid: e[2], key: e[3] })))
    expect(embeds).toHaveLength(theme.faces.length)
    const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
    for (const e of embeds) {
      const target = new RegExp(`Id="${e.rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${e.rid}"`).exec(rels)![1]
      const data = zip.get(`word/${target.replace(/^\//, '').replace(/^word\//, '')}`)!
      const face = theme.faces.find((f) => f.nameTable.family === e.family && (e.slot === 'Italic') === (f.nameTable.subfamily === 'Italic'))!
      expect(sha(deobfuscate(data, e.key))).toBe(sha(new Uint8Array(readFileSync(fileURLToPath(face.url)))))
    }
    expect(r.embeddedFonts.map((f) => f.family).sort()).toEqual([...new Set(theme.faces.map((f) => f.nameTable.family))].sort())
  })

  it('passes the page-break rules on as Word settings', async () => {
    const { xml, zip } = await render(longInvoice())
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toContain('<w:cantSplit/>')
    expect(xml).toContain('<w:keepNext/>')
    expect(xml).toContain('<w:widowControl/>')
    // Every row is kept whole except the one the engine had to split across pages, if any.
    const rows = xml.match(/<w:tr>|<w:tr [^>]*>/g)!.length
    const cantSplit = xml.match(/<w:cantSplit\/>/g)!.length
    expect(rows - cantSplit).toBeLessThanOrEqual(1)
    // Page n of N: Word fields, and a different first page so page 1 has no running header.
    const footers = [...zip.keys()].filter((k) => /^word\/footer\d\.xml$/.test(k)).map((k) => zipText(zip, k)).join('')
    expect(footers).toMatch(/PAGE/)
    expect(footers).toMatch(/NUMPAGES/)
    expect(xml).toContain('<w:titlePg/>')
    // Every header and footer part holds at least one paragraph (required by the schema), including page 1's empty header.
    for (const k of [...zip.keys()].filter((k) => /^word\/(header|footer)\d\.xml$/.test(k))) expect(zipText(zip, k), k).toMatch(/<w:p[ >/]/)
  })

  it('keeps missing facts and the draft marker visible', async () => {
    const { xml, zip } = await render(incompleteInvoice())
    const t = text(xml)
    expect(t).toContain('Draft — incomplete')
    expect(xml).toContain('<w:caps/>')
    expect(t).toMatch(/Missing/)
    expect(t).toContain('Incomplete — not a final amount')
    const headers = [...zip.keys()].filter((k) => /^word\/header\d\.xml$/.test(k)).map((k) => text(zipText(zip, k))).join('')
    expect(headers).toContain('Draft — incomplete')
  })

  it('brief: citations, the chart as a picture (SVG + PNG fallback) and as an editable data table, and the sources', async () => {
    const { xml, zip } = await render(evidenceBrief())
    const t = text(xml)
    expect(t).toContain('[1,\u00a02]')
    expect(t).toContain('Week since joining')
    expect(t).toContain('Weeks 5–8')
    expect(t).toContain('Cancellations peak in week 3 (21%)')
    expect(t).not.toContain('Internal note')
    const media = [...zip.keys()].filter((k) => k.startsWith('word/media/'))
    expect(media.some((k) => k.endsWith('.svg'))).toBe(true)
    const png = zip.get(media.find((k) => k.endsWith('.png'))!)!
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const svg = new TextDecoder().decode(zip.get(media.find((k) => k.endsWith('.svg'))!)!)
    // Labels are outlines, not text that depends on the viewer's fonts.
    expect(svg).not.toContain('<text')
    expect(svg.match(/<path /g)!.length).toBeGreaterThanOrEqual(12)
  })
})
