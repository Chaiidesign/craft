// Test helper: finds every style value in rendered markup or a stylesheet that
// didn't come from a token. Used by the tokens-only and reskin tests.

/** Values that describe structure, not design. Anything else must be a token. */
const STRUCTURAL = new Set([
  '0', '1', '100%', 'auto', 'none', 'solid', 'currentColor',
  'flex', 'inline-flex', 'row', 'column', 'wrap', 'center', 'stretch', 'flex-start', 'flex-end',
  'pointer', 'not-allowed', 'nowrap', 'hidden', 'ellipsis', 'uppercase', 'border-box', 'round',
  'non-scaling-stroke',
])

const VAR_REF = /^var\((--ds-[a-z0-9-]+)\)$/

export interface Declaration {
  property: string
  value: string
}

export interface Violation extends Declaration {
  reason: string
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function parseDeclarations(css: string): Declaration[] {
  return css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':')
      return { property: d.slice(0, i).trim(), value: d.slice(i + 1).trim() }
    })
}

/** Inline style declarations from every `style="…"` attribute in the markup. */
export function inlineDeclarations(markup: string): Declaration[] {
  return [...markup.matchAll(/\sstyle="([^"]*)"/g)].flatMap((m) => parseDeclarations(decode(m[1])))
}

/** Declarations inside every rule block of a stylesheet. */
export function stylesheetDeclarations(css: string): Declaration[] {
  return [...css.matchAll(/\{([^}]*)\}/g)].flatMap((m) => parseDeclarations(m[1]))
}

/** Presentation attributes (fill, stroke, width…) on elements, as declarations. */
export function presentationAttributes(markup: string): Declaration[] {
  return [...markup.matchAll(/\s(fill|stroke|stroke-width|width|height|color|bgcolor)="([^"]*)"/g)].map((m) => ({
    property: `@${m[1]}`,
    value: m[2],
  }))
}

/** Splits on spaces outside parentheses: "0 var(--ds-a)" → ["0", "var(--ds-a)"]. */
function parts(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ' ' && depth === 0) {
      if (current) out.push(current)
      current = ''
    } else current += ch
  }
  if (current) out.push(current)
  return out
}

/**
 * Every declaration that isn't a token. `defined` is the set of variables the
 * token scope defines: a reference to anything else is a violation too, since
 * it would silently resolve to nothing.
 */
export function findViolations(declarations: Declaration[], defined: Record<string, string>): Violation[] {
  const violations: Violation[] = []
  for (const d of declarations) {
    if (d.property.startsWith('--ds-')) {
      if (defined[d.property] !== d.value) violations.push({ ...d, reason: 'variable value differs from the token set' })
      continue
    }
    for (const part of parts(d.value)) {
      const ref = VAR_REF.exec(part)
      if (ref) {
        if (!(ref[1] in defined)) violations.push({ ...d, reason: `references undefined ${ref[1]}` })
      } else if (part.startsWith('var(')) {
        violations.push({ ...d, reason: 'var() with a fallback or a non-token variable' })
      } else if (!STRUCTURAL.has(part)) {
        violations.push({ ...d, reason: `literal "${part}" is not a token` })
      }
    }
  }
  return violations
}

/** The `--ds-*` names referenced anywhere in some CSS or markup. */
export function referencedVars(text: string): Set<string> {
  return new Set([...decode(text).matchAll(/var\((--ds-[a-z0-9-]+)\)/g)].map((m) => m[1]))
}
