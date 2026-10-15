import { describe, expect, it } from 'vitest'

import { composeDocument, type DocumentPlan } from '../compose'
import { FIXTURES } from '../fixtures'
import { item, m, run } from '../fixtures/builders'
import { evidenceBrief } from '../fixtures/brief'
import { completeInvoice } from '../fixtures/invoices'
import type { Block, DocumentSnapshot, InvoiceSnapshot } from '../model'
import { nodeFontSet } from '../testing/nodeFonts'
import { KEEP, PAGE_SIZES } from '../tokens'
import { measureNode, type FragmentBody } from './blocks'
import { contentLines, lineText, valueLines } from './inspect'
import { pageGeometry, paginate, type PageLayout } from './paginate'

const fonts = nodeFontSet()
const PRESETS = Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]

function pagesOf(snapshot: DocumentSnapshot, preset: keyof typeof PAGE_SIZES): { plan: DocumentPlan; pages: PageLayout[] } {
  const plan = composeDocument(snapshot)
  const result = paginate(plan, fonts, { preset })
  if (result.status !== 'ok') throw new Error(`${result.status}: ${result.status === 'error' ? result.error.message : ''}`)
  return { plan, pages: result.pages }
}

/** The PRD §8 invariants, checked on any laid-out document. */
function checkInvariants(plan: DocumentPlan, pages: PageLayout[], preset: keyof typeof PAGE_SIZES, label: string) {
  const geometry = pageGeometry(preset)
  const all = pages.flatMap((p) => p.fragments.map((f) => ({ page: p, f })))
  pages.forEach((p, i) => {
    let bottom = 0
    for (const f of p.fragments) {
      expect(f.y, `${label} p${p.number} ${f.key} overlaps`).toBeGreaterThanOrEqual(bottom - 1e-6)
      bottom = f.y + f.height
    }
    // Nothing below the content area: no cropped cells, nothing lost under the margin.
    expect(bottom, `${label} p${p.number} overflows`).toBeLessThanOrEqual(p.content.height + 1e-6)
    expect(p.content.height).toBeCloseTo(p.number === 1 ? geometry.firstHeight : geometry.laterHeight, 6)
    // Page numbers and document identification on every page; running header on continuations.
    expect(lineText(p.footer.pageLabel)).toBe(`Page ${p.number} of ${pages.length}`)
    expect(p.footer.identification.width + p.footer.pageLabel.width).toBeLessThan(p.content.width)
    expect(p.runningHeader === null, `${label} p${p.number} running header`).toBe(i === 0)
    // No stranded headings.
    const last = p.fragments[p.fragments.length - 1]
    if (last && i < pages.length - 1) expect(last.primitive, `${label} p${p.number} ends on a heading`).not.toBe('section-heading')
    if (i > 0) expect(p.breakReason, `${label} p${p.number} records why it began`).toBeTruthy()
  })

  for (const node of plan.nodes) {
    const block = measureNode(node, { fonts, contentWidth: geometry.width, maxFragmentHeight: geometry.laterHeight, unavailableAssets: new Set() })
    if (!block) continue
    const frags = all.filter(({ f }) => f.nodeId === node.id)
    // Every line, row and item exactly once, in order. Table rows are compared row by row, because a
    // row split across pages carries its numbers on the first part only.
    expect(normalised(frags.map(({ f }) => f.body)), `${label} ${node.id} content`).toEqual(normalised([block.build(0, block.units)]))
    for (const [k, { f }] of frags.entries()) {
      if (f.body.primitive === 'text' && frags.length > 1) expect(f.body.lines.length, `${label} ${node.id} fragment lines`).toBeGreaterThanOrEqual(Math.min(KEEP.orphans, KEEP.widows))
      if (f.body.primitive === 'table') {
        expect(f.body.header.cells.length).toBeGreaterThan(0)
        expect(f.body.repeatedHeader).toBe(k > 0)
        expect(f.body.rows.length, `${label} ${node.id} header alone`).toBeGreaterThan(0)
      }
    }
    if (node.primitive === 'key-value-group' && node.keepWithPrevious) {
      // Payment terms never strand: they sit directly after the totals, on the same page.
      expect(frags).toHaveLength(1)
      const page = frags[0].page
      const idx = page.fragments.indexOf(frags[0].f)
      expect(idx, `${label} ${node.id} alone at the top of a page`).toBeGreaterThan(0)
      expect(page.fragments[idx - 1].primitive, `${label} ${node.id} follows the totals`).toBe('totals')
    }
    if (node.primitive === 'totals') {
      expect(frags).toHaveLength(1)
      const page = frags[0].page
      const idx = page.fragments.indexOf(frags[0].f)
      const before = page.fragments[idx - 1]
      if (page.breakReason?.startsWith('Totals start this page')) {
        // Degraded case: the last row and the totals cannot share any page. Totals open the page.
        expect(idx).toBe(0)
      } else {
        expect(before?.primitive, `${label} totals follow line items on the same page`).toBe('invoice-line-items')
        if (before?.body.primitive === 'table') {
          // The totals follow the end of the last row, never a middle part of it.
          expect(before.body.rows[before.body.rows.length - 1].continuesOnNext).toBe(false)
          // At least KEEP.rowsWithTotals whole rows, unless the engine recorded that fewer fit.
          const rowCount = new Set(all.flatMap(({ f }) => (f.primitive === 'invoice-line-items' && f.body.primitive === 'table' ? f.body.rows.map((r) => r.id) : []))).size
          const degraded = pages.some((p) => /^Last 1 line-item row moved/.test(p.breakReason ?? ''))
          expect(new Set(before.body.rows.map((r) => r.id)).size).toBeGreaterThanOrEqual(degraded ? 1 : Math.min(KEEP.rowsWithTotals, rowCount))
        }
      }
    }
  }
}

