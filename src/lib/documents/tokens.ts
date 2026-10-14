// Document design tokens. Every typographic, spacing and geometry value that a
// document surface uses lives here; the HTML preview (via CSS variables), PDF,
// DOCX and PPTX renderers all read these. Font families come from theme.ts —
// tokens refer to roles, never to family names.
//
// Units are points (1pt = 1/72in) so print, preview and exports share one scale.
// These are prototype defaults to test, not claims about existing Souvenir output.

import { resolveTheme, type DocumentTheme, type FontRole, type FontStyle, type FontWeight } from './theme'

export type TextStyle = {
  role: FontRole
  weight: FontWeight
  style: FontStyle
  sizePt: number
  /** Unitless multiplier. */
  lineHeight: number
  /** em; 0 except title, labels/captions and the draft marker. */
  letterSpacingEm: number
  uppercase?: boolean
  /** Tabular (fixed-width) figures. The Money role is monospaced, so this always holds there. */
  tabular?: boolean
}

const style = (s: Omit<TextStyle, 'style' | 'letterSpacingEm'> & Partial<Pick<TextStyle, 'style' | 'letterSpacingEm'>>): TextStyle => ({
  style: 'normal',
  letterSpacingEm: 0,
  ...s,
})

// ── Print type scale ─────────────────────────────────────────────────────────

export const PRINT_TYPE = {
  /** Document title. Display, condensed cut. */
  title: style({ role: 'display', weight: 600, sizePt: 28, lineHeight: 1.15, letterSpacingEm: -0.01 }),
  /** Issuer name in the letterhead. */
  issuerName: style({ role: 'display', weight: 600, sizePt: 18, lineHeight: 1.2 }),
  sectionHeading: style({ role: 'voice', weight: 600, sizePt: 13, lineHeight: 1.3 }),
  body: style({ role: 'voice', weight: 400, sizePt: 10.5, lineHeight: 1.5 }),
  /** Inline emphasis inside body: the true italic cut, never a synthetic slant. */
  emphasis: style({ role: 'voice', weight: 400, style: 'italic', sizePt: 10.5, lineHeight: 1.5 }),
  pullQuote: style({ role: 'voice', weight: 400, style: 'italic', sizePt: 14, lineHeight: 1.45 }),
  /** Table rows are unified at 9.5pt: Function for text, Money for numerals. */
  tableHeader: style({ role: 'function', weight: 500, sizePt: 9.5, lineHeight: 1.35 }),
  tableText: style({ role: 'function', weight: 400, sizePt: 9.5, lineHeight: 1.35 }),
  amount: style({ role: 'money', weight: 400, sizePt: 9.5, lineHeight: 1.35, tabular: true }),
  /** Invoice number and reference IDs. */
  reference: style({ role: 'money', weight: 400, sizePt: 9.5, lineHeight: 1.35, tabular: true }),
  grandTotal: style({ role: 'money', weight: 500, sizePt: 12, lineHeight: 1.3, tabular: true }),
  /** Labels, captions and dates. */
  label: style({ role: 'function', weight: 400, sizePt: 8.5, lineHeight: 1.4, letterSpacingEm: 0.02 }),
  /** Field values in key/value groups (party names, addresses, terms). */
  fieldValue: style({ role: 'function', weight: 400, sizePt: 9.5, lineHeight: 1.4 }),
  citation: style({ role: 'function', weight: 400, sizePt: 8, lineHeight: 1.4 }),
  footer: style({ role: 'function', weight: 400, sizePt: 8, lineHeight: 1.4 }),
  draftMarker: style({ role: 'function', weight: 500, sizePt: 8.5, lineHeight: 1.4, letterSpacingEm: 0.08, uppercase: true }),
} as const satisfies Record<string, TextStyle>

export type PrintTypeKey = keyof typeof PRINT_TYPE

// ── Slide type scale ─────────────────────────────────────────────────────────

export const SLIDE_TYPE = {
  title: style({ role: 'display', weight: 600, sizePt: 32, lineHeight: 1.1 }),
  heading: style({ role: 'display', weight: 600, sizePt: 24, lineHeight: 1.2 }),
  body: style({ role: 'voice', weight: 400, sizePt: 18, lineHeight: 1.4 }),
  caption: style({ role: 'function', weight: 400, sizePt: 12, lineHeight: 1.35 }),
} as const satisfies Record<string, TextStyle>

/** Readability floors. Dense slides split; text never shrinks below these to fit. */
export const SLIDE_FLOORS = {
  /** Body content. */
  bodyPt: 18,
  /** Captions, citations and chart data summaries. */
  captionPt: 12,
} as const

// ── Spacing (pt) ─────────────────────────────────────────────────────────────

export const SPACE = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  section: 32,
} as const

export type SpaceKey = keyof typeof SPACE

// ── Page geometry (pt) ───────────────────────────────────────────────────────

export const PAGE_SIZES = {
  'a4-portrait': { widthPt: 595.28, heightPt: 841.89 },
  'letter-portrait': { widthPt: 612, heightPt: 792 },
} as const

export const PAGE = {
  /** 18mm all round — comfortable for office printers' unprintable edge. */
  marginPt: { top: 51, right: 51, bottom: 51, left: 51 },
  /** Space reserved above the bottom margin for the footer row. */
  footerClearancePt: 24,
  /** Continuation-page running header (document identification). */
  headerClearancePt: 20,
} as const

