import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { composeDocument, PRIMITIVES, type DocumentPlan, type PlanNode } from '@/lib/documents/compose'
import { getFixture } from '@/lib/documents/fixtures'
import { fragmentLines, lineText } from '@/lib/documents/layout/inspect'
import { paginate, type PagedDocument } from '@/lib/documents/layout/paginate'
import type { DocumentSnapshot } from '@/lib/documents/model'
import { nodeFontSet } from '@/lib/documents/testing/nodeFonts'

import { PagedDocumentView } from './DocumentPreview'

const fonts = nodeFontSet()
const build = (id: string) => {
  const f = getFixture(id)
  if (!f || f.type !== 'document') throw new Error(id)
  return f.build() as DocumentSnapshot
}
function renderPlan(plan: DocumentPlan, unavailable: string[] = []) {
  const paged = paginate(plan, fonts, { unavailableAssets: new Set(unavailable) })
  return { plan, paged, markup: renderToStaticMarkup(<PagedDocumentView plan={plan} paged={paged} showHints />) }
}
const render = (id: string, audience: 'recipient' | 'internal' = 'recipient', unavailable: string[] = []) => renderPlan(composeDocument(build(id), { audience }), unavailable)
const text = (markup: string) => markup
  .replace(/<(\w+) class="[^"]*srOnly[^"]*">[^<]*<\/\1>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, '\'')
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')

describe('templates', () => {
  it('place every snapshot block or record why it was left out', () => {
    for (const id of ['invoice-complete', 'invoice-missing', 'invoice-long', 'brief-evidence', 'brand-no-logo']) {
      const snapshot = build(id)
      const plan = composeDocument(snapshot)
      const accounted = new Set([...plan.placedBlockIds, ...plan.excludedBlocks.map((b) => b.blockId)])
      expect(snapshot.blocks.filter((b) => !accounted.has(b.id)).map((b) => b.id), id).toEqual([])
      for (const b of plan.excludedBlocks) expect(b.reason.length, `${id} ${b.blockId}`).toBeGreaterThan(10)
    }
  })
})

