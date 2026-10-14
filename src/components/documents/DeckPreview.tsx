'use client'

// Slide preview for a derived deck (fixture 5). Slides are laid out by the
// slide engine with the theme's real font metrics and drawn at 16:9 in points,
// scaled down to fit. The checks beside them are computed from the same layout.

import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { lineText } from '@/lib/documents/layout/inspect'
import { layoutDeck, type DeckLayout, type SlideLayout } from '@/lib/documents/layout/slides'
import type { DerivedDeck } from '@/lib/documents/deck'
import { documentCssVariables, SLIDE, SLIDE_FLOORS, SLIDE_FLOW, SLIDE_INLINE, SLIDE_TYPE } from '@/lib/documents/tokens'

import { BarPlot, StyledLineView, typeOfStyle } from './DocumentPrimitives'
import styles from './documentPreview.module.css'
import { useDocumentFonts } from './useDocumentFonts'

const PT_TO_PX = 96 / 72
const pt = (n: number) => `${n}pt`

export interface DeckCheck { label: string; result: 'pass' | 'fail' | 'deferred'; detail: string }

/** Checks for fixture 5, computed from the laid-out slides. */
export function deckChecks(derived: DerivedDeck, layout: DeckLayout, sourceText: { facts: string[]; citationCount: number }): DeckCheck[] {
  if (layout.status !== 'ok') return [{ label: 'Deck laid out', result: 'fail', detail: layout.error.message }]
  const all = layout.slides.flatMap((s) => [...(s.title ?? []), ...(s.heading ?? []), ...s.items.flatMap((i) => (i.kind === 'text' ? [...(i.label ?? []), ...i.lines] : i.kind === 'heading' ? i.lines : [...i.title, ...i.axes, ...i.summary]))])
  const text = all.map(lineText).join(' ').replace(/ /g, ' ')
  const missingFacts = sourceText.facts.filter((f) => !text.includes(f))
  const cited = new Set([...text.matchAll(/\[([\d, ]+)\]/g)].flatMap((m) => m[1].split(',').map((n) => Number(n.trim()))))
  const below = all.flatMap((l) => l.segments).filter((s) => s.style.sizePt < (s.style === SLIDE_TYPE.caption || s.style === SLIDE_INLINE.citation ? SLIDE_FLOORS.captionPt : SLIDE_FLOORS.bodyPt))
  const verdict = (ok: boolean): DeckCheck['result'] => (ok ? 'pass' : 'fail')
  return [
    // Nothing to verify yet: the IDs are fixture values passed in. Step 4 checks them against real revisions.
    { label: 'Ancestry points at that exact brief revision', result: 'deferred', detail: `Recorded as ${derived.derivedFrom.outputId} @ ${derived.derivedFrom.revisionId} (fixture IDs). Checked against real revision records in Step 4.` },
    { label: 'Mandatory facts survive', result: verdict(missingFacts.length === 0), detail: missingFacts.length ? `Missing: ${missingFacts.join(', ')}` : sourceText.facts.join(' · ') },
    { label: 'Every citation survives', result: verdict(cited.size === sourceText.citationCount), detail: `${cited.size} of ${sourceText.citationCount} sources cited on slides, plus a sources slide.` },
    { label: 'No text below the floors', result: verdict(below.length === 0), detail: `Body ≥ ${SLIDE_FLOORS.bodyPt}pt, captions and citations ≥ ${SLIDE_FLOORS.captionPt}pt. Dense content splits instead.` },
    { label: 'Internal note left out', result: verdict(derived.excludedBlocks.every((b) => b.reason.startsWith('Internal'))), detail: derived.excludedBlocks.map((b) => b.blockId).join(', ') || 'None to exclude' },
  ]
}

