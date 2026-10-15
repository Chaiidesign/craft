import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'

import { readCodePoints } from './glyphs'
import { measureWidth, MissingGlyphError, readFaceMetrics } from './metrics'
import { PLACEHOLDER_THEME } from './theme'

const bytesOf = (url: URL) => new Uint8Array(readFileSync(fileURLToPath(url)))
const SAMPLES = [
  'Invoice', 'Halden & Rowe Studio', '$7,514.82', '₹1,23,456.78', '-€365.37', 'Brand identity system — logo suite, colour and type guidelines',
  'Reducing first-month cancellations for an independent bookshop’s subscription box', '12.5 hours', 'DRAFT — INCOMPLETE', 'Weeks 5–8',
]

describe('font metrics', () => {
  it('maps every code point glyphs.ts reports, so coverage and measurement agree', () => {
    for (const face of PLACEHOLDER_THEME.faces) {
      const bytes = bytesOf(face.url)
      const metrics = readFaceMetrics(bytes, face.file)
      const missing = [...readCodePoints(bytes)].filter((cp) => metrics.advance(cp) === undefined && cp !== 0xffff)
      // Code points mapped to glyph 0 (.notdef) are not drawable; anything else must have an advance.
      expect(missing.length, face.file).toBeLessThan(5)
      expect(metrics.unitsPerEm, face.file).toBeGreaterThan(0)
      expect(metrics.ascender).toBeGreaterThan(0)
      expect(metrics.descender).toBeLessThan(0)
    }
  })

  it('measures exactly as jsPDF does for the embedded TTFs (no kerning)', () => {
    for (const face of PLACEHOLDER_THEME.faces) {
      const bytes = bytesOf(face.url)
      const metrics = readFaceMetrics(bytes, face.file)
      const doc = new jsPDF({ unit: 'pt' })
      doc.addFileToVFS(face.file, Buffer.from(bytes).toString('binary'))
      doc.addFont(face.file, 'probe', 'normal')
      doc.setFont('probe', 'normal')
      doc.setFontSize(10)
      for (const text of SAMPLES) {
        const ours = measureWidth(text, metrics, 10)
        const theirs = doc.getTextWidth(text)
        expect(Math.abs(ours - theirs), `${face.file}: ${text}`).toBeLessThan(0.001)
      }
    }
  })

  it('adds letter-spacing after each character', () => {
    const face = PLACEHOLDER_THEME.faces.find((f) => f.role === 'function')!
    const metrics = readFaceMetrics(bytesOf(face.url), face.file)
    expect(measureWidth('ABCD', metrics, 10, 0.1) - measureWidth('ABCD', metrics, 10)).toBeCloseTo(4, 6)
  })

  it('refuses characters the face cannot draw instead of measuring them as zero', () => {
    const face = PLACEHOLDER_THEME.faces.find((f) => f.role === 'money')!
    const metrics = readFaceMetrics(bytesOf(face.url), face.file)
    expect(() => measureWidth('￥1,200', metrics, 10)).toThrow(MissingGlyphError)
    expect(() => measureWidth('नमस्ते', metrics, 10)).toThrow(/cannot draw/)
  })
})
