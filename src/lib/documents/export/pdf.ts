// PDF renderer (jsPDF, native text). Draws exactly what the HTML preview
// draws: the same paginate() pages and slide layouts, line by line, at the
// engine's coordinates, with the theme's TTFs embedded unmodified. Nothing is
// re-wrapped or re-measured here — every segment is placed from its engine
// width, so line breaks, page breaks, totals and citations match the preview.
// Charts are vector shapes, not screenshots.
//
// Baselines follow the browser's rule for the preview's line boxes: each
// inline box is centred in the line height by its hhea ascent and descent
// (none of these faces sets USE_TYPO_METRICS differently from hhea), the
// page's body face acting as the strut, and the line's baseline is the lowest
// of those.

import type { jsPDF as JsPdf } from 'jspdf'

import { composeDocument, type DocumentPlan } from '../compose'
import { leading, type Cell, type FragmentBody, type LogoLayout, type ValueLayout } from '../layout/blocks'
import { paginate, type PageLayout, type PagedDocument } from '../layout/paginate'
import { layoutDeck, SLIDE_GEOMETRY, type DeckLayout, type SlideItem, type SlideLayout } from '../layout/slides'
import { measure, type Line } from '../layout/text'
import type { FontSet } from '../metrics'
import type { BrandProfile, DeckSnapshot, DocumentSnapshot } from '../model'
import { BRAND, CHART, FLOW, PAGE_SIZES, PRINT_TYPE, SLIDE, SLIDE_FLOW, SLIDE_INLINE, SLIDE_TYPE, SPACE, STATE_COLOURS, TABLE, type TextStyle } from '../tokens'
import { unavailableAssets, type ExportResources } from './resources'

type Palette = BrandProfile['palette']

export interface PdfMetadata {
  title: string
  subject: string
  /** ISO time the file was made. Written as the PDF creation date. */
  createdAt: string
}

export interface PdfRender {
  bytes: Uint8Array
  pageCount: number
  /** The layout drawn, for parity checks. */
  layout: { kind: 'pages'; paged: Extract<PagedDocument, { status: 'ok' }> } | { kind: 'slides'; deck: Extract<DeckLayout, { status: 'ok' }> }
}

export type LayoutRefusal = { kind: 'missing-glyph' | 'too-tall' | 'empty'; message: string }

export class LayoutRefusedError extends Error {
  constructor(readonly refusal: LayoutRefusal) {
    super(refusal.message)
  }
}

// ── Encoding helpers ─────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function newPdf(width: number, height: number, fonts: FontSet, fontBytes: ReadonlyMap<string, Uint8Array>): Promise<JsPdf> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: [width, height], orientation: width > height ? 'landscape' : 'portrait', compress: true, putOnlyUsedFonts: true })
  for (const face of fonts.theme.faces) {
    const bytes = fontBytes.get(face.file)
    if (!bytes) throw new Error(`Font bytes missing for ${face.file}`)
    doc.addFileToVFS(face.file, toBase64(bytes))
    // One font per face, named by its PostScript name with style "normal": jsPDF never maps weights or styles.
    doc.addFont(face.file, face.nameTable.postscript, 'normal', 'normal', 'Identity-H')
  }
  return doc
}

function finish(doc: JsPdf, meta: PdfMetadata): Uint8Array {
  doc.setProperties({ title: meta.title, subject: meta.subject, creator: 'Document-quality prototype (sample data)' })
  doc.setCreationDate(new Date(meta.createdAt))
  return new Uint8Array(doc.output('arraybuffer'))
}

// ── Text ─────────────────────────────────────────────────────────────────────

class Painter {
  constructor(readonly doc: JsPdf, readonly fonts: FontSet, readonly palette: Palette) {}

  private fontName(style: TextStyle): string {
    return this.fonts.face(style.role, style.weight, style.style).face.nameTable.postscript
  }