function normalised(bodies: FragmentBody[]): unknown {
  if (bodies[0]?.primitive !== 'table') return bodies.flatMap(contentLines)
  const byRow = new Map<string, { description: string[]; rest: string[] }>()
  for (const body of bodies) {
    if (body.primitive !== 'table') continue
    for (const row of body.rows) {
      const entry = byRow.get(row.id) ?? { description: [], rest: [] }
      entry.description.push(...valueLines(row.cells[0]).map(lineText))
      row.cells.slice(1).forEach((c) => entry.rest.push(...valueLines(c).map(lineText)))
      byRow.set(row.id, entry)
    }
  }
  return [...byRow]
}

function withLineItems(snapshot: InvoiceSnapshot, items: InvoiceSnapshot['blocks'][number] extends never ? never : ReturnType<typeof item>[]): InvoiceSnapshot {
  return { ...snapshot, blocks: snapshot.blocks.map((b) => (b.type === 'line-items' ? { ...b, items } : b)) }
}

const rows = (n: number, words = 6) => Array.from({ length: n }, (_, i) => item(`li-${i + 1}`, `Workshop session ${i + 1} ${'with materials '.repeat(words).trim()}`, 1_000 + (i % 3) * 500, m(12_500 + i * 37, 'USD')))

describe('pagination invariants on every fixture', () => {
  for (const f of FIXTURES) {
    if (f.type !== 'document') continue
    for (const preset of PRESETS) {
      it(`${f.id} (${preset})`, () => {
        const snapshot = f.build() as DocumentSnapshot
        if (snapshot.blocks.length === 0) {
          expect(paginate(composeDocument(snapshot), fonts, { preset }).status).toBe('empty')
          return
        }
        const { plan, pages } = pagesOf(snapshot, preset)
        checkInvariants(plan, pages, preset, `${f.id}/${preset}`)
      })
    }
  }

  it('the long invoice keeps the last rows, totals and payment terms together on its final page', () => {
    const fixture = FIXTURES.find((x) => x.id === 'invoice-long')!
    for (const preset of PRESETS) {
      const { pages } = pagesOf((fixture as Extract<typeof fixture, { type: 'document' }>).build(), preset)
      const last = pages[pages.length - 1]
      expect(last.fragments.map((f) => f.primitive)).toEqual(['invoice-line-items', 'totals', 'key-value-group'])
    }
  })

  it('the long invoice spans pages with repeated headers and the INR totals on a page with line items', () => {
    const fixture = FIXTURES.find((x) => x.id === 'invoice-long')!
    const { pages } = pagesOf((fixture as Extract<typeof fixture, { type: 'document' }>).build(), 'a4-portrait')
    expect(pages.length).toBeGreaterThan(2)
    expect(pages.filter((p) => p.fragments.some((x) => x.body.primitive === 'table' && x.body.repeatedHeader)).length).toBeGreaterThan(0)
  })
})

