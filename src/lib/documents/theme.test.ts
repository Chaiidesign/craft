import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { readNames } from './glyphs'
import { faceFor, PLACEHOLDER_THEME, resolveTheme, THEMES } from './theme'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const FONTS = fileURLToPath(new URL('./fonts/', import.meta.url))

function fontBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FONTS, file)))
}

function hasTable(bytes: Uint8Array, tag: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i * 16
    if (String.fromCharCode(...bytes.subarray(rec, rec + 4)) === tag) return true
  }
  return false
}

describe('document font theme', () => {
  const faces = Object.values(THEMES).flatMap((t) => t.faces)

  it('commits every face file, unmodified static TTF, with its role’s licence beside it', () => {
    for (const theme of Object.values(THEMES)) {
      for (const face of theme.faces) {
        const bytes = fontBytes(face.file)
        // TrueType outlines (0x00010000), not CFF or a variable font.
        expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0), face.file).toBe(0x00010000)
        expect(hasTable(bytes, 'fvar'), `${face.file} must be a static instance`).toBe(false)
        expect(face.url.href.endsWith(face.file), `${face.file} URL`).toBe(true)
      }
      for (const role of Object.values(theme.roles)) {
        const licence = readFileSync(join(FONTS, role.licence), 'utf8')
        expect(licence, role.licence).toContain('SIL Open Font License, Version 1.1')
      }
    }
  })

  it('records the exact name-table strings exporters must reference', () => {
    for (const face of faces) {
      const names = readNames(fontBytes(face.file))
      expect({ family: names[1], subfamily: names[2], postscript: names[6] }, face.file).toEqual(face.nameTable)
    }
  })

  it('declares each role’s typographic family as it appears in the font', () => {
    for (const theme of Object.values(THEMES)) {
      for (const face of theme.faces) {
        const names = readNames(fontBytes(face.file))
        expect(names[16] ?? names[1], face.file).toBe(theme.roles[face.role].family)
      }
    }
  })

  it('allows embedding (OS/2 fsType 0 — installable) so PDF and DOCX can carry the faces', () => {
    for (const face of faces) {
      const bytes = fontBytes(face.file)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      let os2 = -1
      for (let i = 0; i < view.getUint16(4); i++) {
        const rec = 12 + i * 16
        if (String.fromCharCode(...bytes.subarray(rec, rec + 4)) === 'OS/2') os2 = view.getUint32(rec + 8)
      }
      expect(view.getUint16(os2 + 8), face.file).toBe(0)
      expect(view.getUint16(os2 + 4), `${face.file} weight class`).toBe(face.weight)
    }
  })

  it('commits no font file the theme does not use', () => {
    const used = new Set(faces.map((f) => f.file))
    const ttfs = readdirSync(FONTS).filter((f) => f.endsWith('.ttf'))
    expect(ttfs.sort()).toEqual([...used].sort())
  })

  it('resolves unknown theme IDs to the default and says so', () => {
    expect(resolveTheme('placeholder')).toEqual({ theme: PLACEHOLDER_THEME, fellBack: false })
    expect(resolveTheme('no-such-theme').fellBack).toBe(true)
    expect(faceFor(PLACEHOLDER_THEME, 'voice', 400, 'italic')?.style).toBe('italic')
    expect(faceFor(PLACEHOLDER_THEME, 'display', 400)).toBeUndefined()
  })
})

describe('font family names live only in theme.ts', () => {
  // Terms come from the theme itself, so this test names no family either.
  const terms = new Set<string>()
  for (const theme of Object.values(THEMES)) {
    for (const role of Object.values(theme.roles)) {
      terms.add(role.family)
      const first = role.family.split(' ')[0]
      if (first.length >= 6) terms.add(first)
    }
    for (const face of theme.faces) {
      terms.add(face.nameTable.family)
      terms.add(face.file.replace(/\.ttf$/, ''))
    }
  }

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path, out)
      else if (/\.(ts|tsx|css|js|mjs)$/.test(entry)) out.push(path)
    }
    return out
  }

  it('finds no family name anywhere else under src/', () => {
    const allowed = new Set([join(SRC, 'lib/documents/theme.ts')])
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      if (allowed.has(file) || file.startsWith(FONTS)) continue
      const text = readFileSync(file, 'utf8')
      for (const term of terms) if (text.includes(term)) offenders.push(`${relative(SRC, file)}: ${term}`)
    }
    expect(offenders).toEqual([])
    expect(existsSync(join(SRC, 'lib/documents/theme.ts'))).toBe(true)
  })
})