  /** Offset from a line box's top to its baseline (see the header comment). */
  baseline(line: Line, lh: number): number {
    const styles = [PRINT_TYPE.body, ...line.segments.map((s) => s.style)]
    let best = 0
    for (const s of styles) {
      const { metrics } = this.fonts.face(s.role, s.weight, s.style)
      const a = (metrics.ascender / metrics.unitsPerEm) * s.sizePt
      const d = (-metrics.descender / metrics.unitsPerEm) * s.sizePt
      best = Math.max(best, (lh - (a + d)) / 2 + a)
    }
    return best
  }

  /**
   * Draws one engine line with its top at `top`. `lineStyle` is the line's own style: citation
   * segments inside another style are drawn muted, as the preview does.
   */
  line(line: Line, x: number, top: number, lineStyle: TextStyle, colour: string, align: 'start' | 'end' = 'start', width = 0) {
    const lh = lineStyle.sizePt * lineStyle.lineHeight
    const y = top + this.baseline(line, lh)
    let cx = align === 'end' ? x + width - line.width : x
    for (const seg of line.segments) {
      const s = seg.style
      const citation = (s === PRINT_TYPE.citation || s === SLIDE_INLINE.citation) && s !== lineStyle
      this.doc.setFont(this.fontName(s), 'normal')
      this.doc.setFontSize(s.sizePt)
      this.doc.setCharSpace(s.letterSpacingEm * s.sizePt)
      this.doc.setTextColor(citation ? this.palette.muted : colour)
      this.doc.text(s.uppercase ? seg.text.toUpperCase() : seg.text, cx, y, { baseline: 'alphabetic' })
      cx += seg.width
    }
    return lh
  }

  lines(lines: readonly Line[], x: number, top: number, style: TextStyle, colour: string, align: 'start' | 'end' = 'start', width = 0): number {
    let y = top
    for (const l of lines) y += this.line(l, x, y, style, colour, align, width)
    return y - top
  }

  fill(x: number, y: number, w: number, h: number, colour: string) {
    this.doc.setFillColor(colour)
    this.doc.rect(x, y, w, h, 'F')
  }

  /** A border drawn inside the box, as CSS draws it. */
  stroke(x: number, y: number, w: number, h: number, colour: string, width: number, dashed = false) {
    this.doc.setDrawColor(colour)
    this.doc.setLineWidth(width)
    this.doc.setLineDashPattern(dashed ? [width * 3, width * 3] : [], 0)
    this.doc.rect(x + width / 2, y + width / 2, w - width, h - width, 'S')
    this.doc.setLineDashPattern([], 0)
  }

  hline(x: number, y: number, w: number, colour: string, width: number) {
    this.fill(x, y, w, width, colour)
  }
}

// ── Values and primitives ────────────────────────────────────────────────────

const P = PRINT_TYPE
const lhOf = (s: TextStyle) => leading(s)

function drawValue(p: Painter, v: ValueLayout | null, x: number, y: number, width: number, align: 'start' | 'end' = 'start') {
  if (!v) return
  if (v.kind === 'text') { p.lines(v.lines, x, y, P[v.style], p.palette.ink, align, width); return }
  if (v.kind === 'missing') {
    const bx = align === 'end' ? x + width - v.boxWidth : x
    const b = FLOW.missing.border
    p.fill(bx, y, v.boxWidth, v.height, STATE_COLOURS.missingFill)
    p.stroke(bx, y, v.boxWidth, v.height, STATE_COLOURS.missingRule, b, true)
    p.lines(v.lines, bx + b + FLOW.missing.paddingX, y + b, P.label, STATE_COLOURS.missingInk)
    return
  }
  const h = p.lines(v.lines, x, y, P[v.style], STATE_COLOURS.unknownInk, align, width)
  if (v.reasonLines.length) p.lines(v.reasonLines, x, y + h + SPACE.xxs, P.label, p.palette.muted, align, width)
}