/** Width between the side margins. Slide presets have their own geometry (SLIDE). */
export function contentWidthPt(preset: string): number {
  const size = PAGE_SIZES[preset as keyof typeof PAGE_SIZES] ?? PAGE_SIZES['a4-portrait']
  return size.widthPt - PAGE.marginPt.left - PAGE.marginPt.right
}

// ── Charts (pt) ──────────────────────────────────────────────────────────────

export const CHART = {
  plotHeightPt: 128,
  /** Room under the plot for category labels, and above the tallest bar for its value. */
  axisLabelBandPt: 21,
  valueLabelBandPt: 16,
  valueLabelGapPt: 4,
  /** Bar width as a share of its category band. */
  barShare: 0.64,
  axisStrokePt: 0.75,
} as const

// ── Tables ───────────────────────────────────────────────────────────────────

export const TABLE = {
  cellPaddingXPt: 6,
  cellPaddingYPt: 4,
  ruleWidthPt: 0.5,
  headerRuleWidthPt: 1,
  totalsRuleWidthPt: 1,
} as const

// ── Brand / letterhead ───────────────────────────────────────────────────────

export const BRAND = {
  logoMaxHeightPt: 40,
  logoMaxWidthPt: 140,
  /** Width of the accent rule under the letterhead. */
  accentRulePt: 2,
} as const

/** Document colours that are not issuer palette: missing-field and draft states. */
export const STATE_COLOURS = {
  paper: '#FFFFFF',
  missingInk: '#8A5A00',
  missingFill: '#FFF6DB',
  missingRule: '#E3C46A',
  unknownInk: '#9B2C1F',
  internalFill: '#F2F0EC',
} as const

// ── Slide geometry (pt) ──────────────────────────────────────────────────────

export const SLIDE = {
  /** 13.333in × 7.5in, PowerPoint's 16:9 default. */
  widthPt: 960,
  heightPt: 540,
  safeAreaPt: 48,
} as const

// ── Resolution helpers ───────────────────────────────────────────────────────

export type ResolvedTextStyle = TextStyle & { family: string; generic: string }

export function resolveTextStyle(theme: DocumentTheme, s: TextStyle): ResolvedTextStyle {
  const role = theme.roles[s.role]
  return { ...s, family: role.family, generic: role.generic }
}

/** CSS font-family value: themed family first, then the recorded generic fallback. */
export function cssFontStack(theme: DocumentTheme, roleName: FontRole): string {
  const role = theme.roles[roleName]
  return `"${role.family}", ${role.generic}`
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * Every token as a CSS custom property, for the HTML preview. The preview CSS
 * reads only these variables — it carries no literal font sizes or families.
 */
export function documentCssVariables(themeId: string | undefined): Record<string, string> {
  const { theme } = resolveTheme(themeId)
  const vars: Record<string, string> = {}
  for (const role of Object.keys(theme.roles) as FontRole[]) vars[`--doc-font-${role}`] = cssFontStack(theme, role)
  const addType = (prefix: string, scale: Record<string, TextStyle>) => {
    for (const [key, s] of Object.entries(scale)) {
      const p = `--doc-${prefix}-${kebab(key)}`
      vars[`${p}-family`] = `var(--doc-font-${s.role})`
      vars[`${p}-weight`] = String(s.weight)
      vars[`${p}-style`] = s.style
      vars[`${p}-size`] = `${s.sizePt}pt`
      vars[`${p}-leading`] = String(s.lineHeight)
      vars[`${p}-tracking`] = `${s.letterSpacingEm}em`
      vars[`${p}-case`] = s.uppercase ? 'uppercase' : 'none'
    }
  }
  addType('type', PRINT_TYPE)
  addType('slide', SLIDE_TYPE)
  for (const [key, v] of Object.entries(SPACE)) vars[`--doc-space-${key}`] = `${v}pt`
  vars['--doc-margin-top'] = `${PAGE.marginPt.top}pt`
  vars['--doc-margin-right'] = `${PAGE.marginPt.right}pt`
  vars['--doc-margin-bottom'] = `${PAGE.marginPt.bottom}pt`
  vars['--doc-margin-left'] = `${PAGE.marginPt.left}pt`
  vars['--doc-footer-clearance'] = `${PAGE.footerClearancePt}pt`
  vars['--doc-cell-px'] = `${TABLE.cellPaddingXPt}pt`
  vars['--doc-cell-py'] = `${TABLE.cellPaddingYPt}pt`
  vars['--doc-rule'] = `${TABLE.ruleWidthPt}pt`
  vars['--doc-rule-strong'] = `${TABLE.headerRuleWidthPt}pt`
  vars['--doc-logo-max-h'] = `${BRAND.logoMaxHeightPt}pt`
  vars['--doc-logo-max-w'] = `${BRAND.logoMaxWidthPt}pt`
  vars['--doc-accent-rule'] = `${BRAND.accentRulePt}pt`
  for (const [key, v] of Object.entries(STATE_COLOURS)) vars[`--doc-${kebab(key)}`] = v
  return vars
}

/** Page size in CSS units for the preview. */
export function pageCss(preset: keyof typeof PAGE_SIZES): { width: string; minHeight: string } {
  const { widthPt, heightPt } = PAGE_SIZES[preset]
  return { width: `${widthPt}pt`, minHeight: `${heightPt}pt` }
}
