// Pagination by meaning (PRD §8). Places measured blocks onto pages of the
// plan's preset, honouring keep-with-next (headings), keep-together blocks,
// orphan/widow control, repeated table headers, totals kept with their last
// rows, preferred section breaks, running headers and "Page n of N" footers.
// Every page break records why it happened. Content that cannot fit even an
// empty page is an explicit error — nothing is clipped or shrunk.

import type { DocumentPlan, PlanNode } from '../compose'
import { MissingGlyphError, type FontSet } from '../metrics'
import { contentWidthPt, FLOW, KEEP, PAGE, PAGE_SIZES, PRINT_TYPE, TABLE } from '../tokens'
import { LayoutTooTallError, leading, measureNode, type FragmentBody, type MeasuredBlock } from './blocks'
import { measure, type Line } from './text'

export interface PlacedFragment {
  /** `${nodeId}#${index}` — unique per fragment. */
  key: string
  nodeId: string
  primitive: PlanNode['primitive']
  y: number
  height: number
  body: FragmentBody
  /** True when this fragment continues a block started on an earlier page. */
  continued: boolean
}

export interface PageLayout {
  number: number
  widthPt: number
  heightPt: number
  content: { x: number; y: number; width: number; height: number }
  /** Pages 2+: issuer and document identification (and draft state). */
  runningHeader: { lines: Line[]; y: number; height: number } | null
  footer: { identification: Line; pageLabel: Line; y: number }
  fragments: PlacedFragment[]
  /** Why this page began (absent on page 1). */
  breakReason?: string
  /** Space left unused at the foot of the content area. */
  freePt: number
}

export type LayoutError =
  | { kind: 'missing-glyph'; nodeId: string; message: string; characters: readonly string[]; face: string }
  | { kind: 'too-tall'; nodeId: string; message: string }

export type PagedDocument =
  | { status: 'ok'; preset: keyof typeof PAGE_SIZES; pages: PageLayout[] }
  | { status: 'error'; preset: keyof typeof PAGE_SIZES; error: LayoutError }
  | { status: 'empty'; preset: keyof typeof PAGE_SIZES }

export interface PaginateOptions {
  /** Asset `src`s that failed to load; their primitives use the labelled fallback. */
  unavailableAssets?: ReadonlySet<string>
  /** Override the plan's page preset (A4 / Letter comparison). */
  preset?: keyof typeof PAGE_SIZES
}

const FOOTER_LH = leading(PRINT_TYPE.footer)
const HEADER_H = FOOTER_LH + FLOW.runningHeader.gap + TABLE.ruleWidthPt + FLOW.runningHeader.after

/** Shorten text with an ellipsis until it fits `width` — by measured width, never character count. */
function fitLine(fonts: FontSet, text: string, width: number): Line {
  const s = PRINT_TYPE.footer
  let t = text
  if (measure(fonts, t, s) > width) {
    const chars = [...text]
    while (chars.length && measure(fonts, `${chars.join('').trimEnd()}…`, s) > width) chars.pop()
    t = `${chars.join('').trimEnd()}…`
  }
  return { segments: [{ text: t, style: s, width: measure(fonts, t, s) }], width: measure(fonts, t, s) }
}

export function paginate(plan: DocumentPlan, fonts: FontSet, options: PaginateOptions = {}): PagedDocument {
  const preset = options.preset ?? (plan.layoutPreset === 'slide-16x9' ? 'a4-portrait' : plan.layoutPreset)
  if (plan.empty) return { status: 'empty', preset }
  const track = { nodeId: '' }
  try {
    return { status: 'ok', preset, pages: layoutPages(plan, fonts, preset, options.unavailableAssets ?? new Set(), track) }
  } catch (e) {
    if (e instanceof LayoutTooTallError) return { status: 'error', preset, error: { kind: 'too-tall', nodeId: e.nodeId, message: e.message } }
    if (e instanceof MissingGlyphError) {
      return { status: 'error', preset, error: { kind: 'missing-glyph', nodeId: track.nodeId, message: `${e.message}. Export and preview are refused rather than substituting a character or face.`, characters: e.characters, face: e.face } }
    }
    throw e
  }
}

/** Content-area geometry for a preset: page 1, and pages 2+ (which carry the running header). */
export function pageGeometry(preset: keyof typeof PAGE_SIZES) {
  const size = PAGE_SIZES[preset]
  const m = PAGE.marginPt
  const footerY = size.heightPt - m.bottom - FOOTER_LH
  const firstHeight = footerY - PAGE.footerClearancePt - m.top
  return { size, width: contentWidthPt(preset), footerY, firstHeight, laterHeight: firstHeight - HEADER_H }
}