describe('rules fire when the content demands it', () => {
  it('moves the last rows with the totals rather than stranding the totals', () => {
    const reasons = new Set<string>()
    for (const preset of PRESETS) {
      for (let n = 8; n <= 48; n++) {
        const { plan, pages } = pagesOf(withLineItems(completeInvoice(), rows(n)), preset)
        checkInvariants(plan, pages, preset, `rows=${n}/${preset}`)
        pages.forEach((p) => p.breakReason && reasons.add(p.breakReason))
      }
    }
    expect([...reasons].some((r) => r.includes('keep the totals with them'))).toBe(true)
    expect([...reasons].some((r) => r.includes('header row repeated'))).toBe(true)
  })

  it('splits a row taller than a page by lines, numbers on its first part and a continued marker after', () => {
    const tall = item('li-tall', Array.from({ length: 90 }, (_, i) => `Clause ${i + 1}: hand-finished panel with documented provenance and care notes.`).join(' '), 1_000, m(900_000, 'USD'))
    for (const preset of PRESETS) {
      const { plan, pages } = pagesOf(withLineItems(completeInvoice(), [...rows(2), tall, ...rows(2).map((r, i) => ({ ...r, id: `li-after-${i}` }))]), preset)
      checkInvariants(plan, pages, preset, `tall/${preset}`)
      const parts = pages.flatMap((p) => p.fragments).flatMap((f) => (f.body.primitive === 'table' ? f.body.rows.filter((r) => r.id === 'li-tall') : []))
      expect(parts.length).toBeGreaterThan(1)
      expect(parts[0].continuedFromPrevious).toBe(false)
      expect(parts[0].cells.slice(1).every((c) => c !== null)).toBe(true)
      for (const later of parts.slice(1)) {
        expect(later.continuedFromPrevious).toBe(true)
        expect(later.cells.slice(1).every((c) => c === null)).toBe(true)
      }
      expect(parts[parts.length - 1].continuesOnNext).toBe(false)
    }
  })

  it('keeps whole rows with the totals when the last row is split across pages', () => {
    const tallLast = item('li-tall-last', Array.from({ length: 90 }, (_, i) => `Clause ${i + 1}: documented provenance.`).join(' '), 1_000, m(450_000, 'USD'))
    for (const preset of PRESETS) {
      for (let n = 1; n <= 20; n += 3) {
        const { plan, pages } = pagesOf(withLineItems(completeInvoice(), [...rows(n), tallLast]), preset)
        checkInvariants(plan, pages, preset, `tall-last n=${n}/${preset}`)
        const totalsPage = pages.find((p) => p.fragments.some((f) => f.primitive === 'totals'))!
        const before = totalsPage.fragments[totalsPage.fragments.findIndex((f) => f.primitive === 'totals') - 1]
        if (before?.body.primitive === 'table') {
          const last = before.body.rows[before.body.rows.length - 1]
          expect(last.id).toBe('li-tall-last')
          expect(last.continuesOnNext).toBe(false)
        } else {
          expect(totalsPage.breakReason).toMatch(/^Totals start this page/)
        }
        // The rule never pushes the whole table off a page that has room for its first rows.
        const first = pages.find((p) => p.fragments.some((f) => f.primitive === 'invoice-line-items'))!
        expect(first.number).toBe(1)
      }
    }
  })

  function briefWithFiller(lines: number): DocumentSnapshot {
    const base = evidenceBrief()
    const filler: Block = { id: 'blk-filler', type: 'paragraph', runs: [run(Array.from({ length: lines * 14 }, (_, i) => `filler${i}`).join(' '))] }
    const at = base.blocks.findIndex((b) => b.id === 'blk-evidence-h')
    return { ...base, blocks: [...base.blocks.slice(0, at), filler, ...base.blocks.slice(at)] }
  }

  it('keeps headings with their first lines and controls orphans and widows', () => {
    const reasons = new Set<string>()
    let splitParagraphs = 0
    for (const preset of PRESETS) {
      for (let lines = 1; lines <= 60; lines += 1) {
        const { plan, pages } = pagesOf(briefWithFiller(lines), preset)
        checkInvariants(plan, pages, preset, `filler=${lines}/${preset}`)
        pages.forEach((p) => p.breakReason && reasons.add(p.breakReason))
        // Preferred section breaks usually pre-empt the heading rule; without them it must still hold.
        const bare = { ...plan, nodes: plan.nodes.filter((n) => n.primitive !== 'page-break-hint') }
        const result = paginate(bare, fonts, { preset })
        if (result.status !== 'ok') throw new Error(result.status)
        checkInvariants(bare, result.pages, preset, `filler=${lines}/${preset}/no-hints`)
        result.pages.forEach((p) => p.breakReason && reasons.add(p.breakReason))
        const ids = pages.flatMap((p) => p.fragments.filter((f) => f.primitive === 'paragraph').map((f) => f.nodeId))
        splitParagraphs += ids.length - new Set(ids).size
      }
    }
    expect([...reasons].some((r) => r.startsWith('Heading kept'))).toBe(true)
    expect([...reasons].some((r) => r.startsWith('Paragraph split'))).toBe(true)
    expect([...reasons].some((r) => r.startsWith('Chart kept'))).toBe(true)
    expect(splitParagraphs).toBeGreaterThan(0)
  })

  it('reports an explicit error for content that cannot fit an empty page — never clips or shrinks', () => {
    const base = completeInvoice()
    const huge = { ...base.fields['buyer.address'], state: { status: 'provided' as const, value: { type: 'multiline' as const, lines: Array.from({ length: 120 }, (_, i) => `Address line ${i + 1}`) } } }
    const result = paginate(composeDocument({ ...base, fields: { ...base.fields, 'buyer.address': huge } }), fonts)
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error.kind).toBe('too-tall')
      expect(result.error.nodeId).toBe('parties')
      expect(result.error.message).toMatch(/never shrunk/)
    }
  })

  // ja-JP is unsupported by the placeholder faces as a whole: dates use 年月日 and amounts the
  // full-width ￥. Layout refuses it rather than substituting a character or face.
  it('refuses characters the drawing face lacks (ja-JP) instead of substituting', () => {
    const base = completeInvoice(undefined, 'ja-JP')
    const yen = {
      ...base,
      fields: { ...base.fields, 'invoice.currency': { ...base.fields['invoice.currency'], state: { status: 'provided' as const, value: { type: 'currency' as const, code: 'JPY' as const } } } },
    }
    const jpy = withLineItems(yen, [item('li-1', 'Consultation', 1_000, m(120_000, 'JPY'))])
    const result = paginate(composeDocument(jpy), fonts)
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error.kind).toBe('missing-glyph')
      if (result.error.kind === 'missing-glyph') {
        expect(result.error.characters.length).toBeGreaterThan(0)
        expect(result.error.message).toMatch(/refused rather than substituting/)
      }
    }
    // The amount alone, in a face-checked cell, is refused for its full-width yen.
    const amountOnly = paginate(composeDocument(withLineItems({ ...yen, locale: 'ja-JP', fields: { ...yen.fields, 'invoice.issueDate': { ...yen.fields['invoice.issueDate'], state: { status: 'missing' as const } }, 'invoice.dueDate': { ...yen.fields['invoice.dueDate'], state: { status: 'missing' as const } } } }, [item('li-1', 'Consultation', 1_000, m(120_000, 'JPY'))])), fonts)
    expect(amountOnly.status).toBe('error')
    if (amountOnly.status === 'error' && amountOnly.error.kind === 'missing-glyph') expect(amountOnly.error.characters).toContain('￥')
  })
})
