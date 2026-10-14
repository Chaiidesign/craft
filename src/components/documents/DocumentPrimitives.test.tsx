import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { collectStyledText, composeDocument, PRIMITIVES, type PlanNode } from '@/lib/documents/compose'
import { getFixture } from '@/lib/documents/fixtures'
import type { DocumentSnapshot } from '@/lib/documents/model'

import { DocumentPreview } from './DocumentPreview'
import { PlanNodeView } from './DocumentPrimitives'

const build = (id: string) => {
  const f = getFixture(id)
  if (!f || f.type !== 'document') throw new Error(id)
  return f.build() as DocumentSnapshot
}
const html = (id: string, audience: 'recipient' | 'internal' = 'recipient') =>
  renderToStaticMarkup(<DocumentPreview plan={composeDocument(build(id), { audience })} showHints />)
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('document templates and primitives', () => {
  it('invoice 1: issuer letterhead, exact derived totals, no internal note for the recipient', () => {
    const out = text(html('invoice-complete'))
    expect(out).toContain('Halden & Rowe Studio')
    expect(out).toContain('HRS-2026-0142')
    expect(out).toContain('Discount (5%) -$365.37')
    expect(out).toContain('Tax (8.25%) $572.72')
    expect(out).toContain('Total due $7,514.82')
    expect(out).not.toContain('confirm the workshop hours')
    expect(out).not.toMatch(/draft/i)
    // Issuer-first: no Souvenir branding in the document.
    expect(out).not.toMatch(/souvenir/i)
  })

  it('includes the internal note, labelled, only when asked', () => {
    const out = text(html('invoice-complete', 'internal'))
    expect(out).toContain('Internal note — not in recipient exports')
    expect(out).toContain('confirm the workshop hours')
  })

  it('invoice 2: missing facts sit beside their fields and the total is never final', () => {
    const markup = html('invoice-missing')
    const out = text(markup)
    expect(out).toContain('Due date Missing — Due date')
    expect(out).toContain('Billing address Missing — Billing address')
    expect(out).toContain('Tax Missing — Tax')
    expect(out).toContain('Total Incomplete — not a final amount')
    expect(out).not.toContain('Total due')
    expect(out).toContain('Draft — incomplete')
    expect(markup).toContain('data-field-id="invoice.dueDate"')
    // Unknown tax is not shown as zero.
    expect(out).not.toMatch(/Tax[^A-Za-z]*€0\.00/)
  })

  it('invoice 3: every one of the 42 rows renders, in Indian digit grouping', () => {
    const plan = composeDocument(build('invoice-long'))
    const lines = plan.nodes.find((n) => n.primitive === 'invoice-line-items') as Extract<PlanNode, { primitive: 'invoice-line-items' }>
    expect(lines.rows).toHaveLength(42)
    expect(text(html('invoice-long'))).toMatch(/₹\d{1,2},\d{2},\d{3}\.\d{2}|₹\d,\d{3}\.\d{2}/)
  })

  it('brief: citations beside claims, numbered against a fictional source list', () => {
    const out = text(html('brief-evidence'))
    expect(out).toContain('what members expected Sources [1, 2]')
    expect(out).toContain('Sources')
    expect(out).toContain('(sample source)')
    expect(out).toContain('Northbridge Reader Panel — fictional. July 2026. Table 3')
    expect(out).toContain('Cancellations peak in week 3 (21%)')
    expect(out).toContain('Unit: % of all cancellations')
    expect(out).not.toContain('Internal: check with Lantern')
    expect(out).toContain('Preferred page break')
  })

  it('brand fallbacks are labelled, never an invented mark', () => {
    expect(text(html('brand-no-logo'))).toContain('No logo supplied')
    // The broken file is detected in the browser (img onError); the plan still carries the claimed asset.
    expect(html('brand-broken-logo')).toContain('quillon-mark-missing-file.png')
    expect(text(html('brand-long-name'))).toContain('The Northern Cooperative for Sustainable Textile Manufacturing and Fair-Trade Distribution Ltd.')
  })

  it('empty document explains itself instead of drawing a blank page', () => {
    const out = text(html('empty-document'))
    expect(out).toContain('Nothing to lay out yet')
    expect(html('empty-document')).not.toContain('<article')
  })

  it('places every snapshot block or records why it was left out', () => {
    for (const id of ['invoice-complete', 'invoice-missing', 'invoice-long', 'brief-evidence', 'brand-no-logo']) {
      const snapshot = build(id)
      const plan = composeDocument(snapshot)
      const accounted = new Set([...plan.placedBlockIds, ...plan.excludedBlocks.map((b) => b.blockId)])
      expect(snapshot.blocks.filter((b) => !accounted.has(b.id)).map((b) => b.id), id).toEqual([])
      for (const b of plan.excludedBlocks) expect(b.reason.length, `${id} ${b.blockId}`).toBeGreaterThan(10)
    }
  })

  it('every plan node renders through its primitive, and all 18 PRD primitives exist', () => {
    const seen = new Set<string>()
    for (const id of ['invoice-complete', 'invoice-missing', 'brief-evidence']) {
      for (const node of composeDocument(build(id), { audience: 'internal' }).nodes) {
        seen.add(node.primitive)
        expect(renderToStaticMarkup(<PlanNodeView node={node} showHints />).length, `${id} ${node.primitive}`).toBeGreaterThan(0)
      }
    }
    expect(PRIMITIVES).toHaveLength(18)
    // Table and ImageWithCaption have no fixture block yet; render them directly.
    const table: PlanNode = { primitive: 'table', id: 't', caption: 'Sample table', columns: [{ id: 'a', label: 'Item', align: 'start', numeric: false }, { id: 'b', label: 'Share', align: 'end', numeric: true }], rows: [{ id: 'r', cells: ['Week 1', '9'] }], citations: [1] }
    const image: PlanNode = { primitive: 'image-with-caption', id: 'i', asset: { assetId: 'a', src: '/document-fixtures/halden-rowe-mark.png', alt: 'Mark', widthPx: 240, heightPx: 240 }, caption: 'Sample caption', citations: [] }
    expect(text(renderToStaticMarkup(<PlanNodeView node={table} />))).toContain('Item Share Week 1 9')
    expect(renderToStaticMarkup(<PlanNodeView node={image} />)).toContain('<figcaption')
  })

  it('the glyph-check inventory covers every word the preview draws', () => {
    // Screen-reader-only words (citation and totals captions) are not drawn.
    const srOnly = new Set(['Sources', 'Totals', '(incomplete)'])
    const words = (t: string) => t.split(/\s+/).filter(Boolean)
    for (const id of ['invoice-complete', 'invoice-missing', 'invoice-long', 'brief-evidence', 'brand-no-logo', 'brand-broken-logo']) {
      for (const audience of ['recipient', 'internal'] as const) {
        const plan = composeDocument(build(id), { audience })
        const inventory = new Set(collectStyledText(plan).flatMap(({ text: t }) => words(t)))
        const drawn = words(text(renderToStaticMarkup(<DocumentPreview plan={plan} />)))
        expect(drawn.filter((w) => !inventory.has(w) && !srOnly.has(w)), `${id} ${audience}`).toEqual([])
      }
    }
  })
})
