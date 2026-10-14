import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { faceFor, resolveTheme } from './theme'
import { documentCssVariables, PAGE_SIZES, PRINT_TYPE, SLIDE_FLOORS, SLIDE_TYPE, SPACE, type TextStyle } from './tokens'

// The approved typography spec, value by value: [role, weight, style, size pt, line height, tracking em, uppercase].
type Spec = [TextStyle['role'], TextStyle['weight'], TextStyle['style'], number, number, number, boolean?]
const PRINT_SPEC: Record<keyof typeof PRINT_TYPE, Spec> = {
  title: ['display', 600, 'normal', 28, 1.15, -0.01],
  issuerName: ['display', 600, 'normal', 18, 1.2, 0],
  sectionHeading: ['voice', 600, 'normal', 13, 1.3, 0],
  body: ['voice', 400, 'normal', 10.5, 1.5, 0],
  emphasis: ['voice', 400, 'italic', 10.5, 1.5, 0],
  pullQuote: ['voice', 400, 'italic', 14, 1.45, 0],
  tableHeader: ['function', 500, 'normal', 9.5, 1.35, 0],
  tableText: ['function', 400, 'normal', 9.5, 1.35, 0],
  amount: ['money', 400, 'normal', 9.5, 1.35, 0],
  reference: ['money', 400, 'normal', 9.5, 1.35, 0],
  grandTotal: ['money', 500, 'normal', 12, 1.3, 0],
  label: ['function', 400, 'normal', 8.5, 1.4, 0.02],
  fieldValue: ['function', 400, 'normal', 9.5, 1.4, 0],
  citation: ['function', 400, 'normal', 8, 1.4, 0],
  footer: ['function', 400, 'normal', 8, 1.4, 0],
  draftMarker: ['function', 500, 'normal', 8.5, 1.4, 0.08, true],
}
const SLIDE_SPEC: Record<keyof typeof SLIDE_TYPE, Spec> = {
  title: ['display', 600, 'normal', 32, 1.1, 0],
  heading: ['display', 600, 'normal', 24, 1.2, 0],
  body: ['voice', 400, 'normal', 18, 1.4, 0],
  caption: ['function', 400, 'normal', 12, 1.35, 0],
}

function asSpec(s: TextStyle): Spec {
  const spec: Spec = [s.role, s.weight, s.style, s.sizePt, s.lineHeight, s.letterSpacingEm]
  if (s.uppercase) spec.push(true)
  return spec
}

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('document tokens', () => {
  it('expose exactly the approved print and slide scales', () => {
    expect(Object.fromEntries(Object.entries(PRINT_TYPE).map(([k, v]) => [k, asSpec(v)]))).toEqual(PRINT_SPEC)
    expect(Object.fromEntries(Object.entries(SLIDE_TYPE).map(([k, v]) => [k, asSpec(v)]))).toEqual(SLIDE_SPEC)
    expect(SLIDE_FLOORS).toEqual({ bodyPt: 18, captionPt: 12 })
  })

  it('money, IDs and references use the Money role with tabular figures', () => {
    for (const key of ['amount', 'reference', 'grandTotal'] as const) {
      expect(PRINT_TYPE[key].role).toBe('money')
      expect(PRINT_TYPE[key].tabular).toBe(true)
    }
  })

  it('keeps letter-spacing at 0 except the title, labels/captions and the draft marker', () => {
    const tracked = Object.entries({ ...PRINT_TYPE }).filter(([, s]) => s.letterSpacingEm !== 0).map(([k]) => k)
    expect(tracked.sort()).toEqual(['draftMarker', 'label', 'title'])
    expect(Object.values(SLIDE_TYPE).every((s) => s.letterSpacingEm === 0)).toBe(true)
  })

  it('uses only named weights: every style resolves to a committed face, so nothing is synthesised', () => {
    const { theme } = resolveTheme(undefined)
    for (const [key, s] of [...Object.entries(PRINT_TYPE), ...Object.entries(SLIDE_TYPE)]) {
      expect(faceFor(theme, s.role, s.weight, s.style), key).toBeDefined()
    }
  })

  it('respect the slide floors', () => {
    expect(SLIDE_TYPE.body.sizePt).toBeGreaterThanOrEqual(SLIDE_FLOORS.bodyPt)
    expect(SLIDE_TYPE.caption.sizePt).toBeGreaterThanOrEqual(SLIDE_FLOORS.captionPt)
  })

  it('emit a CSS variable for every type value, space step and page dimension', () => {
    const vars = documentCssVariables('placeholder')
    for (const [key, s] of Object.entries(PRINT_TYPE)) {
      const p = `--doc-type-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
      expect(vars[`${p}-size`], key).toBe(`${s.sizePt}pt`)
      expect(vars[`${p}-leading`], key).toBe(String(s.lineHeight))
      expect(vars[`${p}-tracking`], key).toBe(`${s.letterSpacingEm}em`)
      expect(vars[`${p}-weight`], key).toBe(String(s.weight))
      expect(vars[`${p}-family`], key).toBe(`var(--doc-font-${s.role})`)
    }
    for (const [key, v] of Object.entries(SPACE)) expect(vars[`--doc-space-${key}`]).toBe(`${v}pt`)
    expect(PAGE_SIZES['a4-portrait']).toEqual({ widthPt: 595.28, heightPt: 841.89 })
  })
})

describe('the HTML preview consumes tokens, not literals', () => {
  const css = read('../../components/documents/documentPreview.module.css')
  const primitives = read('../../components/documents/DocumentPrimitives.tsx')

  it('document CSS sets no literal font family, size, weight, leading or tracking', () => {
    // The trailing .emptyState rule is workbench chrome, not document output.
    const documentCss = css.slice(0, css.indexOf('.emptyState'))
    const declarations = [...documentCss.matchAll(/(font-family|font-size|font-weight|line-height|letter-spacing|font-style)\s*:\s*([^;]+);/g)]
    const literal = declarations.filter(([, , value]) => !/^var\(--doc-/.test(value.trim()))
    expect(literal.map(([d]) => d)).toEqual([])
  })

  it('primitives set typography only through the token-backed type() helper', () => {
    const typeFn = primitives.slice(primitives.indexOf('export function type('), primitives.indexOf('// ── Inline primitives'))
    const outside = primitives.replace(typeFn, '')
    expect(outside).not.toMatch(/\b(fontSize|fontFamily|fontWeight|lineHeight|letterSpacing)\s*:/)
    expect(typeFn).toMatch(/fontFamily: `var\(\$\{p\}-family\)`/)
  })
})
