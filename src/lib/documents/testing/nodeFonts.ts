// Test-only: builds a FontSet from the committed TTFs via the filesystem.
// Never imported by app code (it uses node:fs).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createFontSet, type FontSet } from '../metrics'
import { resolveTheme } from '../theme'

export function nodeFontSet(themeId?: string): FontSet {
  const { theme } = resolveTheme(themeId)
  return createFontSet(theme, new Map(theme.faces.map((f) => [f.file, new Uint8Array(readFileSync(fileURLToPath(f.url)))])))
}
