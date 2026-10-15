// ── Design tokens: the schema every extracted design system must pass ─────────
// One registry (TOKEN_FIELDS) names every token, its group and its value schema.
// The proposal schema (what an extractor returns), the applied schema (what the
// primitives consume), the review UI and the CSS variables all derive from it,
// so a token can't exist in one place and be missing from another.

import { z } from 'zod'

// ── Leaf value schemas ────────────────────────────────────────────────────────

/** #RRGGBB or #RRGGBBAA. Short forms and named colors are rejected so every
 *  stored color is in one canonical shape. */
export const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Expected a hex color like #1A2B3C or #1A2B3C80')

/** A length in CSS pixels. */
const px = (max: number) => z.number().min(0).max(max)

const GENERIC_FAMILIES = [
  'serif', 'sans-serif', 'monospace', 'cursive', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
] as const

/** Letters, digits, spaces and hyphens only, so a family name can never break
 *  out of the CSS declaration it is written into. */
const familyName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, 'Font family names may only use letters, digits, spaces and hyphens')

/** An ordered font stack ending in a generic family, so text always renders in
 *  a face of the intended kind even when the named fonts aren't installed. */
export const fontStack = z
  .array(familyName)
  .min(1)
  .max(6)
  .refine((stack) => (GENERIC_FAMILIES as readonly string[]).includes(stack[stack.length - 1]), {
    message: `The last font in a stack must be a generic family (${GENERIC_FAMILIES.join(', ')})`,
  })

export const textStyle = z.strictObject({
  /** Which font stack the style uses. */
  font: z.enum(['body', 'heading']),
  /** Font size in px. */
  size: z.number().min(8).max(96),
  /** Unitless line height (multiple of size). */
  lineHeight: z.number().min(0.8).max(3),
  /** 100–900 in steps of 100. */
  weight: z.number().int().min(100).max(900).multipleOf(100),
  /** Letter spacing in em. */
  letterSpacing: z.number().min(-0.1).max(0.5),
})

const shadowLayer = z.strictObject({
  x: z.number().min(-100).max(100),
  y: z.number().min(-100).max(100),
  blur: px(200),
  spread: z.number().min(-50).max(50),
  color: hexColor,
})

/** A stack of shadow layers. An empty stack is an explicit "no shadow" (a flat
 *  design), which is different from a shadow that couldn't be read. */
export const shadow = z.array(shadowLayer).max(4)

export type TextStyle = z.infer<typeof textStyle>
export type ShadowLayer = z.infer<typeof shadowLayer>

// ── The registry ──────────────────────────────────────────────────────────────

interface FieldSpec {
  label: string
  schema: z.ZodType
}

const color = (label: string): FieldSpec => ({ label, schema: hexColor })

export const TOKEN_GROUPS = {
  color: {
    background: color('Page background'),
    surface: color('Card surface'),
    text: color('Text'),
    textMuted: color('Muted text'),
    primary: color('Primary (actions)'),
    onPrimary: color('Text on primary'),
    border: color('Border'),
    focus: color('Focus ring'),
  },
  font: {
    body: { label: 'Body font stack', schema: fontStack },
    heading: { label: 'Heading font stack', schema: fontStack },
  },
  type: {
    caption: { label: 'Caption', schema: textStyle },
    body: { label: 'Body', schema: textStyle },
    label: { label: 'Label', schema: textStyle },
    title: { label: 'Title', schema: textStyle },
  },
  space: {
    xs: { label: 'Space XS', schema: px(64) },
    sm: { label: 'Space S', schema: px(64) },
    md: { label: 'Space M', schema: px(96) },
    lg: { label: 'Space L', schema: px(128) },
    xl: { label: 'Space XL', schema: px(160) },
  },
  radius: {
    sm: { label: 'Radius S', schema: px(999) },
    md: { label: 'Radius M', schema: px(999) },
    lg: { label: 'Radius L', schema: px(999) },
    pill: { label: 'Radius pill', schema: px(999) },
  },
  shadow: {
    card: { label: 'Card shadow', schema: shadow },
    raised: { label: 'Raised shadow', schema: shadow },
  },
  size: {
    icon: { label: 'Icon size', schema: px(64) },
    control: { label: 'Control height', schema: z.number().min(24).max(96) },
  },
} as const satisfies Record<string, Record<string, FieldSpec>>

type Groups = typeof TOKEN_GROUPS
export type TokenGroup = keyof Groups
export type TokenPath = { [G in TokenGroup]: `${G}.${keyof Groups[G] & string}` }[TokenGroup]