function drawCell(p: Painter, cell: Cell, x: number, y: number, labelGap: number) {
  const h = p.lines(cell.label, x + cell.x, y + cell.y, P.label, p.palette.muted)
  drawValue(p, cell.value, x + cell.x, y + cell.y + h + labelGap, cell.width)
}

function drawLogo(p: Painter, logo: LogoLayout, x: number, y: number, resources: ExportResources) {
  if (logo.kind === 'image') {
    const img = resources.images.get(logo.asset.src)!
    p.doc.addImage(img.bytes, img.type.toUpperCase(), x, y, logo.width, logo.height)
    return
  }
  drawFallbackBox(p, logo.lines, x, y, logo.width, logo.height)
}

/** The labelled neutral placeholder (missing or broken logo/image). */
function drawFallbackBox(p: Painter, lines: readonly Line[], x: number, y: number, w: number, h: number) {
  p.stroke(x, y, w, h, p.palette.rule, 0.5, true)
  const lh = lhOf(P.label)
  let ty = y + (h - lines.length * lh) / 2
  for (const l of lines) ty += p.line(l, x + (w - l.width) / 2, ty, P.label, p.palette.muted)
}

function drawBarPlot(p: Painter, node: Extract<FragmentBody, { primitive: 'chart' }>['node'], x: number, y: number, w: number, h: number, labelStyle: TextStyle) {
  const points = node.series[0]?.points ?? []
  const labels = node.valueLabels[0] ?? []
  const max = Math.max(1, ...points.map((pt) => pt.y))
  const top = CHART.valueLabelBandPt, bottom = CHART.axisLabelBandPt
  const band = w / Math.max(1, points.length)
  p.doc.setDrawColor(p.palette.ink)
  p.doc.setLineWidth(CHART.axisStrokePt)
  p.doc.line(x, y + h - bottom, x + w, y + h - bottom)
  const text = (t: string, cx: number, baseline: number) => {
    const width = measure(p.fonts, t, labelStyle)
    // Same line height as the label style; the SVG text baseline is given directly.
    const line: Line = { segments: [{ text: t, style: labelStyle, width }], width }
    const lh = lhOf(labelStyle)
    p.line(line, cx - width / 2, baseline - p.baseline(line, lh), labelStyle, p.palette.ink)
  }
  points.forEach((pt, i) => {
    const barH = ((h - bottom - top) * pt.y) / max
    const barW = band * CHART.barShare
    const bx = x + i * band + (band - barW) / 2
    p.fill(bx, y + h - bottom - barH, barW, barH, p.palette.accent)
    text(labels[i] ?? '', bx + barW / 2, y + h - bottom - barH - CHART.valueLabelGapPt)
    text(pt.x, bx + barW / 2, y + h - bottom + CHART.axisLabelBandPt - CHART.valueLabelGapPt)
  })
}

