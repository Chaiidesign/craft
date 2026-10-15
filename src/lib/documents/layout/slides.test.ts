import { describe, expect, it } from 'vitest'

import { deriveDeck } from '../deck'
import { run } from '../fixtures/builders'
import { evidenceBrief } from '../fixtures/brief'
import type { Block } from '../model'
import { nodeFontSet } from '../testing/nodeFonts'
import { SLIDE_FLOORS, SLIDE_INLINE, SLIDE_TYPE, type TextStyle } from '../tokens'
import { lineText } from './inspect'
import { layoutDeck, SLIDE_GEOMETRY, type SlideLayout } from './slides'

const fonts = nodeFontSet()
const SOURCE = { outputId: 'out-brief-evidence', revisionId: 'rev-brief-evidence-001' }

function allLines(slide: SlideLayout) {
  return [
    ...(slide.title ?? []), ...(slide.heading ?? []),
    ...slide.items.flatMap((i) => (i.kind === 'text' ? [...(i.label ?? []), ...i.lines] : i.kind === 'heading' ? i.lines : [...i.title, ...i.axes, ...i.summary])),
    slide.footer.left, slide.footer.right,
  ]
}
const deckText = (slides: SlideLayout[]) => slides.flatMap(allLines).map(lineText).join(' ').replace(/ /g, ' ')

function laidOut(brief = evidenceBrief()) {
  const derived = deriveDeck(brief, SOURCE)
  const layout = layoutDeck(derived.snapshot, fonts)
  if (layout.status !== 'ok') throw new Error(layout.error.message)
  return { derived, slides: layout.slides }
}

