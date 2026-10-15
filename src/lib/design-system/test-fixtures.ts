// Token sets for tests only (reads files with node:fs). Never import from app code.

import { readFileSync } from 'node:fs'
import { runExtraction } from './extractor'
import { createMockExtractor, SAMPLE_IMAGES } from './mock-extractor'
import { nestTokens, parseDesignTokens, TOKEN_PATHS, type DesignTokens, type TokenPath } from './tokens'

/** Every value unique and recognizable, so a rendered value can be traced to
 *  exactly one token, and anything else stands out as hardcoded. */
export const SENTINEL_TOKENS: DesignTokens = {
  color: {
    background: '#010101', surface: '#020202', text: '#030303', textMuted: '#040404',
    primary: '#050505', onPrimary: '#060606', border: '#070707', focus: '#080808',
  },
  font: { body: ['Sentinel Body', 'serif'], heading: ['Sentinel Heading', 'monospace'] },
  type: {
    caption: { font: 'body', size: 11, lineHeight: 1.11, weight: 100, letterSpacing: 0.011 },
    label: { font: 'heading', size: 12, lineHeight: 1.12, weight: 200, letterSpacing: 0.012 },
    body: { font: 'body', size: 13, lineHeight: 1.13, weight: 300, letterSpacing: 0.013 },
    title: { font: 'heading', size: 14, lineHeight: 1.14, weight: 400, letterSpacing: 0.014 },
  },
  space: { xs: 21, sm: 22, md: 23, lg: 24, xl: 25 },
  radius: { sm: 31, md: 32, lg: 33, pill: 34 },
  shadow: {
    card: [{ x: 1, y: 2, blur: 3, spread: 4, color: '#0A0A0A0A' }],
    raised: [{ x: 5, y: 6, blur: 7, spread: 8, color: '#0B0B0B0B' }],
  },
  size: { icon: 41, control: 42, border: 4, focusRing: 5 },
}

/** A sample's canned reading with every proposed value accepted as is, plus
 *  `fills`: the values a person would supply in review. Throws if a token is
 *  still missing or the result breaks a rule. */
export async function acceptedSampleTokens(id: string, fills: Partial<Record<TokenPath, unknown>> = {}): Promise<DesignTokens> {
  const sample = SAMPLE_IMAGES.find((s) => s.id === id)
  if (!sample) throw new Error(`No sample ${id}`)
  const result = await runExtraction(createMockExtractor(), {
    name: `${id}.svg`,
    type: 'image/svg+xml',
    bytes: new Uint8Array(readFileSync(sample.file)),
  })
  if (!result.ok) throw new Error(result.error.message)
  const values = Object.fromEntries(TOKEN_PATHS.map((p) => [p, p in fills ? fills[p] : result.proposal.tokens[p].value])) as Record<TokenPath, unknown>
  const parsed = parseDesignTokens(nestTokens(values))
  if (!parsed.ok) throw new Error(`${id}: ${parsed.issues.join('; ')}`)
  return parsed.value
}