function drawFragment(p: Painter, body: FragmentBody, x: number, y: number, h: number, width: number, resources: ExportResources) {
  const { palette } = p
  switch (body.primitive) {
    case 'letterhead': {
      drawLogo(p, body.logo, x, y, resources)
      p.lines(body.issuerLines, x + body.logo.width + FLOW.letterhead.gap, y + body.issuerY, P.issuerName, palette.ink)
      p.hline(x, y + h - BRAND.accentRulePt, width, palette.accent, BRAND.accentRulePt)
      return
    }
    case 'title-block': {
      const F = FLOW.titleBlock
      if (body.draft) {
        const b = FLOW.missing.border
        p.fill(x, y + F.paddingTop, body.draft.width, body.draft.height, STATE_COLOURS.missingFill)
        p.stroke(x, y + F.paddingTop, body.draft.width, body.draft.height, STATE_COLOURS.missingRule, b)
        p.lines(body.draft.lines, x + b + F.draftPaddingX, y + F.paddingTop + b + F.draftPaddingY, P.draftMarker, STATE_COLOURS.missingInk)
      }
      drawValue(p, body.title, x, y + body.titleY, width)
      for (const c of body.meta) drawCell(p, c, x, y + body.metaY, F.labelGap)
      return
    }
    case 'text': {
      if (body.role === 'section-heading') { p.lines(body.lines, x, y, P.sectionHeading, palette.ink); return }
      if (body.role === 'summary') {
        p.fill(x, y, BRAND.accentRulePt, h, palette.accent)
        p.lines(body.lines, x + BRAND.accentRulePt + FLOW.summary.inset, y + FLOW.summary.paddingY, P.body, palette.ink)
        return
      }
      if (body.role === 'callout') {
        const C = FLOW.callout
        if (body.audience === 'internal') {
          p.fill(x, y, width, h, STATE_COLOURS.internalFill)
          p.stroke(x, y, width, h, palette.muted, 0.5, true)
        }
        p.fill(x, y, BRAND.accentRulePt, h, body.tone === 'warning' ? STATE_COLOURS.missingRule : palette.rule)
        let ty = y + C.paddingY
        if (body.label) ty += p.lines(body.label, x + BRAND.accentRulePt + C.paddingX, ty, P.label, palette.muted) + C.labelGap
        p.lines(body.lines, x + BRAND.accentRulePt + C.paddingX, ty, P.body, palette.ink)
        return
      }
      if (body.role === 'pull-quote') { p.lines(body.lines, x + FLOW.pullQuote.indent, y, P.pullQuote, palette.ink); return }
      p.lines(body.lines, x, y, P.body, palette.ink)
      return
    }
    case 'list': {
      let ty = y
      for (const item of body.items) {
        ty += item.gapBefore
        if (item.startsItem) {
          const width2 = measure(p.fonts, item.marker, P.body)
          p.line({ segments: [{ text: item.marker, style: P.body, width: width2 }], width: width2 }, x, ty, P.body, palette.ink)
        }
        ty += p.lines(item.lines, x + FLOW.list.indent, ty, P.body, palette.ink)
      }
      return
    }
    case 'key-value-group': {
      if (body.title) p.lines(body.title, x, y, P.label, palette.muted)
      for (const c of body.cells) drawCell(p, c, x, y + body.cellsY, FLOW.keyValueGroup.labelGap)
      return
    }
    case 'table': {
      const padX = TABLE.cellPaddingXPt, padY = TABLE.cellPaddingYPt
      let ty = y
      if (body.caption) ty += p.lines(body.caption, x, ty, P.label, palette.muted) + FLOW.table.captionGap
      body.header.cells.forEach((lines, i) => {
        const col = body.columns[i]
        p.lines(lines, x + col.x + padX, ty + padY, P.tableHeader, palette.ink, col.align, col.width - 2 * padX)
      })
      p.hline(x, ty + body.header.height - TABLE.headerRuleWidthPt, width, palette.ink, TABLE.headerRuleWidthPt)
      ty += body.header.height
      for (const row of body.rows) {
        row.cells.forEach((cell, i) => {
          const col = body.columns[i]
          let cy = ty + padY
          if (i === 0 && row.continuedLabel) cy += p.line(row.continuedLabel, x + col.x + padX, cy, P.label, palette.muted) + SPACE.xxs
          drawValue(p, cell, x + col.x + padX, cy, col.width - 2 * padX, col.align)
        })
        p.hline(x, ty + row.height - TABLE.ruleWidthPt, width, palette.rule, TABLE.ruleWidthPt)
        ty += row.height
      }
      return
    }
    case 'totals': {
      const padX = TABLE.cellPaddingXPt, padY = TABLE.cellPaddingYPt
      const tx = x + body.x
      let ty = y
      for (const r of body.rows) {
        const top = r.grand ? TABLE.totalsRuleWidthPt + FLOW.totals.grandPaddingTop : padY
        if (r.grand) p.hline(tx, ty, body.width, palette.ink, TABLE.totalsRuleWidthPt)
        p.lines(r.label, tx + padX, ty + top, P[r.labelStyle], palette.ink)
        const vx = tx + body.labelWidth + FLOW.totals.columnGap + padX
        drawValue(p, r.value, vx, ty + top, body.width - body.labelWidth - FLOW.totals.columnGap - 2 * padX, 'end')
        ty += r.height
      }
      return
    }
    case 'chart': {
      const lh = lhOf(P.label)
      let ty = y + p.lines(body.title, x, y, P.label, palette.ink) + FLOW.chart.titleGap
      drawBarPlot(p, body.node, x, ty, width, body.plotHeight, P.label)
      ty += body.plotHeight + FLOW.chart.noteGap
      ty += p.lines(body.axes, x, ty, P.label, palette.muted) + FLOW.chart.noteGap
      p.lines(body.summary, x, ty, P.label, palette.ink)
      void lh
      return
    }
    case 'image': {
      if (body.available) {
        const img = resources.images.get(body.asset.src)!
        p.doc.addImage(img.bytes, img.type.toUpperCase(), x, y, body.width, body.height)
      } else drawFallbackBox(p, body.note, x, y, body.width, body.height)
      p.lines(body.caption, x, y + body.height + FLOW.image.captionGap, P.label, palette.ink)
      return
    }
    case 'source-list': {
      let ty = y
      for (const e of body.entries) {
        ty += e.gapBefore
        const marker = `${e.number}.`
        const mw = measure(p.fonts, marker, P.citation)
        p.line({ segments: [{ text: marker, style: P.citation, width: mw }], width: mw }, x, ty, P.citation, palette.ink)
        ty += p.lines(e.lines, x + FLOW.sourceList.indent, ty, P.citation, palette.ink)
      }
      return
    }
  }
}

