// PowerPoint renderer (pptxgenjs). Editable native content from the same slide
// layout the preview and PDF draw: one text box per engine item, at the
// engine's position and size, holding real paragraphs and runs; the chart is
// a native, editable PowerPoint bar chart with its title, axes line and data
// summary kept beside it as text. Fonts are named exactly as the TTF name
// tables say; pptxgenjs cannot embed fonts, so a viewer without them
// substitutes (recorded in the README). PowerPoint wraps text itself, so line
// breaks can differ from the PDF where it substitutes a face.

import { leading } from '../layout/blocks'
import { layoutDeck, SLIDE_GEOMETRY, type SlideItem } from '../layout/slides'
import type { Line } from '../layout/text'
import type { DeckSnapshot } from '../model'
import { CHART, SLIDE, SLIDE_FLOW, SLIDE_INLINE, SLIDE_TYPE, SPACE, STATE_COLOURS, type TextStyle } from '../tokens'
import { LayoutRefusedError } from './pdf'
import type { ExportResources } from './resources'

export interface PptxMetadata {
  title: string
  subject: string
}

export interface PptxRender {
  bytes: Uint8Array
  slideCount: number
  /** Font families the file names (not embedded). */
  namedFonts: string[]
}

const inch = (pt: number) => pt / 72
const hex = (c: string) => c.replace('#', '').toUpperCase()

export async function renderPptx(snapshot: DeckSnapshot, resources: ExportResources, meta: PptxMetadata): Promise<PptxRender> {
  const { fonts } = resources
  const deck = layoutDeck(snapshot, fonts)
  if (deck.status === 'error') throw new LayoutRefusedError({ kind: deck.error.kind, message: deck.error.message })
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_WIDE'
  pres.title = meta.title
  pres.subject = meta.subject
  pres.author = 'Document-quality prototype (sample data)'
  const palette = snapshot.brand.palette
  const safe = SLIDE.safeAreaPt
  const W = SLIDE_GEOMETRY.width
  const named = new Set<string>()

  const face = (s: TextStyle) => fonts.face(s.role, s.weight, s.style).face
  const runOpts = (s: TextStyle, colour: string) => {
    const f = face(s)
    named.add(f.nameTable.family)
    return { fontFace: f.nameTable.family, fontSize: s.sizePt, italic: f.nameTable.subfamily === 'Italic', bold: false, color: hex(colour), charSpacing: s.letterSpacingEm ? s.letterSpacingEm * s.sizePt : undefined }
  }
  /** Engine lines joined back into one paragraph: PowerPoint wraps it in the engine's box. */
  const paragraph = (lines: readonly Line[], lineStyle: TextStyle, colour: string) => {
    const runs: { text: string; options: ReturnType<typeof runOpts> }[] = []
    lines.forEach((l, i) => l.segments.forEach((seg, k) => {
      const citation = seg.style === SLIDE_INLINE.citation && seg.style !== lineStyle
      const text = (i > 0 && k === 0 ? ' ' : '') + seg.text
      const last = runs[runs.length - 1]
      const opts = runOpts(seg.style, citation ? palette.muted : colour)
      if (last && last.options.fontFace === opts.fontFace && last.options.fontSize === opts.fontSize && last.options.italic === opts.italic && last.options.color === opts.color) last.text += text
      else runs.push({ text, options: opts })
    }))
    return runs
  }
  const box = (slide: ReturnType<typeof pres.addSlide>, lines: readonly Line[], style: TextStyle, colour: string, x: number, y: number, w: number, h: number, align: 'left' | 'right' = 'left') => {
    if (!lines.length) return
    slide.addText(paragraph(lines, style, colour), {
      x: inch(x), y: inch(y), w: inch(w), h: inch(Math.max(h, leading(style))),
      margin: 0, valign: 'top', align, wrap: true, fit: 'none', lineSpacing: leading(style), isTextBox: true,
    })
  }

  const drawItem = (slide: ReturnType<typeof pres.addSlide>, item: SlideItem) => {
    const y = safe + item.y
    if (item.kind === 'heading') { box(slide, item.lines, SLIDE_TYPE.heading, palette.ink, safe, y, W, item.height); return }
    if (item.kind === 'text') {
      const lh = leading(item.style)
      if (item.tone === 'warning') slide.addShape(pres.ShapeType.rect, { x: inch(safe - SPACE.lg), y: inch(y), w: inch(2), h: inch(item.lines.length * lh), fill: { color: hex(STATE_COLOURS.missingRule) }, line: { type: 'none' } })
      if (item.marker) box(slide, [{ segments: [{ text: item.marker, style: item.style, width: 0 }], width: 0 }], item.style, palette.ink, safe, y, item.indent, lh)
      box(slide, item.lines, item.style, palette.ink, safe + item.indent, y, W - item.indent, item.lines.length * lh)
      return
    }
    const C = SLIDE_TYPE.caption
    const lh = leading(C)
    let ty = y
    box(slide, item.title, C, palette.ink, safe, ty, W, item.title.length * lh)
    ty += item.title.length * lh + SLIDE_FLOW.itemGap
    const points = item.node.series[0]?.points ?? []
    const f = face(C)
    named.add(f.nameTable.family)
    slide.addChart(pres.ChartType.bar, [{ name: item.node.yLabel, labels: points.map((p) => p.x), values: points.map((p) => p.y) }], {
      x: inch(safe), y: inch(ty), w: inch(W), h: inch(item.plotHeight),
      barDir: 'col', chartColors: [hex(palette.accent)], barGapWidthPct: Math.round(((1 - CHART.barShare) / CHART.barShare) * 100),
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: f.nameTable.family, dataLabelFontSize: C.sizePt, dataLabelColor: hex(palette.ink),
      catAxisLabelFontFace: f.nameTable.family, catAxisLabelFontSize: C.sizePt, catAxisLabelColor: hex(palette.ink), catAxisLineShow: true,
      valAxisHidden: true, valGridLine: { style: 'none' }, showLegend: false, showTitle: false,
      altText: `${item.node.title}. ${item.node.yLabel} by ${item.node.xLabel}. ${item.node.dataSummary}`,
    })
    ty += item.plotHeight + SLIDE_FLOW.itemGap
    box(slide, item.axes, C, palette.muted, safe, ty, W, item.axes.length * lh)
    ty += item.axes.length * lh + SLIDE_FLOW.itemGap
    box(slide, item.summary, C, palette.ink, safe, ty, W, item.summary.length * lh)
  }

  for (const s of deck.slides) {
    const slide = pres.addSlide()
    slide.background = { color: hex(STATE_COLOURS.paper) }
    let y = safe
    if (s.title) { box(slide, s.title, SLIDE_TYPE.title, palette.ink, safe, y, W, s.title.length * leading(SLIDE_TYPE.title)); y += s.title.length * leading(SLIDE_TYPE.title) }
    if (s.heading) box(slide, s.heading, SLIDE_TYPE.heading, palette.ink, safe, y, W, s.heading.length * leading(SLIDE_TYPE.heading))
    for (const item of s.items) drawItem(slide, item)
    const lh = leading(SLIDE_TYPE.caption)
    box(slide, [s.footer.left], SLIDE_TYPE.caption, palette.muted, safe, s.footer.y, W * 0.75, lh)
    box(slide, [s.footer.right], SLIDE_TYPE.caption, palette.muted, safe + W * 0.75, s.footer.y, W * 0.25, lh, 'right')
  }

  const out = await pres.write({ outputType: 'uint8array' })
  return { bytes: out as Uint8Array, slideCount: deck.slides.length, namedFonts: [...named].sort() }
}

