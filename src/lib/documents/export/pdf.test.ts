import { describe, expect, it } from 'vitest'

import { evidenceBrief } from '../fixtures/brief'
import { completeInvoice, incompleteInvoice, longInvoice } from '../fixtures/invoices'
import { contentLines, fragmentLines, lineText } from '../layout/inspect'
import type { DocumentSnapshot } from '../model'
import { resolveTheme } from '../theme'
import { PAGE_SIZES } from '../tokens'
import { nodeResources } from '../testing/nodeResources'
import { readPdf, squash } from '../testing/pdfText'
import { renderDocumentPdf, type PdfRender } from './pdf'

const META = { title: 'Test', subject: 'Revision rev-001', createdAt: '2026-10-14T09:00:00.000Z' }
const render = (s: DocumentSnapshot) => renderDocumentPdf(s as Exclude<DocumentSnapshot, { kind: 'deck' }>, nodeResources(s), META)

/** Every engine line of every page, in order, as drawn on that page. */
function engineLinesByPage(r: PdfRender): string[][] {
  if (r.layout.kind !== 'pages') throw new Error('expected pages')
  return r.layout.paged.pages.map((p) => [
    ...(p.runningHeader?.lines.map(lineText) ?? []),
    ...p.fragments.flatMap((f) => contentLines(f.body)),
    lineText(p.footer.identification),
    lineText(p.footer.pageLabel),
  ])
}

function inOrder(haystack: string, needles: string[]): string[] {
  const missing: string[] = []
  let at = 0
  for (const n of needles.map(squash).filter(Boolean)) {
    const i = haystack.indexOf(n, at)
    if (i < 0) missing.push(n)
    else at = i + n.length
  }
  return missing
}

describe('PDF renderer', () => {
  it.each([
    ['complete invoice', completeInvoice],
    ['long invoice', longInvoice],
    ['brief', evidenceBrief],
  ])('%s: real PDF bytes with the engine’s pages and lines', async (_, build) => {
    const r = await render(build())
    expect(new TextDecoder().decode(r.bytes.subarray(0, 5))).toBe('%PDF-')
    expect(new TextDecoder().decode(r.bytes.subarray(-6))).toContain('%%EOF')
    const pdf = await readPdf(r.bytes)
    const engine = engineLinesByPage(r)
    expect(pdf.pages.length).toBe(engine.length)
    pdf.pages.forEach((page, i) => {
      expect(page.width).toBeCloseTo(PAGE_SIZES['a4-portrait'].widthPt, 1)
      // Each page carries exactly its own engine lines, in reading order.
      expect(inOrder(squash(page.text), engine[i])).toEqual([])
    })
  })

  it('long invoice: 42 rows over several pages, totals and payment terms on the last page', async () => {
    const r = await render(longInvoice())
    const pdf = await readPdf(r.bytes)
    expect(pdf.pages.length).toBeGreaterThan(2)
    const last = squash(pdf.pages[pdf.pages.length - 1].text)
    expect(last).toContain('Totaldue')
    expect(last).toContain('Paymentterms')
    expect(last).toContain(squash(`Page ${pdf.pages.length} of ${pdf.pages.length}`))
    // Indian digit grouping and the rupee sign survive into the file.
    expect(pdf.pages.map((p) => p.text).join('')).toMatch(/₹\d{1,2},\d{2},\d{3}\.\d{2}/)
    // A row carried over a page break says so in the file, wherever the engine split one.
    if (r.layout.kind !== 'pages') throw new Error('expected pages')
    r.layout.paged.pages.forEach((page, i) => {
      const carried = page.fragments.some((f) => f.body.primitive === 'table' && f.body.rows.some((row) => row.continuedLabel))
      expect(squash(pdf.pages[i].text).includes('Continuedfrompreviouspage')).toBe(carried)
    })
  })

  it('brief: citations beside claims, chart labels and data summary, source list; internal note left out', async () => {
    const pdf = await readPdf((await render(evidenceBrief())).bytes)
    const all = squash(pdf.pages.map((p) => p.text).join(''))
    expect(all).toContain('[1,2]')
    expect(all).toContain('Week3')
    expect(all).toContain(squash('Cancellations peak in week 3 (21%)'))
    expect(all).toContain('Sources')
    expect(all).not.toContain('Internalnote')
  })

  it('an incomplete invoice carries the draft marker and its missing fields', async () => {
    const pdf = await readPdf((await render(incompleteInvoice())).bytes)
    const text = squash(pdf.pages[0].text)
    expect(text).toContain('DRAFT—INCOMPLETE')
    expect(text).toContain('Missing')
  })

  it('embeds every face it draws with, unmodified names from the theme, and records metadata', async () => {
    const r = await render(evidenceBrief())
    const raw = new TextDecoder('latin1').decode(r.bytes)
    const { theme } = resolveTheme('placeholder')
    const embedded = new Set([...raw.matchAll(/\/BaseFont \/([A-Za-z0-9+-]+)/g)].map((m) => m[1].replace(/^[A-Z]{6}\+/, '')))
    // Exactly the faces the engine's lines use (putOnlyUsedFonts), each named as in its TTF name table.
    if (r.layout.kind !== 'pages') throw new Error('expected pages')
    const used = new Set(r.layout.paged.pages.flatMap((p) => [p.footer.identification, ...p.fragments.flatMap((f) => fragmentLines(f.body))])
      .flatMap((l) => l.segments).map((seg) => theme.faces.find((f) => f.role === seg.style.role && f.weight === seg.style.weight && f.style === seg.style.style)!.nameTable.postscript))
    expect([...embedded].sort()).toEqual([...used].sort())
    expect(used.size).toBeGreaterThanOrEqual(5)
    // One embedded TrueType program per face drawn.
    expect(raw.match(/\/FontFile2/g)!.length).toBe(embedded.size)
    const pdf = await readPdf(r.bytes)
    expect(pdf.info.Title).toBe('Test')
    expect(String(pdf.info.CreationDate)).toMatch(/^D:20261014/)
  })
})