function drawPage(p: Painter, page: PageLayout, resources: ExportResources) {
  p.fill(0, 0, page.widthPt, page.heightPt, STATE_COLOURS.paper)
  if (page.runningHeader) {
    const h = p.lines(page.runningHeader.lines, page.content.x, page.runningHeader.y, P.footer, p.palette.muted)
    p.hline(page.content.x, page.runningHeader.y + h + SPACE.sm, page.content.width, p.palette.rule, 0.5)
  }
  for (const f of page.fragments) drawFragment(p, f.body, page.content.x, page.content.y + f.y, f.height, page.content.width, resources)
  p.line(page.footer.identification, page.content.x, page.footer.y, P.footer, p.palette.muted)
  p.line(page.footer.pageLabel, page.content.x, page.footer.y, P.footer, p.palette.muted, 'end', page.content.width)
}

// ── Documents (invoice, brief) ───────────────────────────────────────────────

/** Lays out a document exactly as the preview does for recipients, or refuses. */
export function layoutForExport(snapshot: Exclude<DocumentSnapshot, DeckSnapshot>, fonts: FontSet, unavailable: ReadonlySet<string>): { plan: DocumentPlan; paged: Extract<PagedDocument, { status: 'ok' }> } {
  const plan = composeDocument(snapshot, { audience: 'recipient' })
  const paged = paginate(plan, fonts, { unavailableAssets: unavailable })
  if (paged.status === 'empty') throw new LayoutRefusedError({ kind: 'empty', message: `This ${snapshot.kind} has no fields and no content blocks, so there is nothing to export.` })
  if (paged.status === 'error') throw new LayoutRefusedError({ kind: paged.error.kind, message: paged.error.message })
  return { plan, paged }
}

