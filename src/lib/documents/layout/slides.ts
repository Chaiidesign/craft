// Slide layout for derived decks: 16:9 geometry and the slide type scale.
// Each slide plan becomes one or more physical slides. Content is placed by
// measured height; when it does not fit, the slide splits — by block, then by
// list item, then by sentence — and continuation slides repeat the heading.
// Text is never set below the floors (18pt body, 12pt captions), and a unit
// that cannot fit an empty slide at those sizes is an explicit error.

import { BRIEF_FIELDS } from '../brief'
import { citationMarker, planNodeForBlock, type PlanNode, type PlanRun } from '../compose'
import { formatFieldValue } from '../display'
import { MissingGlyphError, type FontSet } from '../metrics'
import type { DeckSnapshot } from '../model'
import { SLIDE, SLIDE_FLOW, SLIDE_INLINE, SLIDE_TYPE, type TextStyle } from '../tokens'
import { LayoutTooTallError } from './blocks'
import { breakLines, measure, type Line, type Span } from './text'

const lh = (s: TextStyle) => s.sizePt * s.lineHeight

export type SlideItem =
  /** A second section's heading on a shared slide. */
  | { kind: 'heading'; y: number; height: number; lines: Line[] }
  | { kind: 'text'; y: number; height: number; lines: Line[]; style: TextStyle; indent: number; marker: string | null; label: Line[] | null; tone?: 'note' | 'warning' }
  | { kind: 'chart'; y: number; height: number; title: Line[]; plotHeight: number; node: Extract<PlanNode, { primitive: 'chart-with-data-summary' }>; axes: Line[]; summary: Line[] }

export interface SlideLayout {
  number: number
  planId: string
  /** Section plans shown on this slide (two when short consecutive sections share it). */
  planIds: string[]
  layout: 'title' | 'content' | 'chart' | 'closing'
  /** Block IDs whose content appears on this slide. */
  blockIds: string[]
  continued: boolean
  title: Line[] | null
  heading: Line[] | null
  items: SlideItem[]
  footer: { left: Line; right: Line; y: number }
}

export type DeckLayout =
  | { status: 'ok'; slides: SlideLayout[] }
  | { status: 'error'; error: { kind: 'missing-glyph' | 'too-tall'; nodeId: string; message: string } }

const SAFE = SLIDE.safeAreaPt
const W = SLIDE.widthPt - 2 * SAFE
const CAPTION_LH = lh(SLIDE_TYPE.caption)
const FOOTER_Y = SLIDE.heightPt - SAFE - CAPTION_LH
const CONTENT_BOTTOM = FOOTER_Y - SLIDE_FLOW.footerGap

function spans(runs: readonly PlanRun[], base: TextStyle): Span[] {
  const out: Span[] = []
  for (const r of runs) {
    out.push({ text: r.text, style: r.emphasis ? SLIDE_INLINE.emphasis : base })
    if (r.citations.length) out.push({ text: citationMarker(r.citations), style: SLIDE_INLINE.citation })
  }
  return out
}

/** Split runs at sentence ends; a citation stays with the sentence it supports. */
function sentences(runs: readonly PlanRun[]): PlanRun[][] {
  const out: PlanRun[][] = [[]]
  for (const r of runs) {
    const parts = r.text.split(/(?<=[.!?])\s+/)
    parts.forEach((part, i) => {
      const last = i === parts.length - 1
      out[out.length - 1].push({ text: part, emphasis: r.emphasis, citations: last ? r.citations : [] })
      if (!last) out.push([])
    })
  }
  return out.filter((s) => s.some((r) => r.text.trim()))
}

type Unit = { blockId: string; build: (width: number) => Omit<Extract<SlideItem, { kind: 'text' }>, 'y'> | Omit<Extract<SlideItem, { kind: 'chart' }>, 'y'>; gapBefore: number; splitInto?: () => Unit[] }

function textUnit(fonts: FontSet, blockId: string, runs: readonly PlanRun[], style: TextStyle, opts: { indent?: number; marker?: string | null; label?: string; tone?: 'note' | 'warning'; gapBefore?: number } = {}): Unit {
  const indent = opts.indent ?? 0
  const unit: Unit = {
    blockId,
    gapBefore: opts.gapBefore ?? SLIDE_FLOW.blockGap,
    build: () => {
      const label = opts.label ? breakLines(fonts, [{ text: opts.label, style: SLIDE_TYPE.caption }], W - indent) : null
      const lines = breakLines(fonts, spans(runs, style), W - indent)
      if (opts.marker) measure(fonts, opts.marker, style)
      return { kind: 'text', height: (label ? label.length * CAPTION_LH + SLIDE_FLOW.itemGap : 0) + lines.length * lh(style), lines, style, indent, marker: opts.marker ?? null, label, tone: opts.tone }
    },
  }
  const parts = sentences(runs)
  if (parts.length > 1) {
    unit.splitInto = () => parts.map((p, i) => textUnit(fonts, blockId, p, style, { ...opts, marker: i === 0 ? opts.marker : null, label: i === 0 ? opts.label : undefined, gapBefore: i === 0 ? opts.gapBefore : 0 }))
  }
  return unit
}