export function DeckPreview({ derived, onLayout }: { derived: DerivedDeck; onLayout?: (l: DeckLayout | null) => void }) {
  const fonts = useDocumentFonts(derived.snapshot.brand.themeId)
  const layout = useMemo(() => (fonts.status === 'ready' ? layoutDeck(derived.snapshot, fonts.fonts) : null), [fonts, derived])
  useEffect(() => { onLayout?.(layout) }, [layout, onLayout])

  const frameRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const slideWidthPx = SLIDE.widthPt * PT_TO_PX
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const update = () => setZoom(Math.min(1, frame.clientWidth / slideWidthPx))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [slideWidthPx, layout])

  const vars = useMemo(() => ({
    ...documentCssVariables(derived.snapshot.brand.themeId),
    '--doc-ink': derived.snapshot.brand.palette.ink,
    '--doc-muted': derived.snapshot.brand.palette.muted,
    '--doc-rule-colour': derived.snapshot.brand.palette.rule,
    '--doc-accent': derived.snapshot.brand.palette.accent,
  }) as CSSProperties, [derived])

  if (fonts.status === 'loading') return <p className={styles.status} role="status">Loading document fonts…</p>
  if (fonts.status === 'failed') return <p className={styles.status} role="alert">Document fonts failed to load ({fonts.failedFiles.join(', ')}); slides are not shown with a fallback face.</p>
  if (!layout) return null
  if (layout.status === 'error') return <div className={styles.layoutError} role="alert"><p><strong>The deck could not be laid out.</strong></p><p>{layout.error.message}</p></div>

  return (
    <div ref={frameRef} className={styles.frame}>
      <div className={styles.pages} style={{ ...vars, zoom }} lang={derived.snapshot.locale}>
        {layout.slides.map((slide) => <SlideView key={slide.number} slide={slide} total={layout.slides.length} />)}
      </div>
    </div>
  )
}

function SlideView({ slide, total }: { slide: SlideLayout; total: number }) {
  const safe = SLIDE.safeAreaPt
  const width = SLIDE.widthPt - 2 * safe
  return (
    <article className={styles.sheet} style={{ width: pt(SLIDE.widthPt), height: pt(SLIDE.heightPt) }} aria-label={`Slide ${slide.number} of ${total}`} data-slide={slide.number} data-layout={slide.layout}>
      <div className={styles.content} style={{ top: pt(safe), left: pt(safe), width: pt(width) }}>
        {slide.title && <h1>{slide.title.map((l, i) => <StyledLineView key={i} line={l} style={SLIDE_TYPE.title} />)}</h1>}
        {slide.heading && <h2>{slide.heading.map((l, i) => <StyledLineView key={i} line={l} style={SLIDE_TYPE.heading} />)}</h2>}
        {slide.items.map((item, i) => (
          <div key={i} className={styles.fragment} style={{ top: pt(item.y), height: pt(item.height) }}>
            {item.kind === 'heading'
              ? <h2>{item.lines.map((l, j) => <StyledLineView key={j} line={l} style={SLIDE_TYPE.heading} />)}</h2>
              : item.kind === 'text'
              ? (
                <div className={item.tone === 'warning' ? styles.slideCaveat : undefined} style={{ position: 'relative', paddingLeft: pt(item.indent) }}>
                  {item.marker && <span className={styles.marker} aria-hidden="true" style={typeOfStyle(item.style)}>{item.marker}</span>}
                  {item.lines.map((l, j) => <StyledLineView key={j} line={l} style={item.style} />)}
                </div>
              )
              : (
                <figure>
                  <figcaption>{item.title.map((l, j) => <StyledLineView key={j} line={l} style={SLIDE_TYPE.caption} />)}</figcaption>
                  <div style={{ marginTop: pt(SLIDE_FLOW.itemGap) }}><BarPlot node={item.node} widthPt={width} heightPt={item.plotHeight} labelStyle={typeOfStyle(SLIDE_TYPE.caption)} /></div>
                  <p className={styles.muted} style={{ marginTop: pt(SLIDE_FLOW.itemGap) }}>{item.axes.map((l, j) => <StyledLineView key={j} line={l} style={SLIDE_TYPE.caption} />)}</p>
                  <p id={`${item.node.id}-summary`} style={{ marginTop: pt(SLIDE_FLOW.itemGap) }}>{item.summary.map((l, j) => <StyledLineView key={j} line={l} style={SLIDE_TYPE.caption} />)}</p>
                </figure>
              )}
          </div>
        ))}
      </div>
      <footer className={styles.footer} style={{ top: pt(slide.footer.y), left: pt(safe), width: pt(width) }}>
        <span className={styles.muted}><StyledLineView line={slide.footer.left} style={SLIDE_TYPE.caption} /></span>
        <span className={styles.muted}><StyledLineView line={slide.footer.right} style={SLIDE_TYPE.caption} /></span>
      </footer>
    </article>
  )
}
