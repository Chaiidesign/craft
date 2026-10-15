// Word renderer (docx). Editable native content built from the same plan the
// preview and PDF use: real paragraphs, runs and tables, the theme's fonts
// named exactly as their TTF name tables say and embedded in the file.
//
// Word lays pages out itself, so the engine's page breaks are passed on as
// Word's own rules rather than imposed: headings keep with next, paragraphs use
// widow control (two lines each side), table rows don't split (except a row
// taller than a page), header rows repeat, the last two line-item rows and the
// totals keep with what follows them, and payment terms stay with the totals.
// Where Word breaks pages differently from the PDF, that is recorded, not
// hidden. Column widths and the totals box come from the engine's layout.
//
// Weights are separate families in these TTFs (e.g. "… SemiBold", "… Medm"),
// so runs name the face's family and never set bold — Word would fake it.

import type { PlanNode, PlanRun, PlanValue } from '../compose'
import { citationMarker, missingText } from '../compose'
import { leading } from '../layout/blocks'
import type { ColumnLayout } from '../layout/blocks'
import type { DeckSnapshot, DocumentSnapshot } from '../model'
import { BRAND, CHART, FLOW, PAGE, PAGE_SIZES, PRINT_TYPE, SPACE, STATE_COLOURS, TABLE, type PrintTypeKey, type TextStyle } from '../tokens'
import { chartPlotSvg } from './chartSvg'
import { layoutForExport } from './pdf'
import { unavailableAssets, type ExportResources } from './resources'

export interface DocxMetadata {
  title: string
  subject: string
}

export interface DocxRender {
  bytes: Uint8Array
  /** Engine page count for the same revision (the PDF's), for the report; Word may differ. */
  enginePages: number
  /** Font families the file names and embeds, each with the faces embedded. */
  embeddedFonts: { family: string; regular: string; italic?: string }[]
}

type Docx = typeof import('docx')

const twip = (pt: number) => Math.round(pt * 20)
/** Word's running header sits in the top margin, this far from the page edge (it ends above the body). */
export const WORD_HEADER_FROM_EDGE_PT = 24
const hex = (c: string) => c.replace('#', '').toUpperCase()
const PX = 96 / 72

