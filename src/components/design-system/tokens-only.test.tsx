import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { fontStackCss, shadowCss, tokensToCssVars } from '@/lib/design-system/css-vars'
import { acceptedSampleTokens, SENTINEL_TOKENS } from '@/lib/design-system/test-fixtures'
import { parseDesignTokens, TOKEN_FIELDS, type DesignTokens } from '@/lib/design-system/tokens'
import { PrimitiveGallery } from './PrimitiveGallery'
import { PRIMITIVE_STATE_CSS, ThemeScope } from './primitives'
import { findViolations, inlineDeclarations, presentationAttributes, referencedVars, stylesheetDeclarations } from './style-audit'

const render = (tokens: DesignTokens) =>
  renderToStaticMarkup(
    <ThemeScope tokens={tokens} label="Gallery">
      <PrimitiveGallery />
    </ThemeScope>,
  )

/** The markup with the scope's variable declarations removed: what the primitives themselves render. */
const withoutTokenValues = (markup: string) => markup.replace(/&quot;/g, "'").replace(/--ds-[a-z0-9-]+:[^;]*;/g, '')

describe('primitives render from tokens only', () => {
  const vars = tokensToCssVars(SENTINEL_TOKENS)
  const markup = render(SENTINEL_TOKENS)

  it('sentinel tokens are themselves a valid token set', () => {
    expect(parseDesignTokens(SENTINEL_TOKENS).ok).toBe(true)
  })

  it('every inline style value is a token reference or a structural keyword', () => {
    const declarations = inlineDeclarations(markup)
    expect(declarations.length).toBeGreaterThan(50)
    expect(findViolations(declarations, vars)).toEqual([])
  })

  it('the pseudo-state stylesheet uses tokens only', () => {
    const declarations = stylesheetDeclarations(PRIMITIVE_STATE_CSS)
    expect(declarations.length).toBeGreaterThan(3)
    expect(findViolations(declarations, vars)).toEqual([])
  })

  it('SVG and element presentation attributes carry no design values', () => {
    expect(findViolations(presentationAttributes(markup), vars)).toEqual([])
  })

  it('the audit catches a hardcoded value (control)', () => {
    const planted = markup.replace('style="', 'style="color:#ff0000;padding:12px;margin:var(--ds-space-md, 8px);gap:var(--ds-nope);')
    const reasons = findViolations(inlineDeclarations(planted), vars).map((v) => v.reason)
    expect(reasons).toEqual(
      expect.arrayContaining([
        'literal "#ff0000" is not a token',
        'literal "12px" is not a token',
        'var() with a fallback or a non-token variable',
        'references undefined --ds-nope',
      ]),
    )
  })

  it('every sentinel value reaches the page through its variable', () => {
    // Each color token appears exactly as a variable value, nowhere else.
    for (const color of Object.values(SENTINEL_TOKENS.color)) {
      expect(markup.split(color).length - 1, color).toBeGreaterThanOrEqual(1)
      expect(withoutTokenValues(markup)).not.toContain(color)
    }
  })

  it('every referenced variable is defined by the token set, and every token defines at least one variable', () => {
    const used = new Set([...referencedVars(markup), ...referencedVars(PRIMITIVE_STATE_CSS)])
    for (const name of used) expect(vars, name).toHaveProperty(name)
    for (const field of TOKEN_FIELDS) {
      const prefix = `--ds-${field.group}-${field.key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
      expect(Object.keys(vars).some((k) => k === prefix || k.startsWith(`${prefix}-`)), field.path).toBe(true)
    }
  })

  it('primitives use every token group (no token is decorative)', () => {
    const used = [...referencedVars(markup), ...referencedVars(PRIMITIVE_STATE_CSS)]
    for (const group of ['color', 'type', 'space', 'radius', 'shadow', 'size']) {
      expect(used.some((v) => v.startsWith(`--ds-${group}-`)), group).toBe(true)
    }
  })
})

describe('swapping tokens restyles everything', () => {
  let ledger: DesignTokens
  let bloom: DesignTokens
  beforeAll(async () => {
    ledger = await acceptedSampleTokens('ledger')
    bloom = await acceptedSampleTokens('soft-bloom')
  })

  it('two token sets render different markup', () => {
    const a = render(ledger)
    const b = render(bloom)
    expect(a).not.toEqual(b)
    expect(a).toMatchSnapshot('ledger')
    expect(b).toMatchSnapshot('soft-bloom')
  })

  it('…and the only difference is the token values: the primitives themselves are identical', () => {
    expect(withoutTokenValues(render(ledger))).toEqual(withoutTokenValues(render(bloom)))
  })

  it('editing one token changes exactly that variable', () => {
    const edited: DesignTokens = { ...ledger, color: { ...ledger.color, primary: '#123456' } }
    const before = tokensToCssVars(ledger)
    const after = tokensToCssVars(edited)
    const changed = Object.keys(after).filter((k) => after[k as keyof typeof after] !== before[k as keyof typeof before])
    expect(changed).toEqual(['--ds-color-primary'])
    expect(render(edited)).toContain('--ds-color-primary:#123456')
  })
})

describe('token → CSS formatting', () => {
  it('quotes named families and leaves generic ones bare', () => {
    expect(fontStackCss(['Helvetica Neue', 'Arial', 'sans-serif'])).toBe('"Helvetica Neue", "Arial", sans-serif')
  })
  it('writes an empty shadow stack as none', () => {
    expect(shadowCss([])).toBe('none')
    expect(shadowCss([{ x: 0, y: 1, blur: 2, spread: 0, color: '#00000014' }])).toBe('0px 1px 2px 0px #00000014')
  })
  it('a text style resolves its font role to the matching stack', () => {
    const vars = tokensToCssVars(SENTINEL_TOKENS)
    expect(vars['--ds-type-title-family']).toBe('"Sentinel Heading", monospace')
    expect(vars['--ds-type-body-family']).toBe('"Sentinel Body", serif')
    expect(vars['--ds-type-body-letter-spacing']).toBe('0.013em')
  })
})