export interface TokenField {
  path: TokenPath
  group: TokenGroup
  key: string
  label: string
  schema: z.ZodType
}

/** Every token, in display order. */
export const TOKEN_FIELDS: readonly TokenField[] = (Object.keys(TOKEN_GROUPS) as TokenGroup[]).flatMap((group) =>
  Object.entries(TOKEN_GROUPS[group] as Record<string, FieldSpec>).map(([key, spec]) => ({
    path: `${group}.${key}` as TokenPath,
    group,
    key,
    label: spec.label,
    schema: spec.schema,
  })),
)

export const TOKEN_PATHS: readonly TokenPath[] = TOKEN_FIELDS.map((f) => f.path)

const FIELD_BY_PATH = new Map(TOKEN_FIELDS.map((f) => [f.path, f]))

export function tokenField(path: TokenPath): TokenField {
  const field = FIELD_BY_PATH.get(path)
  if (!field) throw new Error(`Unknown token path: ${path}`)
  return field
}

// ── Applied tokens: complete, no gaps, cross-field rules hold ────────────────

type GroupShape<G extends TokenGroup> = { [K in keyof Groups[G]]: Groups[G][K] extends { schema: infer S } ? S : never }

function groupSchema<G extends TokenGroup>(group: G) {
  const shape = Object.fromEntries(
    Object.entries(TOKEN_GROUPS[group] as Record<string, FieldSpec>).map(([k, spec]) => [k, spec.schema]),
  ) as GroupShape<G>
  return z.strictObject(shape as unknown as z.ZodRawShape)
}

const appliedShape = Object.fromEntries((Object.keys(TOKEN_GROUPS) as TokenGroup[]).map((g) => [g, groupSchema(g)]))

export const designTokensSchema = z.strictObject(appliedShape).superRefine((value, ctx) => {
  const t = value as unknown as DesignTokens
  const space = [t.space.xs, t.space.sm, t.space.md, t.space.lg, t.space.xl]
  for (let i = 1; i < space.length; i++) {
    if (!(space[i] > space[i - 1])) {
      ctx.addIssue({ code: 'custom', path: ['space'], message: 'Spacing must grow strictly from XS to XL' })
      break
    }
  }
  const radius = [t.radius.sm, t.radius.md, t.radius.lg, t.radius.pill]
  for (let i = 1; i < radius.length; i++) {
    if (radius[i] < radius[i - 1]) {
      ctx.addIssue({ code: 'custom', path: ['radius'], message: 'Radii must not shrink from S to pill' })
      break
    }
  }
  if (!(t.type.caption.size <= t.type.body.size && t.type.body.size <= t.type.title.size)) {
    ctx.addIssue({ code: 'custom', path: ['type'], message: 'Type sizes must run caption ≤ body ≤ title' })
  }
})

export interface DesignTokens {
  color: Record<keyof Groups['color'], string>
  font: Record<keyof Groups['font'], string[]>
  type: Record<keyof Groups['type'], TextStyle>
  space: Record<keyof Groups['space'], number>
  radius: Record<keyof Groups['radius'], number>
  shadow: Record<keyof Groups['shadow'], ShadowLayer[]>
  size: Record<keyof Groups['size'], number>
}

export type TokenValues = { [P in TokenPath]: unknown }

export function readToken(tokens: DesignTokens, path: TokenPath): unknown {
  const [group, key] = path.split('.') as [TokenGroup, string]
  return (tokens[group] as Record<string, unknown>)[key]
}

/** Assembles flat path → value pairs into the nested token object (unvalidated). */
export function nestTokens(values: Record<TokenPath, unknown>): unknown {
  const out: Record<string, Record<string, unknown>> = {}
  for (const field of TOKEN_FIELDS) {
    ;(out[field.group] ??= {})[field.key] = values[field.path]
  }
  return out
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] }

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
}

export function parseDesignTokens(input: unknown): ParseResult<DesignTokens> {
  const result = designTokensSchema.safeParse(input)
  return result.success
    ? { ok: true, value: result.data as unknown as DesignTokens }
    : { ok: false, issues: formatIssues(result.error) }
}

/** Validates one token value against its own schema (used when a person edits a token). */
export function parseTokenValue(path: TokenPath, value: unknown): ParseResult<unknown> {
  const result = tokenField(path).schema.safeParse(value)
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: formatIssues(result.error) }
}