function unitsFor(fonts: FontSet, node: PlanNode): Unit[] {
  switch (node.primitive) {
    case 'summary':
      return [textUnit(fonts, node.id, node.runs, SLIDE_TYPE.body)]
    case 'paragraph':
      return [textUnit(fonts, node.id, node.runs, node.role === 'pull-quote' ? SLIDE_INLINE.emphasis : SLIDE_TYPE.body)]
    case 'list':
      return node.items.map((runs, i) => textUnit(fonts, node.id, runs, SLIDE_TYPE.body, { indent: SLIDE_FLOW.listIndent, marker: node.ordered ? `${i + 1}.` : '•', gapBefore: i === 0 ? SLIDE_FLOW.blockGap : SLIDE_FLOW.itemGap }))
    case 'callout':
      // Recipient callouts carry no label in print either; tone is shown by the rule colour.
      return [textUnit(fonts, node.id, node.runs, SLIDE_TYPE.body, { tone: node.tone })]
    case 'source-list':
      return node.entries.map((e, i) => textUnit(fonts, node.id, [{ text: e.text, emphasis: false, citations: [] }], SLIDE_TYPE.caption, { indent: SLIDE_FLOW.listIndent, marker: `${e.number}.`, gapBefore: i === 0 ? SLIDE_FLOW.blockGap : SLIDE_FLOW.itemGap }))
    case 'chart-with-data-summary':
      return [{
        blockId: node.id,
        gapBefore: SLIDE_FLOW.blockGap,
        build: () => {
          const title = breakLines(fonts, [{ text: node.title, style: SLIDE_TYPE.caption }, ...(node.citations.length ? [{ text: citationMarker(node.citations), style: SLIDE_INLINE.citation }] : [])], W)
          const axes = breakLines(fonts, [{ text: node.axesText, style: SLIDE_TYPE.caption }], W)
          const summary = breakLines(fonts, [{ text: node.dataSummary, style: SLIDE_TYPE.caption }], W)
          node.series.forEach((s) => s.points.forEach((p) => measure(fonts, p.x, SLIDE_TYPE.caption)))
          node.valueLabels.flat().forEach((v) => measure(fonts, v, SLIDE_TYPE.caption))
          const plotHeight = SLIDE_FLOW.chartPlotHeightPt
          return { kind: 'chart', height: (title.length + axes.length + summary.length) * CAPTION_LH + plotHeight + 3 * SLIDE_FLOW.itemGap, title, plotHeight, node, axes, summary }
        },
      }]
    default:
      return []
  }
}

export function layoutDeck(deck: DeckSnapshot, fonts: FontSet): DeckLayout {
  const track = { nodeId: '' }
  try {
    return { status: 'ok', slides: layoutSlides(deck, fonts, track) }
  } catch (e) {
    if (e instanceof LayoutTooTallError) return { status: 'error', error: { kind: 'too-tall', nodeId: e.nodeId, message: `${e.message} Slides split instead of shrinking text; this unit is too large even alone.` } }
    if (e instanceof MissingGlyphError) return { status: 'error', error: { kind: 'missing-glyph', nodeId: track.nodeId, message: `${e.message}. Refused rather than substituting.` } }
    throw e
  }
}

