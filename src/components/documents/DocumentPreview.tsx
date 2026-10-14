'use client'

// HTML preview of a document plan: one sheet at the preset's real size in
// points, scaled down (never reflowed) to fit narrow screens, so what you see
// is the print layout. Pagination arrives in Step 3; until then the sheet grows
// to fit and the footer says the preview is unpaginated.

import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { DocumentPlan } from '@/lib/documents/compose'
import { documentCssVariables, PAGE_SIZES, pageCss } from '@/lib/documents/tokens'

import { PlanNodeView } from './DocumentPrimitives'
import styles from './documentPreview.module.css'
import { useDocumentFonts, type FontLoadState } from './useDocumentFonts'

const PT_TO_PX = 96 / 72

export function DocumentPreview({ plan, showHints = false, onFontState }: { plan: DocumentPlan; showHints?: boolean; onFontState?: (s: FontLoadState) => void }) {
  const fonts = useDocumentFonts(plan.themeId)
  const frameRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => { onFontState?.(fonts) }, [fonts, onFontState])

  const preset = plan.layoutPreset === 'slide-16x9' ? 'a4-portrait' : plan.layoutPreset
  const pageWidthPx = PAGE_SIZES[preset].widthPt * PT_TO_PX

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

  if (plan.empty) {
    return (
      <div className={styles.emptyState} role="note">
        <p><strong>Nothing to lay out yet.</strong></p>
        <p>This {plan.kind} has no fields and no content blocks, so there is no page to preview. Supply the {plan.kind === 'invoice' ? 'issuer, buyer, line items and currency' : 'title, summary and sections'} and the preview will build itself from them.</p>
      </div>
    )
  }

  return (
    <div ref={frameRef} className={styles.frame}>
      <article
        className={styles.sheet}
        style={{ ...vars, ...pageCss(preset), zoom }}
        data-fonts={fonts.status}
        data-readiness={plan.readiness}
        lang={plan.locale}
        aria-label="Document preview"
      >
        {plan.nodes.map((node) => <PlanNodeView key={`${node.primitive}:${node.id}`} node={node} showHints={showHints} />)}
      </article>
    </div>
  )
}
