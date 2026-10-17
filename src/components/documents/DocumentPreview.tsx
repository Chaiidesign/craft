'use client'

// Paginated document preview. The layout engine measures text with the theme's
// own TTFs and breaks pages by meaning; this component draws each page at its
// real size in points, scaled down (never reflowed) to fit narrow screens.
// Layout runs only once the fonts it measures with are loaded and image assets
// have been checked — it never lays out with a fallback face.

import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { DocumentPlan } from '@/lib/documents/compose'
import { isCommercialKind } from '@/lib/documents/invoice'
import { paginate, type PagedDocument } from '@/lib/documents/layout/paginate'
import { documentCssVariables, PAGE_SIZES } from '@/lib/documents/tokens'

import { FragmentView, LineView, PageBreakHint, PageFooter } from './DocumentPrimitives'
import styles from './documentPreview.module.css'
import { useAssetAvailability, useDocumentFonts, type FontLoadState } from './useDocumentFonts'

const PT_TO_PX = 96 / 72
const pt = (n: number) => `${n}pt`

export type PreviewState =
  | { status: 'loading' }
  | { status: 'fonts-failed'; failedFiles: string[] }
  | { status: 'laid-out'; paged: PagedDocument }

function planAssets(plan: DocumentPlan): string[] {
  return plan.nodes.flatMap((n) => {
    if (n.primitive === 'letterhead' && n.logo.kind === 'image') return [n.logo.asset.src]
    if (n.primitive === 'image-with-caption') return [n.asset.src]
    return []
  })
}

export function DocumentPreview({ plan, preset, showHints = false, onState }: { plan: DocumentPlan; preset?: keyof typeof PAGE_SIZES; showHints?: boolean; onState?: (s: PreviewState) => void }) {
  const fonts = useDocumentFonts(plan.themeId)
  const assets = useAssetAvailability(planAssets(plan))
  const state = useMemo<PreviewState>(() => previewState(fonts, assets, plan, preset), [fonts, assets, plan, preset])
  useEffect(() => { onState?.(state) }, [state, onState])

  if (state.status === 'loading') return <p className={styles.status} role="status">Loading document fonts and checking image files…</p>
  if (state.status === 'fonts-failed') {
    return <p className={styles.status} role="alert">Document fonts failed to load ({state.failedFiles.join(', ')}). The preview is not shown rather than laid out with a fallback face.</p>
  }
  return <PagedDocumentView plan={plan} paged={state.paged} showHints={showHints} />
}

function previewState(fonts: FontLoadState, assets: { checked: boolean; unavailable: ReadonlySet<string> }, plan: DocumentPlan, preset?: keyof typeof PAGE_SIZES): PreviewState {
  if (fonts.status === 'loading' || !assets.checked) return { status: 'loading' }
  if (fonts.status === 'failed') return { status: 'fonts-failed', failedFiles: fonts.failedFiles }
  return { status: 'laid-out', paged: paginate(plan, fonts.fonts, { preset, unavailableAssets: assets.unavailable }) }
}

/** Draws a laid-out document. Pure: given the same layout it renders the same pages. */
export function PagedDocumentView({ plan, paged, showHints = false }: { plan: DocumentPlan; paged: PagedDocument; showHints?: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const pageWidthPx = PAGE_SIZES[paged.preset].widthPt * PT_TO_PX

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const update = () => setZoom(Math.min(1, frame.clientWidth / pageWidthPx))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [pageWidthPx])

  const vars = useMemo(() => ({
    ...documentCssVariables(plan.themeId),
    '--doc-ink': plan.palette.ink,
    '--doc-muted': plan.palette.muted,
    '--doc-rule-colour': plan.palette.rule,
    '--doc-accent': plan.palette.accent,
  }) as CSSProperties, [plan.themeId, plan.palette])

  if (paged.status === 'empty') {
    return (
      <div className={styles.emptyState} role="note">
        <p><strong>Nothing to lay out yet.</strong></p>
        <p>This {plan.kind} has no fields and no content blocks, so there is no page to preview. Supply the {isCommercialKind(plan.kind) ? 'issuer, buyer, line items and currency' : 'title, summary and sections'} and the preview will build itself from them.</p>
      </div>
    )
  }
  if (paged.status === 'error') {
    return (
      <div className={styles.layoutError} role="alert" data-layout-error={paged.error.kind}>
        <p><strong>{paged.error.kind === 'missing-glyph' ? 'This document uses characters the document fonts cannot draw.' : 'Part of this document cannot fit on a page.'}</strong></p>
        <p>{paged.error.message}</p>
        <p>Block: <code>{paged.error.nodeId}</code>. Nothing was clipped, shrunk or substituted.</p>
      </div>
    )
  }

  const complete = plan.nodes.some((n) => n.primitive === 'totals' && n.complete)
  return (
    <div ref={frameRef} className={styles.frame}>
      <div className={styles.pages} style={{ ...vars, zoom }} lang={plan.locale} data-readiness={plan.readiness}>
        {paged.pages.map((page) => (
          <article
            key={page.number}
            className={styles.sheet}
            style={{ width: pt(page.widthPt), height: pt(page.heightPt) }}
            aria-label={`Page ${page.number} of ${paged.pages.length}`}
            data-page={page.number}
          >
            {showHints && page.breakReason && <PageBreakHint reason={page.breakReason} />}
            {page.runningHeader && (
              <div className={styles.runningHeader} style={{ top: pt(page.runningHeader.y), left: pt(page.content.x), width: pt(page.content.width) }}>
                {page.runningHeader.lines.map((l, i) => <LineView key={i} line={l} lineStyle="footer" />)}
              </div>
            )}
            <div className={styles.content} style={{ top: pt(page.content.y), left: pt(page.content.x), width: pt(page.content.width), height: pt(page.content.height) }} data-content>
              {page.fragments.map((f) => <FragmentView key={f.key} fragment={f} contentWidth={page.content.width} complete={complete} />)}
            </div>
            <PageFooter page={page} />
          </article>
        ))}
      </div>
    </div>
  )
}
