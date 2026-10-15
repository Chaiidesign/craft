// Measures plan nodes into blocks the paginator can place. Each block is a
// sequence of units (lines, rows, list lines, source entries) with a height
// function and break rules; keep-together blocks are a single unit. Every
// geometry value comes from tokens.ts; text is broken with real font metrics.
// The fragments built here are what every renderer draws.

import { citationMarker, missingText, type PlanNode, type PlanRun, type PlanValue } from '../compose'
import type { FontSet } from '../metrics'
import type { ImageAsset, TableColumn } from '../model'
import { BRAND, CHART, FLOW, KEEP, PRINT_TYPE, SPACE, TABLE, type PrintTypeKey, type TextStyle } from '../tokens'
import { breakLines, measure, naturalWidth, type Line, type Span } from './text'

export const leading = (s: TextStyle) => s.sizePt * s.lineHeight

// ── Value layout (text / MissingField / unknown) ─────────────────────────────

export type ValueLayout =
  | { kind: 'text'; style: PrintTypeKey; lines: Line[]; height: number }
  | { kind: 'missing'; lines: Line[]; boxWidth: number; height: number }
  | { kind: 'unknown'; style: PrintTypeKey; lines: Line[]; reasonLines: Line[]; height: number }

export function layoutValue(fonts: FontSet, value: PlanValue, width: number): ValueLayout {
  if (value.kind === 'text') {
    const style = PRINT_TYPE[value.style]
    const lines = breakLines(fonts, [{ text: value.text, style }], width)
    return { kind: 'text', style: value.style, lines, height: lines.length * leading(style) }
  }
  if (value.kind === 'missing') {
    const { paddingX, border } = FLOW.missing
    const inner = width - 2 * (paddingX + border)
    const lines = breakLines(fonts, [{ text: missingText(value), style: PRINT_TYPE.label }], inner)
    const boxWidth = Math.max(...lines.map((l) => l.width)) + 2 * (paddingX + border)
    return { kind: 'missing', lines, boxWidth, height: lines.length * leading(PRINT_TYPE.label) + 2 * border }
  }
  const style = PRINT_TYPE[value.style]
  const lines = breakLines(fonts, [{ text: value.text, style }], width)
  const reasonLines = value.reasons.length ? breakLines(fonts, [{ text: value.reasons.join(' '), style: PRINT_TYPE.label }], width) : []
  const height = lines.length * leading(style) + (reasonLines.length ? SPACE.xxs + reasonLines.length * leading(PRINT_TYPE.label) : 0)
  return { kind: 'unknown', style: value.style, lines, reasonLines, height }
}

function valueNaturalWidth(fonts: FontSet, value: PlanValue): number {
  if (value.kind === 'text') return naturalWidth(fonts, [{ text: value.text, style: PRINT_TYPE[value.style] }])
  if (value.kind === 'missing') return naturalWidth(fonts, [{ text: missingText(value), style: PRINT_TYPE.label }]) + 2 * (FLOW.missing.paddingX + FLOW.missing.border)
  return naturalWidth(fonts, [{ text: value.text, style: PRINT_TYPE[value.style] }])
}

// ── Fragment bodies (what renderers draw) ────────────────────────────────────

export type LogoLayout =
  | { kind: 'image'; asset: ImageAsset; width: number; height: number }
  | { kind: 'fallback'; lines: Line[]; width: number; height: number }

export type Cell = { x: number; y: number; width: number; height: number; label: Line[]; value: ValueLayout }

export type TableRowLayout = {
  id: string
  height: number
  /** Per column. Partial rows (a row taller than a page) carry only some description lines. */
  cells: (ValueLayout | null)[]
  continuedFromPrevious: boolean
  continuesOnNext: boolean
  /** Measured "Continued from previous page" label for a row carried over a page break. */
  continuedLabel: Line | null
}

export const CONTINUED_ROW_LABEL = 'Continued from previous page'

