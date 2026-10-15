// ── Tokens → CSS custom properties ────────────────────────────────────────────
// The only place token values become CSS. Primitives reference these variables
// by name (dsVar) and never carry a value of their own, so changing the token
// JSON restyles everything inside a ThemeScope.

import type { DesignTokens, ShadowLayer, TextStyle, TokenGroup } from './tokens'
import { TOKEN_GROUPS } from './tokens'

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'])

export function fontStackCss(stack: string[]): string {
  return stack.map((name) => (GENERIC.has(name) ? name : `"${name}"`)).join(', ')
}

export function shadowCss(layers: ShadowLayer[]): string {
  if (layers.length === 0) return 'none'
  return layers.map((l) => `${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${l.color}`).join(', ')
}

type TextPart = 'family' | 'size' | 'line-height' | 'weight' | 'letter-spacing'

function textStyleCss(style: TextStyle, fonts: DesignTokens['font']): Record<TextPart, string> {
  return {
    family: fontStackCss(fonts[style.font]),
    size: `${style.size}px`,
    'line-height': String(style.lineHeight),
    weight: String(style.weight),
    'letter-spacing': `${style.letterSpacing}em`,
  }
}

export type CssVarName = `--ds-${string}`

/** Every variable a token set defines, name → CSS value. */
export function tokensToCssVars(tokens: DesignTokens): Record<CssVarName, string> {
  const vars: Record<CssVarName, string> = {}
  for (const group of Object.keys(TOKEN_GROUPS) as TokenGroup[]) {
    for (const [key, value] of Object.entries(tokens[group] as Record<string, unknown>)) {
      const base = `--ds-${group}-${kebab(key)}` as CssVarName
      switch (group) {
        case 'color':
          vars[base] = value as string
          break
        case 'font':
          vars[base] = fontStackCss(value as string[])
          break
        case 'type':
          for (const [part, css] of Object.entries(textStyleCss(value as TextStyle, tokens.font))) {
            vars[`${base}-${part}` as CssVarName] = css
          }
          break
        case 'shadow':
          vars[base] = shadowCss(value as ShadowLayer[])
          break
        case 'space':
        case 'radius':
        case 'size':
          vars[base] = `${value as number}px`
          break
      }
    }
  }
  return vars
}

// ── Typed references for primitives ──────────────────────────────────────────

type Groups = typeof TOKEN_GROUPS
type SimpleRef =
  | `color-${KebabKeys<'color'>}`
  | `font-${KebabKeys<'font'>}`
  | `space-${KebabKeys<'space'>}`
  | `radius-${KebabKeys<'radius'>}`
  | `shadow-${KebabKeys<'shadow'>}`
  | `size-${KebabKeys<'size'>}`
  | `type-${KebabKeys<'type'>}-${TextPart}`
type Kebab<S extends string> = S extends `${infer H}${infer T}` ? `${H extends Uppercase<H> ? (H extends Lowercase<H> ? H : `-${Lowercase<H>}`) : H}${Kebab<T>}` : S
type KebabKeys<G extends keyof Groups> = Kebab<keyof Groups[G] & string>

/** `var(--ds-…)` with no fallback: a missing token must show up, not be papered over. */
export const dsVar = (ref: SimpleRef): string => `var(--ds-${ref})`

export type TextVariant = keyof Groups['type']

/** The five declarations that set a text style from its tokens. */
export function textStyleVars(variant: TextVariant) {
  const v = kebab(variant) as KebabKeys<'type'>
  return {
    fontFamily: dsVar(`type-${v}-family`),
    fontSize: dsVar(`type-${v}-size`),
    lineHeight: dsVar(`type-${v}-line-height`),
    fontWeight: dsVar(`type-${v}-weight`),
    letterSpacing: dsVar(`type-${v}-letter-spacing`),
  } as const
}
