import { describe, expect, it } from 'vitest'

import { deriveDeck } from '../deck'
import { evidenceBrief } from '../fixtures/brief'
import { layoutDeck } from '../layout/slides'
import { lineText } from '../layout/inspect'
import { resolveTheme } from '../theme'
import { nodeFontSet } from '../testing/nodeFonts'
import { nodeResources } from '../testing/nodeResources'
import { readPdf, squash } from '../testing/pdfText'
import { readZip, zipText } from '../testing/zip'
import { renderDeckPdf } from './pdf'
import { renderPptx } from './pptx'

const deck = () => deriveDeck(evidenceBrief(), { outputId: 'out-brief', revisionId: 'rev-001' }).snapshot
const { theme } = resolveTheme('placeholder')

describe('PowerPoint renderer', () => {
  it('writes a real 16:9 .pptx with one slide per laid-out slide', async () => {
    const s = deck()
    const r = await renderPptx(s, nodeResources(s), { title: 'Deck', subject: 'Revision rev-001' })
    const zip = readZip(r.bytes)
    expect([...r.bytes.subarray(0, 2)]).toEqual([0x50, 0x4b])
    expect(zipText(zip, '[Content_Types].xml')).toContain('presentationml.presentation.main+xml')
    const layout = layoutDeck(s, nodeFontSet())
    if (layout.status !== 'ok') throw new Error('layout')
    const slides = [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    expect(slides).toHaveLength(layout.slides.length)
    expect(zipText(zip, 'ppt/presentation.xml')).toContain('cx="12192000" cy="6858000"')
  })

  it('native editable text: every engine word is in a slide text box, in the theme’s named fonts', async () => {
    const s = deck()
    const r = await renderPptx(s, nodeResources(s), { title: 'Deck', subject: 's' })
    const zip = readZip(r.bytes)
    const layout = layoutDeck(s, nodeFontSet())
    if (layout.status !== 'ok') throw new Error('layout')
    layout.slides.forEach((slide, i) => {
      const xml = zipText(zip, `ppt/slides/slide${i + 1}.xml`)
      const t = squash([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
      const engine = [...(slide.title ?? []), ...(slide.heading ?? []), ...slide.items.flatMap((it) => (it.kind === 'chart' ? [...it.title, ...it.axes, ...it.summary] : it.lines)), slide.footer.left, slide.footer.right].map(lineText)
      for (const l of engine) expect(t).toContain(squash(l))
      for (const face of xml.matchAll(/typeface="([^"]+)"/g)) expect(theme.faces.map((f) => f.nameTable.family)).toContain(face[1])
    })
    expect(r.namedFonts.length).toBeGreaterThanOrEqual(3)
  })

  it('the chart is a native bar chart with the source data, and its data summary stays on the slide', async () => {
    const s = deck()
    const zip = readZip((await renderPptx(s, nodeResources(s), { title: 'Deck', subject: 's' })).bytes)
    const chart = zipText(zip, [...zip.keys()].find((k) => /^ppt\/charts\/chart\d+\.xml$/.test(k))!)
    expect(chart).toContain('<c:barChart>')
    expect(chart).toContain('<c:barDir val="col"/>')
    for (const v of ['9', '17', '21', '14', '22']) expect(chart).toContain(`<c:v>${v}</c:v>`)
    expect(chart).toContain('Weeks 5–8')
    const slides = [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).map((k) => zipText(zip, k))
    const chartSlide = slides.find((x) => x.includes('drawingml/2006/chart'))!
    expect(chartSlide).toContain('Cancellations peak in week 3')
  })

  it('deck PDF: one 960×540 page per slide carrying the slide text', async () => {
    const s = deck()
    const r = await renderDeckPdf(s, nodeResources(s), { title: 'Deck', subject: 's', createdAt: '2026-10-14T09:00:00.000Z' })
    const pdf = await readPdf(r.bytes)
    if (r.layout.kind !== 'slides') throw new Error('slides')
    expect(pdf.pages).toHaveLength(r.layout.deck.slides.length)
    pdf.pages.forEach((p, i) => {
      expect([p.width, p.height]).toEqual([960, 540])
      expect(squash(p.text)).toContain(squash(lineText(r.layout.kind === 'slides' ? r.layout.deck.slides[i].footer.right : r.layout.paged.pages[0].footer.pageLabel)))
    })
  })
})
