import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { collectStyledText, composeDocument } from './compose'
import { FIXTURES } from './fixtures'
import { missingCharacters, readCodePoints } from './glyphs'
import { CURRENCIES } from './defaults'
import type { CurrencyCode, DocumentSnapshot } from './model'
import { formatMoney, money } from './money'
import { faceFor, resolveTheme, type ThemeFace } from './theme'
import { PRINT_TYPE } from './tokens'

const coverage = new Map<string, Set<number>>()
function covered(face: ThemeFace): Set<number> {
  let set = coverage.get(face.file)
  if (!set) {
    set = readCodePoints(new Uint8Array(readFileSync(fileURLToPath(face.url))))
    coverage.set(face.file, set)
  }
  return set
}

const documents = FIXTURES.flatMap((f) => (f.type === 'document' ? [{ id: f.id, snapshot: f.build() as DocumentSnapshot }] : []))

describe('glyph coverage', () => {
  it('every character each fixture draws exists in the exact face that draws it', () => {
    const gaps: string[] = []
    for (const { id, snapshot } of documents) {
      const { theme } = resolveTheme(snapshot.brand.themeId)
      for (const audience of ['recipient', 'internal'] as const) {
        const texts = collectStyledText(composeDocument(snapshot, { audience }))
        if (snapshot.blocks.length > 0) expect(texts.length, `${id} draws text`).toBeGreaterThan(20)
        for (const { style, text } of texts) {
          const s = PRINT_TYPE[style]
          const face = faceFor(theme, s.role, s.weight, s.style)
          if (!face) { gaps.push(`${id}: no ${s.role} ${s.weight} ${s.style} face for ${style}`); continue }
          const missing = missingCharacters(s.uppercase ? text.toUpperCase() : text, covered(face))
          if (missing.length) gaps.push(`${id} [${style} → ${face.file}]: ${missing.join(' ')} in “${text}”`)
        }
      }
    }
    expect(gaps).toEqual([])
  })

  it('both Money faces carry every fixture currency symbol, including ₹', () => {
    const { theme } = resolveTheme(undefined)
    const fixtureCurrencies = new Set<CurrencyCode>()
    for (const { snapshot } of documents) {
      for (const field of Object.values(snapshot.fields)) {
        if (field.state.status === 'provided' && field.state.value.type === 'currency') fixtureCurrencies.add(field.state.value.code)
      }
    }
    expect([...fixtureCurrencies].sort()).toEqual(['EUR', 'GBP', 'INR', 'USD'])
    for (const face of theme.faces.filter((f) => f.role === 'money')) {
      for (const { snapshot } of documents) {
        for (const code of fixtureCurrencies) {
          const sample = formatMoney(money(-123456, code), snapshot.locale)
          expect(missingCharacters(sample, covered(face)), `${face.file} ${code} ${snapshot.locale}`).toEqual([])
        }
      }
      expect(covered(face).has(0x20b9), `${face.file} has ₹`).toBe(true)
    }
  })

  // Known gap, recorded rather than patched: Japanese-locale yen uses the
  // full-width sign, which no placeholder face has. No fixture uses it; a
  // document that did would be refused for that face, not drawn with a box or
  // a silently swapped character.
  it('reports the full-width yen sign as missing rather than substituting it', () => {
    const { theme } = resolveTheme(undefined)
    const mono = faceFor(theme, 'money', 400)!
    expect(CURRENCIES.JPY.minorDigits).toBe(0)
    expect(missingCharacters(formatMoney(money(1200, 'JPY'), 'ja-JP'), covered(mono))).toEqual(['￥'])
    expect(missingCharacters(formatMoney(money(1200, 'JPY'), 'en-US'), covered(mono))).toEqual([])
  })
})
