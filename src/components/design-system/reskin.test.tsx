import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { tokensToCssVars } from '@/lib/design-system/css-vars'
import { acceptedSampleTokens, SENTINEL_TOKENS } from '@/lib/design-system/test-fixtures'
import type { DesignTokens } from '@/lib/design-system/tokens'
import { ArtifactBlock } from './ArtifactBlock'
import { PRIMITIVE_STATE_CSS, ThemeScope } from './primitives'
import { findViolations, inlineDeclarations, presentationAttributes, stylesheetDeclarations } from './style-audit'
import { ThreadPreview } from './ThreadPreview'

const noop = () => {}

const renderBlock = (tokens: DesignTokens, props: Partial<React.ComponentProps<typeof ArtifactBlock>> = {}) =>
  renderToStaticMarkup(
    <ThemeScope tokens={tokens}>
      <ArtifactBlock title="Q3 Letter to Partners" meta="Document · Saved 2 min ago" draftVersion={2} onOpen={noop} onViewHistory={noop} {...props} />
    </ThemeScope>,
  )

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

/** The inline style of the first element whose opening tag matches, with every var() replaced by its token value. */
function resolvedStyle(markup: string, tag: RegExp, tokens: DesignTokens): Record<string, string> {
  const vars = tokensToCssVars(tokens) as Record<string, string>
  const open = markup.match(tag)
  if (!open) throw new Error(`No element matching ${tag}`)
  const style = /style="([^"]*)"/.exec(open[0])?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const decl of decode(style).split(';').filter(Boolean)) {
    const i = decl.indexOf(':')
    out[decl.slice(0, i)] = decl.slice(i + 1).replace(/var\((--ds-[a-z0-9-]+)\)/g, (_, name: string) => vars[name])
  }
  return out
}

const CARD = /<article[^>]*>/
const TITLE = /<span[^>]*>Q3 Letter to Partners/

/** What a person would see differ between two systems, per element. */
function look(tokens: DesignTokens) {
  const markup = renderBlock(tokens)
  const card = resolvedStyle(markup, CARD, tokens)
  const title = resolvedStyle(markup, TITLE, tokens)
  return {
    cardBackground: card.background,
    cardRadius: card['border-radius'],
    cardShadow: card['box-shadow'],
    cardBorder: card.border,
    titleFont: title['font-family'],
    titleColor: title.color,
  }
}

describe('the reskin: different token sets produce visibly different interfaces', () => {
  let ledger: DesignTokens
  let bloom: DesignTokens
  let night: DesignTokens
  beforeAll(async () => {
    ledger = await acceptedSampleTokens('ledger')
    bloom = await acceptedSampleTokens('soft-bloom')
    // Night Console can't be accepted as is: both shadows are missing. A person
    // reviewing it supplies "no shadow", since it's a flat design.
    night = await acceptedSampleTokens('night-console', { 'shadow.card': [], 'shadow.raised': [] })
  })

  it('Ledger and Soft Bloom differ in every property a person would notice', () => {
    const a = look(ledger)
    const b = look(bloom)
    expect(a.cardBackground).toBe('#FFFDF8')
    expect(b.cardBackground).toBe('#FFFFFF')
    expect(a.cardRadius).toBe('6px')
    expect(b.cardRadius).toBe('22px')
    expect(a.titleFont).toBe('"Helvetica Neue", "Arial", sans-serif')
    expect(b.titleFont).toBe('"Avenir Next", ui-rounded, sans-serif')
    for (const key of Object.keys(a) as (keyof typeof a)[]) expect(a[key], key).not.toEqual(b[key])
  })

  it('a flat design system renders the card with no shadow at all', () => {
    expect(look(night).cardShadow).toBe('none')
    expect(look(night).cardBackground).toBe('#161B22')
  })

  it('all three systems are pairwise distinct', () => {
    const looks = [ledger, bloom, night].map((t) => JSON.stringify(look(t)))
    expect(new Set(looks).size).toBe(3)
  })

  it('the block and its thread render from tokens only', () => {
    const vars = tokensToCssVars(SENTINEL_TOKENS)
    const markup = renderToStaticMarkup(
      <ThemeScope tokens={SENTINEL_TOKENS}>
        <ThreadPreview onOpen={noop} onViewHistory={noop} />
      </ThemeScope>,
    )
    expect(findViolations([...inlineDeclarations(markup), ...presentationAttributes(markup)], vars)).toEqual([])
    expect(findViolations(stylesheetDeclarations(PRIMITIVE_STATE_CSS), vars)).toEqual([])
  })
})

describe('ArtifactBlock keeps the original card’s content and fixes its structure', () => {
  const tokens = SENTINEL_TOKENS

  it('shows title, meta, draft badge and "See history"', () => {
    const markup = renderBlock(tokens)
    expect(markup).toContain('Q3 Letter to Partners')
    expect(markup).toContain('Document · Saved 2 min ago')
    expect(markup).toContain('Draft v2')
    expect(markup).toContain('See history')
  })

  it('never nests one button inside another', () => {
    const markup = renderBlock(tokens)
    let depth = 0
    for (const m of markup.matchAll(/<(\/?)button\b/g)) {
      depth += m[1] ? -1 : 1
      expect(depth).toBeLessThanOrEqual(1)
    }
    expect((markup.match(/<button\b/g) ?? []).length).toBe(2)
  })

  it('the article is named by its title, which is the open button when clickable', () => {
    const markup = renderBlock(tokens)
    const labelledBy = /<article[^>]*aria-labelledby="([^"]+)"/.exec(markup)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(markup).toMatch(new RegExp(`<button type="button" id="${labelledBy}" class="ds-stretched"`))
  })

  it('without onOpen the title is a heading, with no arrow and no open button', () => {
    const markup = renderBlock(tokens, { onOpen: undefined, onViewHistory: undefined })
    expect(markup).toMatch(/<h3 id="[^"]+"/)
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('M5 12h14')
  })

  it('omits the draft row and meta when not given', () => {
    const markup = renderBlock(tokens, { draftVersion: undefined, meta: undefined })
    expect(markup).not.toContain('Draft v')
    expect(markup).not.toContain('See history')
    expect(markup).not.toContain('Saved 2 min ago')
  })
})
