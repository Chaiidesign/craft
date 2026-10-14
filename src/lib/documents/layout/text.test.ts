import { describe, expect, it } from 'vitest'

import { MissingGlyphError } from '../metrics'
import { nodeFontSet } from '../testing/nodeFonts'
import { PRINT_TYPE } from '../tokens'
import { breakLines, measure } from './text'

const fonts = nodeFontSet()
const body = PRINT_TYPE.body
const text = (lines: ReturnType<typeof breakLines>) => lines.map((l) => l.segments.map((s) => s.text).join(''))

describe('line breaking', () => {
  const sentence = 'Most cancellations happen in the first four weeks, and the main stated reason is that the first box did not match what members expected.'

  it('wraps at spaces, never exceeds the width, and keeps every word once', () => {
    for (const width of [80, 150, 240, 493]) {
      const lines = breakLines(fonts, [{ text: sentence, style: body }], width)
      for (const l of lines) expect(l.width).toBeLessThanOrEqual(width + 1e-6)
      expect(text(lines).join(' ')).toBe(sentence)
      for (const l of text(lines)) expect(l).toBe(l.trim())
    }
  })

  it('reports line widths equal to the measured text', () => {
    for (const l of breakLines(fonts, [{ text: sentence, style: body }], 200)) {
      const joined = l.segments.map((s) => s.text).join('')
      expect(l.width).toBeCloseTo(measure(fonts, joined, body), 6)
    }
  })

  it('mixes styles on one line and keeps no-break spaces together', () => {
    const lines = breakLines(fonts, [
      { text: 'what members expected', style: body },
      { text: ' [1, 2]', style: PRINT_TYPE.citation },
      { text: '. Next sentence follows here.', style: body },
    ], 1000)
    expect(lines).toHaveLength(1)
    expect(lines[0].segments.map((s) => s.style)).toEqual([body, PRINT_TYPE.citation, body])
    // A narrow measure never separates the marker from its word.
    const marker = { text: '\u00a0[1,\u00a02]', style: PRINT_TYPE.citation }
    const glued = measure(fonts, 'expected', body) + measure(fonts, marker.text, marker.style)
    const narrow = text(breakLines(fonts, [{ text: 'members expected', style: body }, marker], glued + 1))
    expect(narrow).toEqual(['members', 'expected\u00a0[1,\u00a02]'])
  })

  it('honours explicit newlines and breaks after hyphens and dashes', () => {
    expect(text(breakLines(fonts, [{ text: '41 Larkspur Row\nPortland, OR 97209', style: body }], 1000))).toEqual(['41 Larkspur Row', 'Portland, OR 97209'])
    const hyphenated = text(breakLines(fonts, [{ text: 'first-month cancellations', style: body }], measure(fonts, 'first-mon', body)))
    expect(hyphenated[0]).toBe('first-')
  })

  it('breaks a word wider than the line between characters instead of overflowing', () => {
    const lines = breakLines(fonts, [{ text: 'Supercalifragilisticexpialidocious', style: body }], 50)
    expect(lines.length).toBeGreaterThan(2)
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(50 + 1e-6)
    expect(text(lines).join('')).toBe('Supercalifragilisticexpialidocious')
  })

  it('measures uppercase styles in uppercase', () => {
    expect(measure(fonts, 'Draft', PRINT_TYPE.draftMarker)).toBeCloseTo(measure(fonts, 'DRAFT', PRINT_TYPE.draftMarker), 6)
  })

  it('throws on characters the face cannot draw', () => {
    expect(() => breakLines(fonts, [{ text: '￥1,200', style: PRINT_TYPE.amount }], 100)).toThrow(MissingGlyphError)
  })
})