export type ColumnLayout = { x: number; width: number; align: 'start' | 'end'; numeric: boolean }

export type FragmentBody =
  | { primitive: 'letterhead'; logo: LogoLayout; issuerLines: Line[]; issuerY: number; rowHeight: number }
  | { primitive: 'title-block'; draft: { lines: Line[]; width: number; height: number } | null; title: ValueLayout; titleY: number; meta: Cell[]; metaY: number }
  | { primitive: 'text'; role: 'summary' | 'paragraph' | 'pull-quote' | 'section-heading' | 'callout'; style: PrintTypeKey; lines: Line[]; label: Line[] | null; tone?: 'note' | 'warning'; audience?: 'recipient' | 'internal'; level?: 1 | 2 | 3 }
  | { primitive: 'list'; ordered: boolean; items: { number: number; marker: string; lines: Line[]; gapBefore: number; startsItem: boolean }[] }
  | { primitive: 'key-value-group'; title: Line[] | null; cells: Cell[]; cellsY: number }
  | { primitive: 'table'; caption: Line[] | null; columns: ColumnLayout[]; header: { cells: Line[][]; height: number }; rows: TableRowLayout[]; repeatedHeader: boolean }
  | { primitive: 'totals'; x: number; width: number; labelWidth: number; rows: { id: string; label: Line[]; labelStyle: PrintTypeKey; value: ValueLayout; height: number; grand: boolean }[] }
  | { primitive: 'chart'; node: Extract<PlanNode, { primitive: 'chart-with-data-summary' }>; title: Line[]; plotHeight: number; axes: Line[]; summary: Line[] }
  | { primitive: 'image'; asset: ImageAsset; available: boolean; width: number; height: number; note: Line[]; caption: Line[] }
  | { primitive: 'source-list'; entries: { number: number; lines: Line[]; gapBefore: number }[] }

export interface MeasuredBlock {
  id: string
  primitive: PlanNode['primitive']
  before: number
  after: number
  units: number
  /** Height of the fragment holding units [from, to). */
  height(from: number, to: number): number
  /** May a page break fall between unit i and unit i + 1? */
  canBreakAfter(i: number): boolean
  /** Units at the end that must share a page with the next block (headings: all of them). */
  keepTail: number
  /** Human-readable rule, recorded as the reason when it moves content to a new page. */
  keepReason?: string
  /** Reason recorded when the kept tail moves to a new page with the next block. */
  tailReason?: string
  /** Must share a page with the end of the previous block. */
  keepWithPrevious?: boolean
  /** Tables: how many units the last `rows` rows span (a row split by lines is several units). */
  unitsForLastRows?(rows: number): number
  build(from: number, to: number): FragmentBody
}

const atomic = (id: string, primitive: PlanNode['primitive'], before: number, after: number, h: number, body: FragmentBody, keepReason?: string): MeasuredBlock => ({
  id, primitive, before, after, units: 1, height: () => h, canBreakAfter: () => false, keepTail: 0, keepReason, build: () => body,
})