function layoutPages(plan: DocumentPlan, fonts: FontSet, preset: keyof typeof PAGE_SIZES, unavailableAssets: ReadonlySet<string>, track: { nodeId: string }): PageLayout[] {
  const { size, width: W, footerY, firstHeight, laterHeight } = pageGeometry(preset)
  const m = PAGE.marginPt

  const footerNode = plan.nodes.find((n): n is Extract<PlanNode, { primitive: 'page-footer' }> => n.primitive === 'page-footer')
  const draft = plan.nodes.find((n): n is Extract<PlanNode, { primitive: 'title-block' }> => n.primitive === 'title-block')?.draft ?? null
  const identification = footerNode?.identification ?? ''

  // Measure. Page-break hints stay in sequence as markers.
  type Item = { kind: 'block'; block: MeasuredBlock } | { kind: 'hint'; id: string }
  const items: Item[] = []
  for (const node of plan.nodes) {
    track.nodeId = node.id
    if (node.primitive === 'page-break-hint') { items.push({ kind: 'hint', id: node.id }); continue }
    const block = measureNode(node, { fonts, contentWidth: W, maxFragmentHeight: laterHeight, unavailableAssets })
    if (block) items.push({ kind: 'block', block })
  }
  // A block that must stay with its predecessor makes the predecessor keep its whole tail with it
  // (invoice payment terms with the totals).
  items.forEach((item, i) => {
    const next = items[i + 1]
    if (item.kind === 'block' && next?.kind === 'block' && next.block.keepWithPrevious) {
      const reason = `${next.block.id === 'payment' ? 'Payment terms' : 'Following block'} kept with the ${item.block.primitive === 'totals' ? 'totals' : 'block before it'}`
      item.block = { ...item.block, keepTail: Math.max(item.block.keepTail, Math.min(1, item.block.units)), keepReason: item.block.units === 1 ? reason : item.block.keepReason, tailReason: reason }
    }
  })

  // Line items keep their last whole rows with the totals that follow them — as many of the
  // KEEP.rowsWithTotals rows as can physically share a page with the totals. If not even the
  // last row can, the totals start a page and say why (the running header still identifies
  // the invoice).
  items.forEach((item, i) => {
    const next = items[i + 1]
    if (item.kind === 'block' && item.block.primitive === 'invoice-line-items' && next?.kind === 'block' && next.block.primitive === 'totals') {
      const lines = item.block
      const gap = Math.max(lines.after, next.block.before)
      // The totals carry whatever must stay with them (payment terms).
      const after = items[i + 2]
      const totalsH = next.block.height(0, 1) + (next.block.keepTail > 0 && after?.kind === 'block' ? Math.max(next.block.after, after.block.before) + after.block.height(0, after.block.units) : 0)
      const unitsFor = (n: number) => lines.unitsForLastRows?.(n) ?? Math.min(n, lines.units)
      let n = Math.min(KEEP.rowsWithTotals, lines.units)
      while (n > 0 && lines.height(lines.units - unitsFor(n), lines.units) + gap + totalsH > laterHeight + 1e-6) n--
      if (n > 0) {
        item.block = { ...lines, keepTail: unitsFor(n), tailReason: `Last ${n} line-item row${n === 1 ? '' : 's'} moved to keep the totals with them` }
      } else {
        next.block = { ...next.block, keepReason: 'Totals start this page: the last line-item row and the totals together are taller than a page' }
      }
    }
  })

  const pages: Omit<PageLayout, 'footer'>[] = []
  let page!: Omit<PageLayout, 'footer'>
  let y = 0
  let prevAfter = 0
  const openPage = (reason?: string) => {
    const number = pages.length + 1
    const height = number === 1 ? firstHeight : laterHeight
    page = {
      number, widthPt: size.widthPt, heightPt: size.heightPt,
      content: { x: m.left, y: number === 1 ? m.top : m.top + HEADER_H, width: W, height },
      runningHeader: null, fragments: [], breakReason: reason, freePt: height,
    }
    pages.push(page)
    y = 0
    prevAfter = 0
  }
  openPage()

  const gapBefore = (block: MeasuredBlock) => (page.fragments.length === 0 ? 0 : Math.max(prevAfter, block.before))
  const remaining = () => page.content.height - y

  /** Smallest first fragment of a block: up to and including its first permitted break. */
  const minFirst = (block: MeasuredBlock): number => {
    for (let k = 1; k <= block.units; k++) if (k === block.units || block.canBreakAfter(k - 1)) return block.height(0, k)
    return block.height(0, block.units)
  }
  const nextBlock = (i: number): MeasuredBlock | null => {
    for (let j = i + 1; j < items.length; j++) { const it = items[j]; if (it.kind === 'block') return it.block }
    return null
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'hint') {
      if (page.fragments.length && remaining() < KEEP.preferredBreakMinSpacePt) openPage(`Preferred section break: under ${KEEP.preferredBreakMinSpacePt}pt left on the page`)
      continue
    }
    const block = item.block
    track.nodeId = block.id
    const next = nextBlock(i)
    // What must follow this block's tail on the same page.
    // What must follow this block's tail on the same page, following chains of kept blocks
    // (line items → totals → payment terms).
    const chainAfter = (index: number): number => {
      const cur = items[index]
      if (cur?.kind !== 'block' || cur.block.keepTail === 0) return 0
      let j = index + 1
      while (j < items.length && items[j].kind !== 'block') j++
      const nxt = items[j]
      if (nxt?.kind !== 'block') return 0
      const first = minFirst(nxt.block)
      const whole = first === nxt.block.height(0, nxt.block.units)
      return Math.max(cur.block.after, nxt.block.before) + first + (whole ? chainAfter(j) : 0)
    }
    // Keeping rows with the totals is for a table that needs more than one page. A table that fits
    // whole on the page where it starts stays whole, and the totals follow on the next page if they
    // must (designer decision, Session 3).
    const wholeTableFits = (b: MeasuredBlock) => b.primitive === 'invoice-line-items' && b.height(0, b.units) <= remaining() - gapBefore(b) + 1e-6
    const reserveFor = (b: MeasuredBlock) => (next && b.keepTail > 0 && !wholeTableFits(b) ? chainAfter(i) : 0)

    let from = 0
    let continued = false
    let fragmentIndex = 0
    while (from < block.units) {
      const gap = gapBefore(block)
      const avail = remaining() - gap
      const all = block.height(from, block.units)
      const reserve = reserveFor(block)

      let to: number
      let tailMoved = false
      if (all + reserve <= avail + 1e-6) {
        to = block.units
      } else {
        // Largest permitted break that fits. The kept tail (a heading; the last rows before the
        // totals) never ends up separated from what follows it.
        const best = (limit: number) => {
          for (let k = Math.min(limit, block.units - 1); k > from; k--) {
            if (block.canBreakAfter(k - 1) && block.height(from, k) <= avail + 1e-6) return k
          }
          return from
        }
        to = best(block.units - Math.max(1, block.keepTail))
        tailMoved = block.keepTail > 0 && best(block.units - 1) > to
        if (to === from) {
          if (page.fragments.length === 0) {
            // Nothing fits on an empty page: take the smallest permitted fragment if it fits, else fail.
            const k = Array.from({ length: block.units - from }, (_, d) => from + d + 1).find((k2) => k2 === block.units || block.canBreakAfter(k2 - 1))!
            if (block.height(from, k) > page.content.height + 1e-6) throw new LayoutTooTallError(block.id, block.height(from, k), page.content.height)
            to = k
          } else {
            const lastHere = page.fragments[page.fragments.length - 1]
            const reason = block.primitive === 'totals' && lastHere?.primitive === 'invoice-line-items' && from === 0
              ? 'Totals start this page: the whole table fits on the page before, and the totals with what follows them do not'
              : tailMoved
              ? block.tailReason ?? 'Kept with the next block'
              : block.units === 1
                ? block.keepReason ?? 'Kept together; it did not fit the space left'
                : block.keepReason ?? 'Page full'
            openPage(reason)
            continue
          }
        }
      }

      const h = block.height(from, to)
      page.fragments.push({ key: `${block.id}#${fragmentIndex++}`, nodeId: block.id, primitive: block.primitive, y: y + gap, height: h, body: block.build(from, to), continued })
      y += gap + h
      prevAfter = block.after
      page.freePt = remaining()
      from = to
      if (from < block.units) {
        openPage(tailMoved ? block.tailReason ?? 'Kept with the next block' : block.keepReason ?? 'Page full')
        continued = true
      }
    }
  }

  // Running headers, footers and page numbers now that N is known.
  const total = pages.length
  const headerText = `${identification}${draft ? ` · ${draft}` : ''}`
  return pages.map((p) => {
    const pageLabelText = (footerNode?.pageLabel ?? 'Page {n} of {total}').replace('{n}', String(p.number)).replace('{total}', String(total))
    const pageLabel = fitLine(fonts, pageLabelText, W)
    const id = fitLine(fonts, identification, W - pageLabel.width - FLOW.letterhead.gap)
    return {
      ...p,
      runningHeader: p.number === 1 ? null : { lines: [fitLine(fonts, headerText, W)], y: m.top, height: HEADER_H },
      footer: { identification: id, pageLabel, y: footerY },
    }
  })
}