describe('brief → deck', () => {
  it('records the exact source it was derived from (verified against revisions in revisions.test.ts)', () => {
    const { derived } = laidOut()
    expect(derived.derivedFrom).toEqual(SOURCE)
    expect(derived.snapshot.kind).toBe('deck')
    expect(derived.snapshot.layoutPreset).toBe('slide-16x9')
  })

  it('keeps every recipient block, leaves the internal note out, and summarises nothing', () => {
    const brief = evidenceBrief()
    const { derived } = laidOut(brief)
    expect(derived.excludedBlocks.map((b) => b.blockId)).toEqual(['blk-internal'])
    expect(derived.snapshot.blocks.map((b) => b.id)).toEqual(brief.blocks.filter((b) => b.id !== 'blk-internal').map((b) => b.id))
    expect(derived.snapshot.slides.every((s) => !s.summaryOf)).toBe(true)
    const planned = new Set(derived.snapshot.slides.flatMap((s) => s.blockIds))
    for (const b of derived.snapshot.blocks) expect(planned.has(b.id), b.id).toBe(true)
  })

  it('carries mandatory facts and every citation onto the slides', () => {
    const text = deckText(laidOut().slides)
    for (const fact of ['61%', '8 of 112', '15 of 109', 'week 3 (21%)', '10% hold-out']) expect(text).toContain(fact)
    for (const n of [1, 2, 3, 4]) expect(text).toMatch(new RegExp(`\\[(\\d, )*${n}(, \\d)*\\]`))
    expect(text).toContain('(sample source)')
    expect(text).not.toContain('Internal: check with Lantern')
  })

  it('never sets text below the floors and every slide fits its safe area', () => {
    const { slides } = laidOut()
    const floorFor = (s: TextStyle) => (s === SLIDE_TYPE.caption || s === SLIDE_INLINE.citation ? SLIDE_FLOORS.captionPt : SLIDE_FLOORS.bodyPt)
    for (const slide of slides) {
      for (const line of allLines(slide)) for (const seg of line.segments) expect(seg.style.sizePt, lineText(line)).toBeGreaterThanOrEqual(floorFor(seg.style))
      for (const item of slide.items) {
        expect(item.y + item.height, `slide ${slide.number}`).toBeLessThanOrEqual(SLIDE_GEOMETRY.contentBottom - SLIDE_GEOMETRY.safe + 1e-6)
        if (item.kind === 'text') for (const l of item.lines) expect(l.width).toBeLessThanOrEqual(SLIDE_GEOMETRY.width - item.indent + 1e-6)
      }
    }
    // Body copy that is not a caption or source entry is at least 18pt.
    for (const slide of slides) for (const item of slide.items) if (item.kind === 'text' && slide.layout !== 'closing' && slide.layout !== 'title') expect(item.style.sizePt).toBeGreaterThanOrEqual(18)
  })

  it('gives the chart its own slide with units and the data summary', () => {
    const { slides } = laidOut()
    const chart = slides.find((s) => s.layout === 'chart')!
    const text = deckText([chart])
    expect(text).toContain('Unit: % of all cancellations')
    expect(text).toContain('Cancellations peak in week 3 (21%)')
  })

  it('splits dense sections across slides by item, repeating the heading', () => {
    const brief = evidenceBrief()
    const dense: Block = { id: 'blk-dense', type: 'list', ordered: false, items: Array.from({ length: 14 }, (_, i) => [run(`Point ${i + 1}: members who receive a personal note in week two are asked how the first book landed and what they would like next.`)]) }
    const at = brief.blocks.findIndex((b) => b.id === 'blk-goals')
    const { slides } = laidOut({ ...brief, blocks: [...brief.blocks.slice(0, at + 1), dense, ...brief.blocks.slice(at + 1)] })
    const goals = slides.filter((s) => s.planIds.some((id) => id.startsWith('slide-blk-goals-h')))
    expect(goals.length).toBeGreaterThan(1)
    expect(goals.slice(1).every((s) => s.continued && lineText(s.heading![0]).endsWith('(continued)'))).toBe(true)
    const text = deckText(goals)
    for (let i = 1; i <= 14; i++) expect(text).toContain(`Point ${i}:`)
  })

  it('marks every repeat of a section heading "(continued)", including a deliberate split around the chart', () => {
    const { slides } = laidOut()
    const headingsOf = (s: (typeof slides)[number]) => [...(s.heading ? [s.heading] : []), ...s.items.filter((i) => i.kind === 'heading').map((i) => i.lines)].map((ls) => ls.map(lineText).join(' '))
    const evidenceHeadings = slides.flatMap((s) => headingsOf(s).filter((t) => t.startsWith('Evidence:')).map((t) => ({ slide: s.number, t })))
    expect(evidenceHeadings.length).toBe(3)
    expect(evidenceHeadings[0].t.endsWith('(continued)')).toBe(false)
    for (const h of evidenceHeadings.slice(1)) expect(h.t.endsWith('(continued)'), `slide ${h.slide}`).toBe(true)
    // No other heading is marked: each other section appears once.
    const others = slides.flatMap(headingsOf).filter((t) => !t.startsWith('Evidence:'))
    expect(others.some((t) => t.endsWith('(continued)'))).toBe(false)
  })

  it('lets at most two short consecutive sections share a slide, each with its own heading', () => {
    const { slides, derived } = laidOut()
    const shared = slides.filter((s) => s.planIds.length > 1)
    expect(shared.length).toBeGreaterThan(0)
    for (const s of slides) {
      expect(s.planIds.length).toBeLessThanOrEqual(2)
      const headings = (s.heading ? 1 : 0) + s.items.filter((i) => i.kind === 'heading').length
      expect(headings, `slide ${s.number}`).toBe(s.layout === 'title' ? 0 : s.planIds.length)
      for (const item of s.items) expect(item.y + item.height).toBeLessThanOrEqual(SLIDE_GEOMETRY.contentBottom - SLIDE_GEOMETRY.safe + 1e-6)
    }
    // Every section heading still appears exactly once (continuations aside).
    const headingTexts = slides.flatMap((s) => [...(s.heading ? [s.heading] : []), ...s.items.filter((i) => i.kind === 'heading').map((i) => i.lines)]).map((ls) => ls.map(lineText).join(' '))
    for (const b of derived.snapshot.blocks) if (b.type === 'heading') expect(headingTexts.filter((t) => t === b.text).length, b.text).toBeGreaterThanOrEqual(1)
    // Only content slides share, and a section that overflowed onto several slides never does.
    const slidesPerPlan = new Map<string, number>()
    for (const s of slides) for (const id of s.planIds) slidesPerPlan.set(id, (slidesPerPlan.get(id) ?? 0) + 1)
    for (const s of shared) {
      expect(s.layout).toBe('content')
      for (const id of s.planIds) expect(slidesPerPlan.get(id), id).toBe(1)
    }
  })

  it('does not combine sections that would not fit together', () => {
    const brief = evidenceBrief()
    const big: Block = { id: 'blk-big', type: 'list', ordered: false, items: Array.from({ length: 6 }, (_, i) => [run(`Item ${i + 1}: a longer point that takes most of a line or two at body size on the slide.`)]) }
    const at = brief.blocks.findIndex((b) => b.id === 'blk-goals')
    const { slides } = laidOut({ ...brief, blocks: [...brief.blocks.slice(0, at + 1), big, ...brief.blocks.slice(at + 1)] })
    const goals = slides.find((s) => s.planIds.includes('slide-blk-goals-h-0'))!
    // With the short brief, Goals shares a slide; with six long items it is too full to share.
    expect(laidOut().slides.find((s) => s.planIds.includes('slide-blk-goals-h-0'))!.planIds.length).toBe(2)
    expect(goals.planIds).toEqual(['slide-blk-goals-h-0'])
    for (const item of goals.items) expect(item.y + item.height).toBeLessThanOrEqual(SLIDE_GEOMETRY.contentBottom - SLIDE_GEOMETRY.safe + 1e-6)
  })

  it('splits a paragraph too long for one slide by sentence, and errors only when one sentence cannot fit', () => {
    const brief = evidenceBrief()
    const long: Block = { id: 'blk-long', type: 'paragraph', runs: [run(Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} explains one specific observation from the member interviews in plain terms.`).join(' '))] }
    const at = brief.blocks.findIndex((b) => b.id === 'blk-goals')
    const { slides } = laidOut({ ...brief, blocks: [...brief.blocks.slice(0, at + 1), long, ...brief.blocks.slice(at + 1)] })
    expect(slides.filter((s) => s.blockIds.includes('blk-long')).length).toBeGreaterThan(1)

    const impossible: Block = { id: 'blk-impossible', type: 'paragraph', runs: [run(Array.from({ length: 220 }, (_, i) => `word${i}`).join(' '))] }
    const derived = deriveDeck({ ...brief, blocks: [...brief.blocks.slice(0, at + 1), impossible] }, SOURCE)
    const result = layoutDeck(derived.snapshot, fonts)
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error.kind).toBe('too-tall')
      expect(result.error.message).toMatch(/instead of shrinking/)
    }
  })
})