export class LayoutTooTallError extends Error {
  constructor(readonly nodeId: string, readonly heightPt: number, readonly availablePt: number) {
    super(`“${nodeId}” needs ${heightPt.toFixed(1)}pt but a page holds ${availablePt.toFixed(1)}pt. It cannot be split, and text is never shrunk to fit.`)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function runSpans(runs: readonly PlanRun[], base: TextStyle): Span[] {
  const spans: Span[] = []
  for (const r of runs) {
    spans.push({ text: r.text, style: r.emphasis ? PRINT_TYPE.emphasis : base })
    if (r.citations.length) spans.push({ text: citationMarker(r.citations), style: PRINT_TYPE.citation })
  }
  return spans
}

/** Units = lines, with orphan/widow control. Short blocks (≤ orphans + widows − 1 lines) never split. */
function lineBlock(id: string, primitive: PlanNode['primitive'], before: number, after: number, lines: Line[], lh: number, build: (ls: Line[]) => FragmentBody): MeasuredBlock {
  return {
    id, primitive, before, after,
    units: lines.length,
    height: (from, to) => (to - from) * lh,
    canBreakAfter: (i) => i + 1 >= KEEP.orphans && lines.length - (i + 1) >= KEEP.widows,
    keepTail: 0,
    keepReason: `Paragraph split keeps at least ${KEEP.orphans} lines at the foot and ${KEEP.widows} at the head of a page`,
    build: (from, to) => build(lines.slice(from, to)),
  }
}

export interface MeasureContext {
  fonts: FontSet
  contentWidth: number
  /** Tallest fragment any page can hold (the smallest content area). Taller rows split by lines. */
  maxFragmentHeight: number
  unavailableAssets: ReadonlySet<string>
}

// ── Per-primitive measurement ────────────────────────────────────────────────

export function measureNode(node: PlanNode, ctx: MeasureContext): MeasuredBlock | null {
  const { fonts, contentWidth: W } = ctx
  switch (node.primitive) {
    case 'letterhead': {
      let logo: LogoLayout
      const fallback = (note: string): LogoLayout => {
        const lines = breakLines(fonts, [{ text: note, style: PRINT_TYPE.label }], BRAND.logoMaxWidthPt - 2 * SPACE.md)
        return { kind: 'fallback', lines, width: Math.max(...lines.map((l) => l.width)) + 2 * SPACE.md, height: Math.max(BRAND.logoMaxHeightPt, lines.length * leading(PRINT_TYPE.label) + 2 * SPACE.xs) }
      }
      if (node.logo.kind === 'image' && !ctx.unavailableAssets.has(node.logo.asset.src)) {
        const aspect = node.logo.asset.widthPx / node.logo.asset.heightPx
        let h = BRAND.logoMaxHeightPt
        let w = h * aspect
        if (w > BRAND.logoMaxWidthPt) { w = BRAND.logoMaxWidthPt; h = w / aspect }
        logo = { kind: 'image', asset: node.logo.asset, width: w, height: h }
      } else logo = fallback(node.logo.kind === 'image' ? node.logo.brokenNote : node.logo.note)
      const issuerLines = breakLines(fonts, [{ text: node.issuerName, style: PRINT_TYPE.issuerName }], W - logo.width - FLOW.letterhead.gap)
      const issuerH = issuerLines.length * leading(PRINT_TYPE.issuerName)
      const rowHeight = Math.max(logo.height, issuerH)
      const h = rowHeight + FLOW.letterhead.paddingBottom + BRAND.accentRulePt
      return atomic(node.id, node.primitive, 0, 0, h, { primitive: 'letterhead', logo, issuerLines, issuerY: (rowHeight - issuerH) / 2, rowHeight })
    }

    case 'title-block': {
      const F = FLOW.titleBlock
      let y = F.paddingTop
      let draft: Extract<FragmentBody, { primitive: 'title-block' }>['draft'] = null
      if (node.draft) {
        const lines = breakLines(fonts, [{ text: node.draft, style: PRINT_TYPE.draftMarker }], W - 2 * (F.draftPaddingX + FLOW.missing.border))
        draft = { lines, width: Math.max(...lines.map((l) => l.width)) + 2 * (F.draftPaddingX + FLOW.missing.border), height: lines.length * leading(PRINT_TYPE.draftMarker) + 2 * (F.draftPaddingY + FLOW.missing.border) }
        y += draft.height + F.draftGap
      }
      const title = layoutValue(fonts, node.title, W)
      const titleY = y
      y += title.height
      const entries = [...(node.reference ? [{ label: node.reference.label, value: node.reference.value }] : []), ...node.meta.map((m) => ({ label: m.label, value: m.value }))]
      const cols = F.metaColumns
      const colW = (W - (cols - 1) * F.metaColumnGap) / cols
      const meta: Cell[] = []
      let metaY = 0
      if (entries.length) {
        y += F.metaGap
        metaY = y
        let rowY = 0
        for (let r = 0; r * cols < entries.length; r++) {
          const row = entries.slice(r * cols, r * cols + cols).map((e, c) => {
            const label = breakLines(fonts, [{ text: e.label, style: PRINT_TYPE.label }], colW)
            const value = layoutValue(fonts, e.value, colW)
            const h = label.length * leading(PRINT_TYPE.label) + F.labelGap + value.height
            return { x: c * (colW + F.metaColumnGap), y: rowY, width: colW, height: h, label, value }
          })
          const rowH = Math.max(...row.map((c) => c.height))
          meta.push(...row)
          rowY += rowH + F.metaRowGap
        }
        y += rowY - F.metaRowGap
      }
      y += F.paddingBottom
      return atomic(node.id, node.primitive, 0, 0, y, { primitive: 'title-block', draft, title, titleY, meta, metaY }, 'Title block kept together')
    }

    case 'section-heading': {
      const s = PRINT_TYPE.sectionHeading
      const lines = breakLines(fonts, [{ text: node.text, style: s }], W)
      const block = atomic(node.id, node.primitive, FLOW.sectionHeading.before, FLOW.sectionHeading.after, lines.length * leading(s), { primitive: 'text', role: 'section-heading', style: 'sectionHeading', lines, label: null, level: node.level })
      return { ...block, keepTail: 1, keepReason: 'Heading kept with its first lines of content', tailReason: 'Heading kept with its first lines of content' }
    }

    case 'paragraph': {
      if (node.role === 'pull-quote') {
        const s = PRINT_TYPE.pullQuote
        const lines = breakLines(fonts, runSpans(node.runs, s), W - FLOW.pullQuote.indent)
        return lineBlock(node.id, node.primitive, FLOW.pullQuote.before, FLOW.pullQuote.after, lines, leading(s), (ls) => ({ primitive: 'text', role: 'pull-quote', style: 'pullQuote', lines: ls, label: null }))
      }
      const s = PRINT_TYPE.body
      const lines = breakLines(fonts, runSpans(node.runs, s), W)
      return lineBlock(node.id, node.primitive, FLOW.paragraph.before, FLOW.paragraph.after, lines, leading(s), (ls) => ({ primitive: 'text', role: 'paragraph', style: 'body', lines: ls, label: null }))
    }

    case 'summary': {
      const s = PRINT_TYPE.body
      const lines = breakLines(fonts, runSpans(node.runs, s), W - BRAND.accentRulePt - FLOW.summary.inset)
      const h = lines.length * leading(s) + 2 * FLOW.summary.paddingY
      return atomic(node.id, node.primitive, FLOW.summary.before, FLOW.summary.after, h, { primitive: 'text', role: 'summary', style: 'body', lines, label: null }, 'Summary kept together')
    }

    case 'callout': {
      const s = PRINT_TYPE.body
      const inner = W - BRAND.accentRulePt - 2 * FLOW.callout.paddingX
      const label = node.label ? breakLines(fonts, [{ text: node.label, style: PRINT_TYPE.label }], inner) : null
      const lines = breakLines(fonts, runSpans(node.runs, s), inner)
      const h = 2 * FLOW.callout.paddingY + (label ? label.length * leading(PRINT_TYPE.label) + FLOW.callout.labelGap : 0) + lines.length * leading(s)
      return atomic(node.id, node.primitive, FLOW.callout.before, FLOW.callout.after, h, { primitive: 'text', role: 'callout', style: 'body', lines, label, tone: node.tone, audience: node.audience }, 'Callout kept together')
    }

    case 'list': {
      const s = PRINT_TYPE.body
      const lh = leading(s)
      const units: { item: number; line: Line; first: boolean; last: boolean }[] = []
      const items = node.items.map((runs, i) => breakLines(fonts, runSpans(runs, s), W - FLOW.list.indent).map((line, j, all) => {
        units.push({ item: i, line, first: j === 0, last: j === all.length - 1 })
        return line
      }))
      const gap = (u: number) => (units[u].first && units[u].item > 0 ? FLOW.list.itemGap : 0)
      return {
        id: node.id, primitive: node.primitive, before: FLOW.list.before, after: FLOW.list.after, units: units.length,
        height: (from, to) => {
          let h = 0
          for (let u = from; u < to; u++) h += lh + (u === from ? 0 : gap(u))
          return h
        },
        canBreakAfter: (i) => {
          const u = units[i]
          if (u.last) return true
          const count = items[u.item].length
          const linesBefore = units.slice(0, i + 1).filter((x) => x.item === u.item).length
          return linesBefore >= KEEP.orphans && count - linesBefore >= KEEP.widows
        },
        keepTail: 0,
        keepReason: `List item split keeps at least ${KEEP.orphans} lines together`,
        build: (from, to) => {
          const out: Extract<FragmentBody, { primitive: 'list' }>['items'] = []
          for (let u = from; u < to; u++) {
            const unit = units[u]
            const last = out[out.length - 1]
            if (last && last.number === unit.item + 1) last.lines.push(unit.line)
            else out.push({ number: unit.item + 1, marker: node.ordered ? `${unit.item + 1}.` : '•', lines: [unit.line], gapBefore: u === from ? 0 : gap(u), startsItem: unit.first })
          }
          return { primitive: 'list', ordered: node.ordered, items: out }
        },
      }
    }

    case 'key-value-group': {
      const F = FLOW.keyValueGroup
      const title = node.title ? breakLines(fonts, [{ text: node.title, style: PRINT_TYPE.label }], W) : null
      const cols = node.layout === 'stack' ? 1 : 2
      const colW = (W - (cols - 1) * F.columnGap) / cols
      const ordered = node.layout === 'parties'
        ? Array.from({ length: Math.ceil(node.entries.length / 2) }, (_, r) => [node.entries[r], node.entries[Math.ceil(node.entries.length / 2) + r]]).flat()
        : [...node.entries]
      const cells: Cell[] = []
      let y = 0
      for (let r = 0; r * cols < ordered.length; r++) {
        const row = ordered.slice(r * cols, r * cols + cols).flatMap((e, c) => {
          if (!e) return []
          const label = breakLines(fonts, [{ text: e.label, style: PRINT_TYPE.label }], colW)
          const value = layoutValue(fonts, e.value, colW)
          return [{ x: c * (colW + F.columnGap), y, width: colW, height: label.length * leading(PRINT_TYPE.label) + F.labelGap + value.height, label, value }]
        })
        if (!row.length) continue
        cells.push(...row)
        y += Math.max(...row.map((c) => c.height)) + F.rowGap
      }
      y -= cells.length ? F.rowGap : 0
      const cellsY = title ? title.length * leading(PRINT_TYPE.label) + F.titleGap : 0
      const group = atomic(node.id, node.primitive, F.before, F.after, cellsY + y, { primitive: 'key-value-group', title, cells, cellsY }, `${node.title ?? 'Field group'} kept together`)
      return node.keepWithPrevious ? { ...group, keepWithPrevious: true } : group
    }

    case 'table':
    case 'invoice-line-items':
      return measureTable(node, ctx)

    case 'totals': {
      const F = FLOW.totals
      const padX = TABLE.cellPaddingXPt, padY = TABLE.cellPaddingYPt
      const all = [...node.rows.map((r) => ({ ...r, grand: false })), { ...node.grand, grand: true }]
      const labelStyle = (grand: boolean): PrintTypeKey => (grand ? 'tableHeader' : 'tableText')
      const labelWidth = Math.max(...all.map((r) => naturalWidth(fonts, [{ text: r.label, style: PRINT_TYPE[labelStyle(r.grand)] }]))) + 2 * padX
      const valueNatural = Math.max(...all.map((r) => valueNaturalWidth(fonts, r.value))) + 2 * padX
      const width = Math.min(W, Math.max(F.minWidthShare * W, labelWidth + F.columnGap + valueNatural))
      const valueWidth = width - labelWidth - F.columnGap - 2 * padX
      let h = 0
      const rows = all.map((r) => {
        const label = breakLines(fonts, [{ text: r.label, style: PRINT_TYPE[labelStyle(r.grand)] }], labelWidth - 2 * padX)
        const value = layoutValue(fonts, r.value, valueWidth)
        const rowH = Math.max(label.length * leading(PRINT_TYPE[labelStyle(r.grand)]), value.height) + 2 * padY + (r.grand ? F.grandPaddingTop - padY + TABLE.totalsRuleWidthPt : 0)
        h += rowH
        return { id: r.id, label, labelStyle: labelStyle(r.grand), value, height: rowH, grand: r.grand }
      })
      return atomic(node.id, node.primitive, F.before, F.after, h, { primitive: 'totals', x: W - width, width, labelWidth, rows }, `Totals kept together with at least ${KEEP.rowsWithTotals} line-item rows`)
    }

    case 'chart-with-data-summary': {
      const F = FLOW.chart
      const title = breakLines(fonts, [{ text: node.title, style: PRINT_TYPE.label }, ...(node.citations.length ? [{ text: citationMarker(node.citations), style: PRINT_TYPE.citation }] : [])], W)
      const axes = breakLines(fonts, [{ text: node.axesText, style: PRINT_TYPE.label }], W)
      const summary = breakLines(fonts, [{ text: node.dataSummary, style: PRINT_TYPE.label }], W)
      // Category and value labels inside the plot are measured too, so a face missing a glyph fails here.
      node.series.forEach((s) => s.points.forEach((p) => measure(fonts, p.x, PRINT_TYPE.label)))
      node.valueLabels.forEach((vs) => vs.forEach((v) => measure(fonts, v, PRINT_TYPE.label)))
      const plotHeight = CHART.valueLabelBandPt + CHART.plotHeightPt + CHART.axisLabelBandPt
      const lh = leading(PRINT_TYPE.label)
      const h = title.length * lh + F.titleGap + plotHeight + F.noteGap + axes.length * lh + F.noteGap + summary.length * lh
      return atomic(node.id, node.primitive, F.before, F.after, h, { primitive: 'chart', node, title, plotHeight, axes, summary }, 'Chart kept with its caption, units and data summary')
    }

    case 'image-with-caption': {
      const F = FLOW.image
      const available = !ctx.unavailableAssets.has(node.asset.src)
      const caption = breakLines(fonts, [{ text: node.caption, style: PRINT_TYPE.label }, ...(node.citations.length ? [{ text: citationMarker(node.citations), style: PRINT_TYPE.citation }] : [])], W)
      const note = available ? [] : breakLines(fonts, [{ text: node.brokenNote, style: PRINT_TYPE.label }], W - 2 * SPACE.md)
      let width = node.asset.widthPx * 0.75
      let height = node.asset.heightPx * 0.75
      if (width > W) { height *= W / width; width = W }
      if (height > F.maxHeightPt) { width *= F.maxHeightPt / height; height = F.maxHeightPt }
      if (!available) { width = W; height = Math.max(BRAND.logoMaxHeightPt, note.length * leading(PRINT_TYPE.label) + 2 * SPACE.md) }
      const h = height + F.captionGap + caption.length * leading(PRINT_TYPE.label)
      return atomic(node.id, node.primitive, F.before, F.after, h, { primitive: 'image', asset: node.asset, available, width, height, note, caption }, 'Image kept with its caption')
    }

    case 'source-list': {
      const F = FLOW.sourceList
      const lh = leading(PRINT_TYPE.citation)
      const entries = node.entries.map((e) => ({ number: e.number, lines: breakLines(fonts, [{ text: e.text, style: PRINT_TYPE.citation }], W - F.indent) }))
      entries.forEach((e) => measure(fonts, `${e.number}.`, PRINT_TYPE.citation))
      const hOf = (i: number, first: boolean) => entries[i].lines.length * lh + (first ? 0 : F.itemGap)
      return {
        id: node.id, primitive: node.primitive, before: F.before, after: F.after, units: entries.length,
        height: (from, to) => { let h = 0; for (let i = from; i < to; i++) h += hOf(i, i === from); return h },
        canBreakAfter: () => true,
        keepTail: 0,
        keepReason: 'Each source entry kept whole',
        build: (from, to) => ({ primitive: 'source-list', entries: entries.slice(from, to).map((e, k) => ({ ...e, gapBefore: k === 0 ? 0 : F.itemGap })) }),
      }
    }

    case 'page-break-hint':
    case 'page-footer':
      return null
  }
}

// ── Tables (generic and invoice line items) ──────────────────────────────────

type TableNode = Extract<PlanNode, { primitive: 'table' | 'invoice-line-items' }>

function measureTable(node: TableNode, ctx: MeasureContext): MeasuredBlock {
  const { fonts, contentWidth: W } = ctx
  const padX = TABLE.cellPaddingXPt, padY = TABLE.cellPaddingYPt
  const F = FLOW.table

  // Normalise both node types to header labels + typed cell values.
  const columns: { label: string; align: 'start' | 'end'; numeric: boolean }[] = node.primitive === 'table'
    ? node.columns.map((c: TableColumn) => ({ label: c.label, align: c.align, numeric: c.numeric }))
    : [
      { label: node.headers.description, align: 'start', numeric: false },
      { label: node.headers.quantity, align: 'end', numeric: true },
      { label: node.headers.unitPrice, align: 'end', numeric: true },
      { label: node.headers.amount, align: 'end', numeric: true },
    ]
  const rowsIn: { id: string; values: PlanValue[] }[] = node.primitive === 'table'
    ? node.rows.map((r) => ({ id: r.id, values: r.cells.map((c, i) => ({ kind: 'text', text: c, style: columns[i]?.numeric ? 'amount' : 'tableText' }) as PlanValue) }))
    : node.rows.map((r) => ({ id: r.id, values: [r.description, { kind: 'text', text: r.quantity, style: 'amount' }, r.unitPrice, r.amount] }))
  const captionText = node.primitive === 'table' ? node.caption : node.currencyNote
  const caption = captionText
    ? breakLines(fonts, [{ text: captionText, style: PRINT_TYPE.label }, ...(node.primitive === 'table' && node.citations.length ? [{ text: citationMarker(node.citations), style: PRINT_TYPE.citation }] : [])], W)
    : null
  const captionH = caption ? caption.length * leading(PRINT_TYPE.label) + F.captionGap : 0

  // Numeric/end columns take their widest content (capped); text columns share the rest.
  const cap = W * 0.3
  const widths = columns.map((c, i) => {
    if (!c.numeric) return 0
    const header = naturalWidth(fonts, [{ text: c.label, style: PRINT_TYPE.tableHeader }])
    const widest = Math.max(header, ...rowsIn.map((r) => valueNaturalWidth(fonts, r.values[i])))
    return Math.min(cap, widest + 2 * padX)
  })
  const textCols = columns.filter((c) => !c.numeric).length || 1
  const rest = Math.max(W - widths.reduce((a, b) => a + b, 0), W * 0.25)
  let x = 0
  const layoutCols: ColumnLayout[] = columns.map((c, i) => {
    const width = c.numeric ? widths[i] : rest / textCols
    const col = { x, width, align: c.align, numeric: c.numeric }
    x += width
    return col
  })

  const headerCells = columns.map((c, i) => breakLines(fonts, [{ text: c.label, style: PRINT_TYPE.tableHeader }], layoutCols[i].width - 2 * padX))
  const headerH = Math.max(...headerCells.map((l) => l.length)) * leading(PRINT_TYPE.tableHeader) + 2 * padY + TABLE.headerRuleWidthPt

  // Units: whole rows; a row taller than a page becomes one unit per description line.
  type Unit = { row: number; part: number; parts: number }
  const units: Unit[] = []
  const rows = rowsIn.map((r, ri) => {
    const cells = r.values.map((v, i) => layoutValue(fonts, v, layoutCols[i].width - 2 * padX))
    const h = Math.max(...cells.map((c) => c.height)) + 2 * padY + TABLE.ruleWidthPt
    const descLines = cells[0].kind === 'text' ? cells[0].lines : []
    const tooTall = headerH + h > ctx.maxFragmentHeight
    const parts = tooTall && descLines.length > 1 ? descLines.length : 1
    for (let p = 0; p < parts; p++) units.push({ row: ri, part: p, parts })
    return { id: r.id, cells, height: h, descLines }
  })
  const descLh = leading(PRINT_TYPE.tableText)
  const continuedLabelH = leading(PRINT_TYPE.label) + SPACE.xxs
  const continuedLabel = breakLines(fonts, [{ text: CONTINUED_ROW_LABEL, style: PRINT_TYPE.label }], layoutCols[0].width - 2 * padX)[0]
  const otherCellsH = (ri: number) => Math.max(0, ...rows[ri].cells.slice(1).map((c) => c.height))

  /** Height of units [from, to) as rows, excluding the header. */
  const bodyHeight = (from: number, to: number) => {
    let h = 0
    let u = from
    while (u < to) {
      const { row, parts } = units[u]
      if (parts === 1) { h += rows[row].height; u++; continue }
      let end = u
      while (end < to && units[end].row === row) end++
      const first = units[u].part === 0
      const lines = end - u
      h += 2 * padY + TABLE.ruleWidthPt + Math.max(lines * descLh + (first ? 0 : continuedLabelH), first ? otherCellsH(row) : 0)
      u = end
    }
    return h
  }

  return {
    id: node.id, primitive: node.primitive, before: F.before, after: F.after, units: units.length,
    height: (from, to) => (from === 0 ? captionH : 0) + headerH + bodyHeight(from, to),
    unitsForLastRows: (n) => {
      const firstRow = Math.max(0, rows.length - n)
      return units.filter((u) => u.row >= firstRow).length
    },
    canBreakAfter: () => true,
    keepTail: 0,
    keepReason: 'Table continues; header row repeated',
    build: (from, to) => {
      const out: TableRowLayout[] = []
      let u = from
      while (u < to) {
        const { row, parts } = units[u]
        const r = rows[row]
        if (parts === 1) {
          out.push({ id: r.id, height: r.height, cells: r.cells, continuedFromPrevious: false, continuesOnNext: false, continuedLabel: null })
          u++
          continue
        }
        let end = u
        while (end < to && units[end].row === row) end++
        const first = units[u].part === 0
        const last = units[end - 1].part === parts - 1
        const desc = r.cells[0]
        const lines = desc.kind === 'text' ? desc.lines.slice(units[u].part, units[end - 1].part + 1) : []
        const descCell: ValueLayout = { kind: 'text', style: 'tableText', lines, height: lines.length * descLh }
        out.push({
          id: r.id,
          height: bodyHeight(u, end),
          cells: [descCell, ...r.cells.slice(1).map((c) => (first ? c : null))],
          continuedFromPrevious: !first,
          continuesOnNext: !last,
          continuedLabel: first ? null : continuedLabel,
        })
        u = end
      }
      return { primitive: 'table', caption: from === 0 ? caption : null, columns: layoutCols, header: { cells: headerCells, height: headerH }, rows: out, repeatedHeader: from > 0 }
    },
  }
}