describe('paged preview primitives', () => {
  it('invoice 1: issuer letterhead, exact derived totals, page numbers, no internal note for the recipient', () => {
    const out = text(render('invoice-complete').markup)
    expect(out).toContain('Halden & Rowe Studio')
    expect(out).toContain('HRS-2026-0142')
    expect(out).toContain('Discount (5%) -$365.37')
    expect(out).toContain('Tax (8.25%) $572.72')
    expect(out).toContain('Total due $7,514.82')
    expect(out).toContain('Page 1 of 1')
    expect(out).not.toContain('confirm the workshop hours')
    expect(out).not.toMatch(/draft/i)
    expect(out).not.toMatch(/souvenir/i)
  })

  it('includes the internal note, labelled, only when asked', () => {
    const out = text(render('invoice-complete', 'internal').markup)
    expect(out).toContain('Internal note — not in recipient exports')
    expect(out).toContain('confirm the workshop hours')
  })

  it('invoice 2: missing facts sit beside their fields and the total is never final', () => {
    const out = text(render('invoice-missing').markup)
    expect(out).toContain('Due date Missing — Due date')
    expect(out).toContain('Billing address Missing — Billing address')
    expect(out).toContain('Tax Missing — Tax')
    expect(out).toContain('Total Incomplete — not a final amount')
    expect(out).not.toContain('Total due')
    expect(out).toContain('Draft — incomplete')
    expect(out).not.toMatch(/Tax[^A-Za-z]*€0\.00/)
  })

  it('invoice 3: 42 rows over several pages, header repeated, running header and Indian grouping', () => {
    const { paged, markup } = render('invoice-long')
    if (paged.status !== 'ok') throw new Error(paged.status)
    expect(paged.pages.length).toBeGreaterThan(2)
    const out = text(markup)
    expect(out).toContain(`Page ${paged.pages.length} of ${paged.pages.length}`)
    expect(markup.match(/data-row-id="li-/g)?.length).toBe(42)
    expect(markup).toContain('Line items (continued)')
    expect(out).toMatch(/₹\d{1,2},\d{2},\d{3}\.\d{2}/)
    expect(markup.match(/<article/g)?.length).toBe(paged.pages.length)
  })

  it('brief: citations glued to claims and numbered against a fictional source list', () => {
    const out = text(render('brief-evidence').markup)
    expect(out).toMatch(/what members expected \[1, 2\]/)
    expect(out).toContain('(sample source)')
    expect(out).toContain('Northbridge Reader Panel — fictional. July 2026. Table 3')
    expect(out).toContain('Cancellations peak in week 3 (21%)')
    expect(out).toContain('Unit: % of all cancellations')
    expect(out).not.toContain('Internal: check with Lantern')
    expect(out).toMatch(/Page break: Preferred section break/)
  })

  it('brand fallbacks are labelled, never an invented mark', () => {
    expect(text(render('brand-no-logo').markup)).toContain('No logo supplied')
    const broken = render('brand-broken-logo', 'recipient', ['/document-fixtures/quillon-mark-missing-file.png'])
    expect(text(broken.markup)).toContain('Logo could not be loaded')
    expect(broken.markup).not.toContain('quillon-mark-missing-file.png')
    expect(text(render('brand-long-name').markup)).toContain('The Northern Cooperative for Sustainable Textile Manufacturing and Fair-Trade')
  })

  it('empty document explains itself instead of drawing a blank page', () => {
    const { markup } = render('empty-document')
    expect(text(markup)).toContain('Nothing to lay out yet')
    expect(markup).not.toContain('<article')
  })

  it('shows layout errors instead of clipped or substituted output', () => {
    const plan = composeDocument(build('invoice-complete'))
    const paged: PagedDocument = { status: 'error', preset: 'a4-portrait', error: { kind: 'too-tall', nodeId: 'parties', message: 'needs 900pt' } }
    const out = text(renderToStaticMarkup(<PagedDocumentView plan={plan} paged={paged} />))
    expect(out).toContain('cannot fit on a page')
    expect(out).toContain('Nothing was clipped, shrunk or substituted')
  })

  it('the PRD lists 18 primitives and every fragment type renders, including Table and ImageWithCaption', () => {
    expect(PRIMITIVES).toHaveLength(18)
    const kinds = new Set<string>()
    const collect = (r: ReturnType<typeof renderPlan>) => { if (r.paged.status === 'ok') r.paged.pages.forEach((p) => p.fragments.forEach((f) => kinds.add(f.body.primitive))) }
    for (const id of ['invoice-complete', 'invoice-missing', 'brief-evidence']) collect(render(id, 'internal'))
    // No fixture has a generic table or an image block yet: lay out a plan that does.
    const base = composeDocument(build('brief-evidence'))
    const extra: PlanNode[] = [
      { primitive: 'table', id: 't', caption: 'Sample table', columns: [{ id: 'a', label: 'Item', align: 'start', numeric: false }, { id: 'b', label: 'Share', align: 'end', numeric: true }], rows: [{ id: 'r', cells: ['Week 1', '9'] }], citations: [1] },
      { primitive: 'image-with-caption', id: 'i', asset: { assetId: 'a', src: '/document-fixtures/halden-rowe-mark.png', alt: 'Mark', widthPx: 240, heightPx: 240 }, brokenNote: 'Image could not be loaded: Mark', caption: 'Sample caption', citations: [] },
    ]
    const withExtra = renderPlan({ ...base, nodes: [...base.nodes.slice(0, 3), ...extra, ...base.nodes.slice(3)] })
    collect(withExtra)
    expect(text(withExtra.markup)).toContain('Item Share Week 1 9')
    expect(withExtra.markup).toContain('<figcaption')
    expect([...kinds].sort()).toEqual(['chart', 'image', 'key-value-group', 'letterhead', 'list', 'source-list', 'table', 'text', 'title-block', 'totals'])
  })

  it('draws only lines the layout engine measured, so every glyph drawn was checked', () => {
    const BLOCK = /<\/?(?:p|div|td|th|h\d|li|dt|dd|figcaption|footer|header|section|aside|blockquote|article|table|tr|tbody|thead|caption|figure|svg|text|ol|ul|dl)\b[^>]*>/g
    const drawnLines = (markup: string) => markup
      .replace(/<(\w+) class="[^"]*srOnly[^"]*">[^<]*<\/\1>/g, '')
      .replace(/<span[^>]*data-line[^>]*>/g, '\n')
      .replace(BLOCK, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
      .split('\n').map((l) => l.trim()).filter(Boolean)
    for (const id of ['invoice-complete', 'invoice-missing', 'invoice-long', 'brief-evidence', 'brand-no-logo', 'brand-long-name']) {
      for (const audience of ['recipient', 'internal'] as const) {
        const { paged, markup, plan } = render(id, audience)
        if (paged.status !== 'ok') throw new Error(paged.status)
        const engine = new Set<string>()
        const add = (s: string) => engine.add(s.trim())
        for (const p of paged.pages) {
          p.fragments.forEach((f) => fragmentLines(f.body).forEach((l) => add(lineText(l))))
          p.runningHeader?.lines.forEach((l) => add(lineText(l)))
          add(lineText(p.footer.identification))
          add(lineText(p.footer.pageLabel))
          if (p.breakReason) add(`Page break: ${p.breakReason}`)
        }
        // Chart category and value labels are measured by the engine but drawn inside the SVG.
        plan.nodes.forEach((n) => { if (n.primitive === 'chart-with-data-summary') { n.series.forEach((sr) => sr.points.forEach((pt) => add(pt.x))); n.valueLabels.flat().forEach(add) } })
        // List markers are drawn beside their items.
        for (let i = 1; i <= 60; i++) add(`${i}.`)
        add('•')
        expect(drawnLines(markup).filter((l) => !engine.has(l)), `${id} ${audience}`).toEqual([])
      }
    }
  })
})
