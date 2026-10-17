// Builds docs/output-system/tokens.json from the document engine's own tokens
// (D-69). Nothing here is a new value: every number and colour is read from
// src/lib/documents/tokens.ts, theme.ts and templates/brand.ts, so the file
// cannot drift from what the engine renders. Those files are not changed.
//
// Regenerate with: npx vite-node scripts/output-system/build-tokens.ts
// A test fails if the committed tokens.json differs from this output.

import { DEFAULT_THEME_ID, resolveTheme } from '../documents/theme'
import {
  BRAND,
  CHART,
  FLOW,
  KEEP,
  PAGE,
  PAGE_SIZES,
  PRINT_TYPE,
  SLIDE,
  SLIDE_FLOORS,
  SLIDE_FLOW,
  SLIDE_INLINE,
  SLIDE_TYPE,
  SPACE,
  STATE_COLOURS,
  TABLE,
} from '../documents/tokens'
import { UNBRANDED } from '../documents/templates/brand'

export const TOKENS_FORMAT_VERSION = 1

export function buildOutputTokens() {
  const { theme } = resolveTheme(DEFAULT_THEME_ID)
  return {
    $comment:
      'Generated from src/lib/documents/tokens.ts, theme.ts and templates/brand.ts by scripts/output-system/build-tokens.ts. Do not edit by hand: change the source files (a reviewed engine change) and regenerate. Units are points (1pt = 1/72in) unless a key says otherwise.',
    version: TOKENS_FORMAT_VERSION,
    unit: 'pt',
    colour: {
      $comment:
        'The neutral default palette, used when a store has no brand set up (D-61). A store brand replaces ink, muted, rule and accent; state colours never change.',
      neutral: { ...UNBRANDED.palette },
      paper: STATE_COLOURS.paper,
      state: {
        missingInk: STATE_COLOURS.missingInk,
        missingFill: STATE_COLOURS.missingFill,
        missingRule: STATE_COLOURS.missingRule,
        unknownInk: STATE_COLOURS.unknownInk,
        internalFill: STATE_COLOURS.internalFill,
      },
    },
    font: {
      $comment: `Theme "${theme.id}". These families are SIL OFL placeholders; the final pick waits for an A/B render (docs/documents/README.md). Use roles, never family names, in guides and rules.`,
      theme: theme.id,
      placeholder: true,
      roles: Object.fromEntries(
        Object.entries(theme.roles).map(([role, r]) => [role, { family: r.family, fallback: r.generic, licence: r.licence }]),
      ),
    },
    type: { print: PRINT_TYPE, slide: SLIDE_TYPE, slideInline: SLIDE_INLINE, slideFloors: SLIDE_FLOORS },
    space: SPACE,
    page: { sizes: PAGE_SIZES, margin: PAGE.marginPt, footerClearance: PAGE.footerClearancePt, headerClearance: PAGE.headerClearancePt },
    flow: FLOW,
    keep: KEEP,
    table: TABLE,
    chart: CHART,
    logo: { maxHeight: BRAND.logoMaxHeightPt, maxWidth: BRAND.logoMaxWidthPt, accentRule: BRAND.accentRulePt },
    slide: { width: SLIDE.widthPt, height: SLIDE.heightPt, safeArea: SLIDE.safeAreaPt, flow: SLIDE_FLOW },
    notDefined: {
      $comment: 'Asked for in plan.md but not in the engine yet. Left out rather than invented (D-69).',
      items: ['radius', 'screen sizes in px for cards, charts and published pages', 'dark-mode colours'],
    },
  }
}

export function outputTokensJson(): string {
  return `${JSON.stringify(buildOutputTokens(), null, 2)}\n`
}