export async function renderDocumentPdf(snapshot: Exclude<DocumentSnapshot, DeckSnapshot>, resources: ExportResources, meta: PdfMetadata): Promise<PdfRender> {
  const { plan, paged } = layoutForExport(snapshot, resources.fonts, unavailableAssets(snapshot, resources))
  const size = PAGE_SIZES[paged.preset]
  const doc = await newPdf(size.widthPt, size.heightPt, resources.fonts, resources.fontBytes)
  const p = new Painter(doc, resources.fonts, plan.palette)
  paged.pages.forEach((page, i) => {
    if (i > 0) doc.addPage([size.widthPt, size.heightPt], 'portrait')
    drawPage(p, page, resources)
  })
  return { bytes: finish(doc, meta), pageCount: paged.pages.length, layout: { kind: 'pages', paged } }
}

// ── Decks ────────────────────────────────────────────────────────────────────

export function layoutDeckForExport(snapshot: DeckSnapshot, fonts: FontSet): Extract<DeckLayout, { status: 'ok' }> {
  const deck = layoutDeck(snapshot, fonts)
  if (deck.status === 'error') throw new LayoutRefusedError({ kind: deck.error.kind, message: deck.error.message })
  return deck
}

function drawSlideItem(p: Painter, item: SlideItem, x: number, y: number) {
  const W = SLIDE_GEOMETRY.width
  if (item.kind === 'heading') { p.lines(item.lines, x, y + item.y, SLIDE_TYPE.heading, p.palette.ink); return }
  if (item.kind === 'text') {
    const top = y + item.y
    if (item.tone === 'warning') p.fill(x - SPACE.lg, top, 2, item.lines.length * lhOf(item.style), STATE_COLOURS.missingRule)
    if (item.marker) {
      const mw = measure(p.fonts, item.marker, item.style)
      p.line({ segments: [{ text: item.marker, style: item.style, width: mw }], width: mw }, x, top, item.style, p.palette.ink)
    }
    p.lines(item.lines, x + item.indent, top, item.style, p.palette.ink)
    return
  }
  const C = SLIDE_TYPE.caption
  let ty = y + item.y
  ty += p.lines(item.title, x, ty, C, p.palette.ink) + SLIDE_FLOW.itemGap
  drawBarPlot(p, item.node, x, ty, W, item.plotHeight, C)
  ty += item.plotHeight + SLIDE_FLOW.itemGap
  ty += p.lines(item.axes, x, ty, C, p.palette.muted) + SLIDE_FLOW.itemGap
  p.lines(item.summary, x, ty, C, p.palette.ink)
}

function drawSlide(p: Painter, slide: SlideLayout) {
  const safe = SLIDE.safeAreaPt
  p.fill(0, 0, SLIDE.widthPt, SLIDE.heightPt, STATE_COLOURS.paper)
  let y = safe
  if (slide.title) y += p.lines(slide.title, safe, y, SLIDE_TYPE.title, p.palette.ink)
  if (slide.heading) p.lines(slide.heading, safe, y, SLIDE_TYPE.heading, p.palette.ink)
  for (const item of slide.items) drawSlideItem(p, item, safe, safe)
  p.line(slide.footer.left, safe, slide.footer.y, SLIDE_TYPE.caption, p.palette.muted)
  p.line(slide.footer.right, safe, slide.footer.y, SLIDE_TYPE.caption, p.palette.muted, 'end', SLIDE_GEOMETRY.width)
}

export async function renderDeckPdf(snapshot: DeckSnapshot, resources: ExportResources, meta: PdfMetadata): Promise<PdfRender> {
  const deck = layoutDeckForExport(snapshot, resources.fonts)
  const doc = await newPdf(SLIDE.widthPt, SLIDE.heightPt, resources.fonts, resources.fontBytes)
  const p = new Painter(doc, resources.fonts, snapshot.brand.palette)
  deck.slides.forEach((slide, i) => {
    if (i > 0) doc.addPage([SLIDE.widthPt, SLIDE.heightPt], 'landscape')
    drawSlide(p, slide)
  })
  return { bytes: finish(doc, meta), pageCount: deck.slides.length, layout: { kind: 'slides', deck } }
}