export async function renderDocx(snapshot: Exclude<DocumentSnapshot, DeckSnapshot>, resources: ExportResources, meta: DocxMetadata): Promise<DocxRender> {
  const d: Docx = await import('docx')
  const { fonts } = resources
  const unavailable = unavailableAssets(snapshot, resources)
  // The same composition and layout as the PDF: anything the engine refuses is refused here too.
  const { plan, paged } = layoutForExport(snapshot, fonts, unavailable)
  const palette = plan.palette
  const preset = PAGE_SIZES[paged.preset]
  const m = PAGE.marginPt
  const contentWidth = preset.widthPt - m.left - m.right

  // Engine column widths per table node, and which rows the engine had to split.
  const columnsOf = new Map<string, ColumnLayout[]>()
  const splitRows = new Set<string>()
  let totalsBox: { x: number; width: number; labelWidth: number } | null = null
  for (const page of paged.pages) {
    for (const f of page.fragments) {
      if (f.body.primitive === 'table') {
        if (!columnsOf.has(f.nodeId)) columnsOf.set(f.nodeId, f.body.columns)
        for (const r of f.body.rows) if (r.continuesOnNext || r.continuedFromPrevious) splitRows.add(r.id)
      }
      if (f.body.primitive === 'totals') totalsBox = { x: f.body.x, width: f.body.width, labelWidth: f.body.labelWidth }
    }
  }

  // ── Fonts ──
  const faceOf = (s: TextStyle) => fonts.face(s.role, s.weight, s.style).face
  const familyOf = (s: TextStyle) => faceOf(s).nameTable.family
  const embedded = new Map<string, { family: string; regular?: Uint8Array; italic?: Uint8Array; files: { regular?: string; italic?: string } }>()
  for (const face of fonts.theme.faces) {
    const bytes = resources.fontBytes.get(face.file)
    if (!bytes) throw new Error(`Font bytes missing for ${face.file}`)
    const entry = embedded.get(face.nameTable.family) ?? { family: face.nameTable.family, files: {} }
    if (face.nameTable.subfamily === 'Italic') { entry.italic = bytes; entry.files.italic = face.file } else { entry.regular = bytes; entry.files.regular = face.file }
    embedded.set(face.nameTable.family, entry)
  }

  // ── Runs and paragraphs ──
  type RunOpts = { colour?: string; shading?: string; border?: string }
  const run = (text: string, s: TextStyle, o: RunOpts = {}) => new d.TextRun({
    text,
    font: familyOf(s),
    size: Math.round(s.sizePt * 2),
    italics: faceOf(s).nameTable.subfamily === 'Italic',
    bold: false,
    allCaps: s.uppercase || undefined,
    characterSpacing: s.letterSpacingEm ? twip(s.letterSpacingEm * s.sizePt) : undefined,
    color: hex(o.colour ?? palette.ink),
    shading: o.shading ? { type: d.ShadingType.CLEAR, color: 'auto', fill: hex(o.shading) } : undefined,
    border: o.border ? { style: d.BorderStyle.DASHED, size: 4, color: hex(o.border), space: 1 } : undefined,
  })
  /** Text with explicit line breaks (multi-line field values). */
  const runsOf = (text: string, s: TextStyle, o: RunOpts = {}) => text.split('\n').map((t, i) => (i === 0 ? run(t, s, o) : new d.TextRun({ text: t, break: 1, font: familyOf(s), size: Math.round(s.sizePt * 2), color: hex(o.colour ?? palette.ink) })))
  const planRuns = (runs: readonly PlanRun[], base: TextStyle, emphasis: TextStyle) => runs.flatMap((r) => [
    run(r.text, r.emphasis ? emphasis : base),
    ...(r.citations.length ? [run(citationMarker(r.citations), PRINT_TYPE.citation, { colour: palette.muted })] : []),
  ])

  type ParaOpts = {
    before?: number; after?: number; keepNext?: boolean; keepLines?: boolean; indentLeft?: number; hanging?: number
    align?: 'start' | 'end'; borderLeft?: { colour: string; size: number }; borderBottom?: { colour: string; size: number }; shading?: string; heading?: 1 | 2 | 3; tabsRight?: number
  }
  const para = (children: InstanceType<Docx['TextRun']>[] | (InstanceType<Docx['TextRun']> | InstanceType<Docx['ImageRun']>)[], lineStyle: TextStyle, o: ParaOpts = {}) => new d.Paragraph({
    children,
    spacing: { before: twip(o.before ?? 0), after: twip(o.after ?? 0), line: twip(leading(lineStyle)), lineRule: d.LineRuleType.EXACT },
    keepNext: o.keepNext || undefined,
    keepLines: o.keepLines || undefined,
    widowControl: true,
    alignment: o.align === 'end' ? d.AlignmentType.RIGHT : d.AlignmentType.LEFT,
    indent: o.indentLeft || o.hanging ? { left: twip(o.indentLeft ?? 0), hanging: o.hanging ? twip(o.hanging) : undefined } : undefined,
    border: {
      ...(o.borderLeft ? { left: { style: d.BorderStyle.SINGLE, size: o.borderLeft.size, color: hex(o.borderLeft.colour), space: 8 } } : {}),
      ...(o.borderBottom ? { bottom: { style: d.BorderStyle.SINGLE, size: o.borderBottom.size, color: hex(o.borderBottom.colour), space: 4 } } : {}),
    },
    shading: o.shading ? { type: d.ShadingType.CLEAR, color: 'auto', fill: hex(o.shading) } : undefined,
    heading: o.heading === 1 ? d.HeadingLevel.HEADING_1 : o.heading === 2 ? d.HeadingLevel.HEADING_2 : o.heading === 3 ? d.HeadingLevel.HEADING_3 : undefined,
    tabStops: o.tabsRight ? [{ type: d.TabStopType.RIGHT, position: twip(o.tabsRight) }] : undefined,
  })

  /** Vertical space between blocks that Word cannot express as paragraph spacing (around tables). */
  const spacers = new Set<object>()
  const spacer = (pt: number, keepNext = false) => track(new d.Paragraph({ keepNext: keepNext || undefined, spacing: { before: 0, after: 0, line: twip(pt), lineRule: d.LineRuleType.EXACT }, children: [new d.TextRun({ text: '', size: 2 })] }))
  const track = <T extends object>(p: T): T => { spacers.add(p); return p }

  /** A value: text, an explicit Missing state, or an Unknown amount with its reasons. */
  const valueParas = (v: PlanValue, o: ParaOpts = {}) => {
    if (v.kind === 'text') return [para(runsOf(v.text, PRINT_TYPE[v.style]), PRINT_TYPE[v.style], o)]
    if (v.kind === 'missing') return [para([run(missingText(v), PRINT_TYPE.label, { colour: STATE_COLOURS.missingInk, shading: STATE_COLOURS.missingFill, border: STATE_COLOURS.missingRule })], PRINT_TYPE.label, o)]
    const out = [para(runsOf(v.text, PRINT_TYPE[v.style], { colour: STATE_COLOURS.unknownInk }), PRINT_TYPE[v.style], o)]
    if (v.reasons.length) out.push(para([run(v.reasons.join(' '), PRINT_TYPE.label, { colour: palette.muted })], PRINT_TYPE.label, { ...o, before: SPACE.xxs }))
    return out
  }
  const label = (text: string, o: ParaOpts = {}) => para([run(text, PRINT_TYPE.label, { colour: palette.muted })], PRINT_TYPE.label, o)

  // ── Tables ──
  const none = { style: d.BorderStyle.NONE, size: 0, color: 'auto' }
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
  const cell = (children: InstanceType<Docx['Paragraph']>[], width: number, o: { bottom?: { colour: string; size: number }; top?: { colour: string; size: number }; padX?: number; padY?: number; topPad?: number; padLeft?: number } = {}) => new d.TableCell({
    children: children.length ? children : [new d.Paragraph({})],
    width: { size: twip(width), type: d.WidthType.DXA },
    margins: { left: twip(o.padLeft ?? o.padX ?? 0), right: twip(o.padX ?? 0), top: twip(o.topPad ?? o.padY ?? 0), bottom: twip(o.padY ?? 0) },
    borders: {
      top: o.top ? { style: d.BorderStyle.SINGLE, size: o.top.size, color: hex(o.top.colour) } : none,
      bottom: o.bottom ? { style: d.BorderStyle.SINGLE, size: o.bottom.size, color: hex(o.bottom.colour) } : none,
      left: none, right: none,
    },
  })
  const table = (rows: InstanceType<Docx['TableRow']>[], widths: number[], o: { indent?: number } = {}) => new d.Table({
    rows,
    width: { size: twip(widths.reduce((a, b) => a + b, 0)), type: d.WidthType.DXA },
    columnWidths: widths.map(twip),
    layout: d.TableLayoutType.FIXED,
    borders: noBorders,
    indent: o.indent ? { size: twip(o.indent), type: d.WidthType.DXA } : undefined,
  })
  /** Eighths of a point, for border sizes. */
  const eighths = (pt: number) => Math.max(2, Math.round(pt * 8))

  // ── Images ──
  const imageRun = (src: string, widthPt: number, heightPt: number, alt: string) => {
    const img = resources.images.get(src)!
    return new d.ImageRun({ type: img.type === 'png' ? 'png' : 'jpg', data: img.bytes, transformation: { width: Math.round(widthPt * PX), height: Math.round(heightPt * PX) }, altText: { name: alt, description: alt, title: alt } })
  }

  const body: (InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>)[] = []
  const nodes = plan.nodes
  for (let i = 0; i < nodes.length; i++) {
    const node: PlanNode = nodes[i]
    const next = nodes[i + 1]
    switch (node.primitive) {
      case 'letterhead': {
        const logoW = BRAND.logoMaxWidthPt
        const logo = node.logo.kind === 'image' && !unavailable.has(node.logo.asset.src)
          ? (() => {
            const a = node.logo.asset
            const aspect = a.widthPx / a.heightPx
            let h = BRAND.logoMaxHeightPt, w = h * aspect
            if (w > BRAND.logoMaxWidthPt) { w = BRAND.logoMaxWidthPt; h = w / aspect }
            return para([imageRun(a.src, w, h, a.alt)], PRINT_TYPE.issuerName, {})
          })()
          : label(node.logo.kind === 'image' ? node.logo.brokenNote : node.logo.note, { shading: STATE_COLOURS.paper })
        const issuer = para([run(node.issuerName, PRINT_TYPE.issuerName)], PRINT_TYPE.issuerName)
        body.push(new d.Table({
          rows: [new d.TableRow({ cantSplit: true, children: [cell([logo], logoW, { bottom: { colour: node.accent, size: eighths(BRAND.accentRulePt) }, padY: FLOW.letterhead.paddingBottom / 2 }), cell([issuer], contentWidth - logoW, { bottom: { colour: node.accent, size: eighths(BRAND.accentRulePt) }, padY: FLOW.letterhead.paddingBottom / 2, padX: FLOW.letterhead.gap / 2 })] })],
          width: { size: twip(contentWidth), type: d.WidthType.DXA },
          columnWidths: [twip(logoW), twip(contentWidth - logoW)],
          layout: d.TableLayoutType.FIXED,
          borders: noBorders,
        }))
        break
      }
      case 'title-block': {
        const F = FLOW.titleBlock
        if (node.draft) body.push(para([run(node.draft, PRINT_TYPE.draftMarker, { colour: STATE_COLOURS.missingInk, shading: STATE_COLOURS.missingFill })], PRINT_TYPE.draftMarker, { before: F.paddingTop, keepNext: true }))
        body.push(...valueParas(node.title, { before: node.draft ? F.draftGap : F.paddingTop, keepNext: true, heading: 1 }))
        const entries = [...(node.reference ? [node.reference] : []), ...node.meta]
        if (entries.length) {
          const colW = (contentWidth - (F.metaColumns - 1) * F.metaColumnGap) / F.metaColumns
          const rows: InstanceType<Docx['TableRow']>[] = []
          for (let r = 0; r * F.metaColumns < entries.length; r++) {
            const slice = entries.slice(r * F.metaColumns, r * F.metaColumns + F.metaColumns)
            rows.push(new d.TableRow({ cantSplit: true, children: Array.from({ length: F.metaColumns }, (_, c) => {
              const e = slice[c]
              const w = colW + (c < F.metaColumns - 1 ? F.metaColumnGap : 0)
              return cell(e ? [label(e.label, { after: F.labelGap }), ...valueParas(e.value)] : [], w, { padX: 0, padY: F.metaRowGap / 2 })
            }) }))
          }
          body.push(spacer(F.metaGap))
          body.push(table(rows, Array.from({ length: F.metaColumns }, (_, c) => colW + (c < F.metaColumns - 1 ? F.metaColumnGap : 0))))
        }
        body.push(spacer(F.paddingBottom))
        break
      }
      case 'section-heading':
        body.push(para([run(node.text, PRINT_TYPE.sectionHeading)], PRINT_TYPE.sectionHeading, { before: FLOW.sectionHeading.before, after: FLOW.sectionHeading.after, keepNext: true, keepLines: true, heading: node.level === 3 ? 3 : 2 }))
        break
      case 'summary':
        body.push(para(planRuns(node.runs, PRINT_TYPE.body, PRINT_TYPE.emphasis), PRINT_TYPE.body, { before: FLOW.summary.paddingY, after: FLOW.summary.after + FLOW.summary.paddingY, keepLines: true, indentLeft: FLOW.summary.inset, borderLeft: { colour: palette.accent, size: eighths(BRAND.accentRulePt) } }))
        break
      case 'paragraph':
        body.push(node.role === 'pull-quote'
          ? para(planRuns(node.runs, PRINT_TYPE.pullQuote, PRINT_TYPE.pullQuote), PRINT_TYPE.pullQuote, { before: FLOW.pullQuote.before, after: FLOW.pullQuote.after, indentLeft: FLOW.pullQuote.indent })
          : para(planRuns(node.runs, PRINT_TYPE.body, PRINT_TYPE.emphasis), PRINT_TYPE.body, { after: FLOW.paragraph.after }))
        break
      case 'list':
        node.items.forEach((runs, k) => {
          body.push(para([run(`${node.ordered ? `${k + 1}.` : '•'}\t`, PRINT_TYPE.body), ...planRuns(runs, PRINT_TYPE.body, PRINT_TYPE.emphasis)], PRINT_TYPE.body, {
            before: k === 0 ? 0 : FLOW.list.itemGap, after: k === node.items.length - 1 ? FLOW.list.after : 0, indentLeft: FLOW.list.indent, hanging: FLOW.list.indent,
          }))
        })
        break
      case 'callout':
        if (node.label) body.push(label(node.label, { before: FLOW.callout.before, keepNext: true, indentLeft: FLOW.callout.paddingX }))
        body.push(para(planRuns(node.runs, PRINT_TYPE.body, PRINT_TYPE.emphasis), PRINT_TYPE.body, {
          before: node.label ? FLOW.callout.labelGap : FLOW.callout.before + FLOW.callout.paddingY, after: FLOW.callout.after + FLOW.callout.paddingY, keepLines: true,
          indentLeft: FLOW.callout.paddingX, borderLeft: { colour: node.tone === 'warning' ? STATE_COLOURS.missingRule : palette.rule, size: eighths(BRAND.accentRulePt) },
          shading: node.audience === 'internal' ? STATE_COLOURS.internalFill : undefined,
        }))
        break
      case 'key-value-group': {
        const G = FLOW.keyValueGroup
        const keepNext = next?.primitive === 'key-value-group' && next.keepWithPrevious
        if (node.title) body.push(label(node.title, { after: G.titleGap, keepNext: true }))
        const cols = node.layout === 'stack' ? 1 : 2
        const colW = (contentWidth - (cols - 1) * G.columnGap) / cols
        const ordered = node.layout === 'parties'
          ? Array.from({ length: Math.ceil(node.entries.length / 2) }, (_, r) => [node.entries[r], node.entries[Math.ceil(node.entries.length / 2) + r]]).flat()
          : [...node.entries]
        const rows: InstanceType<Docx['TableRow']>[] = []
        for (let r = 0; r * cols < ordered.length; r++) {
          rows.push(new d.TableRow({ cantSplit: true, children: Array.from({ length: cols }, (_, c) => {
            const e = ordered[r * cols + c]
            const w = colW + (c < cols - 1 ? G.columnGap : 0)
            return cell(e ? [label(e.label, { after: G.labelGap, keepNext: true }), ...valueParas(e.value, { keepNext: node.keepWithPrevious || keepNext })] : [], w, { padY: G.rowGap / 2 })
          }) }))
        }
        body.push(table(rows, Array.from({ length: cols }, (_, c) => colW + (c < cols - 1 ? G.columnGap : 0))))
        body.push(spacer(G.after))
        break
      }
      case 'table':
      case 'invoice-line-items': {
        const cols = columnsOf.get(node.id)
        if (!cols) throw new Error(`No engine layout for table ${node.id}`)
        const padX = TABLE.cellPaddingXPt, padY = TABLE.cellPaddingYPt
        const caption = node.primitive === 'table' ? node.caption : node.currencyNote
        if (caption) {
          body.push(para([run(caption, PRINT_TYPE.label, { colour: palette.muted }), ...(node.primitive === 'table' && node.citations.length ? [run(citationMarker(node.citations), PRINT_TYPE.citation, { colour: palette.muted })] : [])], PRINT_TYPE.label, { after: FLOW.table.captionGap, keepNext: true }))
        }
        const headers = node.primitive === 'table' ? node.columns.map((c) => c.label) : [node.headers.description, node.headers.quantity, node.headers.unitPrice, node.headers.amount]
        const values: { id: string; cells: PlanValue[] }[] = node.primitive === 'table'
          ? node.rows.map((r) => ({ id: r.id, cells: r.cells.map((c, k) => ({ kind: 'text', text: c, style: cols[k].numeric ? 'amount' : 'tableText' }) as PlanValue) }))
          : node.rows.map((r) => ({ id: r.id, cells: [r.description, { kind: 'text', text: r.quantity, style: 'amount' }, r.unitPrice, r.amount] }))
        // The last rows keep with the totals that follow (as many as the engine kept: KEEP.rowsWithTotals).
        const keepTail = node.primitive === 'invoice-line-items' && next?.primitive === 'totals' ? 2 : 0
        const rows = [
          new d.TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, k) => cell([para([run(h, PRINT_TYPE.tableHeader)], PRINT_TYPE.tableHeader, { align: cols[k].align, keepNext: true })], cols[k].width, { padX, padY, bottom: { colour: palette.ink, size: eighths(TABLE.headerRuleWidthPt) } })) }),
          ...values.map((r, ri) => new d.TableRow({
            cantSplit: !splitRows.has(r.id),
            children: r.cells.map((v, k) => cell(valueParas(v, { align: cols[k].align, keepNext: ri >= values.length - keepTail }), cols[k].width, { padX, padY, bottom: { colour: palette.rule, size: eighths(TABLE.ruleWidthPt) } })),
          })),
        ]
        body.push(table(rows, cols.map((c) => c.width)))
        body.push(spacer(FLOW.table.after, keepTail > 0))
        break
      }
      case 'totals': {
        const box = totalsBox ?? { x: contentWidth * (1 - FLOW.totals.minWidthShare), width: contentWidth * FLOW.totals.minWidthShare, labelWidth: contentWidth * FLOW.totals.minWidthShare / 2 }
        const padX = TABLE.cellPaddingXPt, padY = TABLE.cellPaddingYPt
        const keepNext = next?.primitive === 'key-value-group' && next.keepWithPrevious
        const all = [...node.rows.map((r) => ({ ...r, grand: false })), { ...node.grand, grand: true }]
        const rows = all.map((r, ri) => {
          const top = r.grand ? { colour: palette.ink, size: eighths(TABLE.totalsRuleWidthPt) } : undefined
          const topPad = r.grand ? FLOW.totals.grandPaddingTop : padY
          const keep = ri < all.length - 1 || keepNext
          const labelStyle: PrintTypeKey = r.grand ? 'tableHeader' : 'tableText'
          return new d.TableRow({ cantSplit: true, children: [
            cell([para([run(r.label, PRINT_TYPE[labelStyle])], PRINT_TYPE[labelStyle], { keepNext: keep })], box.labelWidth, { padX, padY, topPad, top }),
            cell(valueParas(r.value, { align: 'end', keepNext: keep }), box.width - box.labelWidth, { padX, padY, topPad, top, padLeft: FLOW.totals.columnGap + padX }),
          ] })
        })
        body.push(table(rows, [box.labelWidth, box.width - box.labelWidth], { indent: box.x }))
        body.push(spacer(FLOW.totals.after, keepNext))
        break
      }
      case 'chart-with-data-summary': {
        const C = FLOW.chart
        const plotH = CHART.valueLabelBandPt + CHART.plotHeightPt + CHART.axisLabelBandPt
        body.push(para([run(node.title, PRINT_TYPE.label), ...(node.citations.length ? [run(citationMarker(node.citations), PRINT_TYPE.citation, { colour: palette.muted })] : [])], PRINT_TYPE.label, { after: C.titleGap, keepNext: true }))
        // The picture: the same plot as the PDF, labels as glyph outlines (SVG, with a PNG fallback).
        const svg = chartPlotSvg(node, contentWidth, plotH, palette, resources)
        const scale = 2
        const png = await resources.rasterize(svg, Math.round(contentWidth * PX * scale), Math.round(plotH * PX * scale))
        const alt = `${node.title}. ${node.yLabel} by ${node.xLabel}.`
        body.push(new d.Paragraph({
          keepNext: true,
          spacing: { after: twip(C.noteGap) },
          children: [new d.ImageRun({ type: 'svg', data: new TextEncoder().encode(svg), fallback: { type: 'png', data: png }, transformation: { width: Math.round(contentWidth * PX), height: Math.round(plotH * PX) }, altText: { name: node.title, description: alt, title: node.title } })],
        }))
        body.push(label(node.axesText, { after: C.noteGap, keepNext: true }))
        // The data as an editable table: category and value, in the chart's own labels.
        const points = node.series[0]?.points ?? []
        const values = node.valueLabels[0] ?? []
        const half = contentWidth / 2
        const padX = TABLE.cellPaddingXPt, padY = TABLE.cellPaddingYPt
        body.push(table([
          new d.TableRow({ tableHeader: true, cantSplit: true, children: [node.xLabel, `${node.yLabel}`].map((h, k) => cell([para([run(h, PRINT_TYPE.tableHeader)], PRINT_TYPE.tableHeader, { align: k ? 'end' : 'start', keepNext: true })], half, { padX, padY, bottom: { colour: palette.ink, size: eighths(TABLE.headerRuleWidthPt) } })) }),
          ...points.map((p, k) => new d.TableRow({ cantSplit: true, children: [
            cell([para([run(p.x, PRINT_TYPE.tableText)], PRINT_TYPE.tableText, { keepNext: true })], half, { padX, padY, bottom: { colour: palette.rule, size: eighths(TABLE.ruleWidthPt) } }),
            cell([para([run(values[k] ?? String(p.y), PRINT_TYPE.amount)], PRINT_TYPE.amount, { align: 'end', keepNext: true })], half, { padX, padY, bottom: { colour: palette.rule, size: eighths(TABLE.ruleWidthPt) } }),
          ] })),
        ], [half, half]))
        body.push(para([run(node.dataSummary, PRINT_TYPE.label)], PRINT_TYPE.label, { before: C.noteGap, after: C.after }))
        break
      }
      case 'image-with-caption': {
        const F = FLOW.image
        const available = !unavailable.has(node.asset.src)
        if (available) {
          let w = node.asset.widthPx * 0.75, h = node.asset.heightPx * 0.75
          if (w > contentWidth) { h *= contentWidth / w; w = contentWidth }
          if (h > F.maxHeightPt) { w *= F.maxHeightPt / h; h = F.maxHeightPt }
          body.push(new d.Paragraph({ keepNext: true, children: [imageRun(node.asset.src, w, h, node.asset.alt)] }))
        } else body.push(label(node.brokenNote, { keepNext: true }))
        body.push(para([run(node.caption, PRINT_TYPE.label), ...(node.citations.length ? [run(citationMarker(node.citations), PRINT_TYPE.citation, { colour: palette.muted })] : [])], PRINT_TYPE.label, { before: F.captionGap, after: F.after }))
        break
      }
      case 'source-list':
        node.entries.forEach((e, k) => body.push(para([run(`${e.number}.\t`, PRINT_TYPE.citation), run(e.text, PRINT_TYPE.citation)], PRINT_TYPE.citation, {
          before: k === 0 ? 0 : FLOW.sourceList.itemGap, indentLeft: FLOW.sourceList.indent, hanging: FLOW.sourceList.indent, keepLines: true,
        })))
        break
      case 'page-break-hint':
      case 'page-footer':
        break
    }
  }

  // Space after the last block would only push an empty line onto a new page.
  while (body.length && spacers.has(body[body.length - 1])) body.pop()
  // A Word body cannot end on a table; without this, readers add a full-height empty paragraph.
  if (body[body.length - 1] instanceof d.Table) body.push(new d.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: d.LineRuleType.EXACT }, children: [new d.TextRun({ text: '', size: 2 })] }))

  // ── Page furniture ──
  const footerNode = nodes.find((n): n is Extract<PlanNode, { primitive: 'page-footer' }> => n.primitive === 'page-footer')
  const draft = nodes.find((n): n is Extract<PlanNode, { primitive: 'title-block' }> => n.primitive === 'title-block')?.draft ?? null
  const identification = footerNode?.identification ?? ''
  const pageLabel = footerNode?.pageLabel ?? 'Page {n} of {total}'
  const muted = (t: string) => run(t, PRINT_TYPE.footer, { colour: palette.muted })
  const labelRuns = pageLabel.split(/(\{n\}|\{total\})/).filter(Boolean).map((part) => part === '{n}' || part === '{total}'
    ? new d.TextRun({ children: [part === '{n}' ? d.PageNumber.CURRENT : d.PageNumber.TOTAL_PAGES], font: familyOf(PRINT_TYPE.footer), size: Math.round(PRINT_TYPE.footer.sizePt * 2), color: hex(palette.muted) })
    : muted(part))
  const footer = new d.Footer({ children: [para([muted(identification), muted('\t'), ...labelRuns], PRINT_TYPE.footer, { tabsRight: contentWidth })] })
  const header = new d.Header({ children: [para([muted(`${identification}${draft ? ` · ${draft}` : ''}`)], PRINT_TYPE.footer, { borderBottom: { colour: palette.rule, size: 4 } })] })
  const footerLh = leading(PRINT_TYPE.footer)

  const doc = new d.Document({
    title: meta.title,
    subject: meta.subject,
    creator: 'Document-quality prototype (sample data)',
    description: 'Sample export. Fictional data.',
    fonts: [...embedded.values()].map((e) => ({ name: e.family, data: e.regular as unknown as Buffer, ...(e.italic ? { italic: e.italic as unknown as Buffer } : {}) })),
    styles: { default: { document: { run: { font: familyOf(PRINT_TYPE.body), size: Math.round(PRINT_TYPE.body.sizePt * 2), color: hex(palette.ink) } } } },
    sections: [{
      properties: {
        titlePage: true,
        page: {
          size: { width: twip(preset.widthPt), height: twip(preset.heightPt) },
          // The body starts and ends where the engine's page-1 content area does; the footer sits in
          // the bottom margin and the running header (pages 2+) in the top margin. Word has one
          // margin for every page, so later pages start higher than in the PDF (recorded in the README).
          margin: { top: twip(m.top), right: twip(m.right), bottom: twip(m.bottom + footerLh + PAGE.footerClearancePt), left: twip(m.left), header: twip(WORD_HEADER_FROM_EDGE_PT), footer: twip(m.bottom) },
        },
      },
      // Page 1 has no running header. The schema needs one block in every header part, so it gets an empty paragraph.
      headers: { default: header, first: new d.Header({ children: [new d.Paragraph({})] }) },
      footers: { default: footer, first: footer },
      children: body,
    }],
  })
  const blob = await d.Packer.toBlob(doc)
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    enginePages: paged.pages.length,
    embeddedFonts: [...embedded.values()].map((e) => ({ family: e.family, regular: e.files.regular!, ...(e.files.italic ? { italic: e.files.italic } : {}) })),
  }
}