function layoutSlides(deck: DeckSnapshot, fonts: FontSet, track: { nodeId: string }): SlideLayout[] {
  const blocks = new Map(deck.blocks.map((b) => [b.id, b]))
  const value = (id: string) => {
    const f = deck.fields[id]
    return f?.state.status === 'provided' ? formatFieldValue(f.state.value, deck.locale, f) : null
  }
  const deckTitle = value(BRIEF_FIELDS.title) ?? 'Untitled deck'
  const out: Omit<SlideLayout, 'number' | 'footer'>[] = []

  for (const plan of deck.slides) {
    track.nodeId = plan.id
    if (plan.layout === 'title') {
      const title = breakLines(fonts, [{ text: deckTitle, style: SLIDE_TYPE.title }], W)
      // The brief's own field labels and values; nothing reworded.
      const meta = [BRIEF_FIELDS.audience, BRIEF_FIELDS.preparedBy, BRIEF_FIELDS.date, BRIEF_FIELDS.reference]
        .flatMap((id) => { const v = value(id); return v ? [`${deck.fields[id].label}: ${v}`] : [] })
      let y = title.length * lh(SLIDE_TYPE.title) + SLIDE_FLOW.headingGap
      const items: SlideItem[] = meta.map((m) => {
        const lines = breakLines(fonts, [{ text: m, style: SLIDE_TYPE.caption }], W)
        const item: SlideItem = { kind: 'text', y, height: lines.length * CAPTION_LH, lines, style: SLIDE_TYPE.caption, indent: 0, marker: null, label: null }
        y += item.height + SLIDE_FLOW.itemGap
        return item
      })
      if (y - SLIDE_FLOW.itemGap > CONTENT_BOTTOM - SAFE) throw new LayoutTooTallError(plan.id, y, CONTENT_BOTTOM - SAFE)
      out.push({ planId: plan.id, planIds: [plan.id], layout: 'title', blockIds: [], continued: false, title, heading: null, items })
      continue
    }

    const headingBlock = plan.blockIds.map((id) => blocks.get(id)).find((b) => b?.type === 'heading')
    const headingText = headingBlock?.type === 'heading' ? headingBlock.text : null
    let queue: Unit[] = []
    for (const id of plan.blockIds) {
      const block = blocks.get(id)
      if (!block || block.type === 'heading') continue
      track.nodeId = id
      const node = planNodeForBlock(deck, block)
      if (node) queue.push(...unitsFor(fonts, node))
    }

    let continued = false
    while (queue.length) {
      const heading = headingText ? breakLines(fonts, [{ text: continued ? `${headingText} (continued)` : headingText, style: SLIDE_TYPE.heading }], W) : null
      const top = heading ? heading.length * lh(SLIDE_TYPE.heading) + SLIDE_FLOW.headingGap : 0
      const avail = CONTENT_BOTTOM - SAFE - top
      const items: SlideItem[] = []
      const ids = new Set<string>()
      let y = top
      while (queue.length) {
        const unit = queue[0]
        track.nodeId = unit.blockId
        const built = unit.build(W)
        const gap = items.length ? unit.gapBefore : 0
        if (y + gap + built.height <= top + avail + 1e-6) {
          items.push({ ...built, y: y + gap } as SlideItem)
          ids.add(unit.blockId)
          y += gap + built.height
          queue.shift()
          continue
        }
        if (items.length === 0) {
          // Alone on an empty slide and still too tall: split by sentence, or fail.
          if (unit.splitInto) { queue = [...unit.splitInto(), ...queue.slice(1)]; continue }
          throw new LayoutTooTallError(unit.blockId, built.height, avail)
        }
        break
      }
      out.push({ planId: plan.id, planIds: [plan.id], layout: plan.layout, blockIds: [...ids], continued, title: null, heading, items })
      continued = true
    }
  }

  const merged = shareShortSections(out)
  const total = merged.length
  const left = fitCaption(fonts, deckTitle, W * 0.75)
  return merged.map((s, i) => {
    const right = breakLines(fonts, [{ text: `${i + 1} / ${total}`, style: SLIDE_TYPE.caption }], W)[0]
    return { ...s, number: i + 1, footer: { left, right, y: FOOTER_Y } }
  })
}

type Unnumbered = Omit<SlideLayout, 'number' | 'footer'>

/**
 * At most two short consecutive content sections share a slide, each keeping its own heading.
 * Only sections that fit on one slide by themselves are combined, and only when both fit
 * together; the second heading sits a heading gap below the first section's content.
 */
function shareShortSections(slides: Unnumbered[]): Unnumbered[] {
  const counts = new Map<string, number>()
  slides.forEach((s) => counts.set(s.planId, (counts.get(s.planId) ?? 0) + 1))
  const single = (s: Unnumbered) => s.layout === 'content' && counts.get(s.planId) === 1 && s.heading !== null
  const bottom = (s: Unnumbered) => Math.max(s.heading ? s.heading.length * lh(SLIDE_TYPE.heading) : 0, ...s.items.map((i) => i.y + i.height))
  const out: Unnumbered[] = []
  for (let i = 0; i < slides.length; i++) {
    const a = slides[i]
    const b = slides[i + 1]
    if (b && single(a) && single(b)) {
      const headingY = bottom(a) + SLIDE_FLOW.headingGap
      const headingH = b.heading!.length * lh(SLIDE_TYPE.heading)
      // b's items are positioned below b's own heading, so they move down by the new heading's offset.
      const moved = b.items.map((it) => ({ ...it, y: it.y + headingY }))
      const end = Math.max(headingY + headingH, ...moved.map((it) => it.y + it.height))
      if (end <= CONTENT_BOTTOM - SAFE + 1e-6) {
        out.push({ ...a, planIds: [a.planId, b.planId], blockIds: [...a.blockIds, ...b.blockIds], items: [...a.items, { kind: 'heading', y: headingY, height: headingH, lines: b.heading! }, ...moved] })
        i++
        continue
      }
    }
    out.push(a)
  }
  return out
}

function fitCaption(fonts: FontSet, text: string, width: number): Line {
  const s = SLIDE_TYPE.caption
  let t = text
  if (measure(fonts, t, s) > width) {
    const chars = [...text]
    while (chars.length && measure(fonts, `${chars.join('').trimEnd()}…`, s) > width) chars.pop()
    t = `${chars.join('').trimEnd()}…`
  }
  return { segments: [{ text: t, style: s, width: measure(fonts, t, s) }], width: measure(fonts, t, s) }
}

export const SLIDE_GEOMETRY = { safe: SAFE, width: W, contentBottom: CONTENT_BOTTOM }
