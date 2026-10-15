'use client'

// PDF preview of a generated file: pdf.js draws the exported bytes
// themselves (not the HTML preview), with the page count, fit / zoom and a
// download link for exactly that file. If the viewer fails, that is a viewer
// error, not an export error: the file exists and its download still works,
// so the error offers to try the viewer again or show the HTML preview.

import React, { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/Button'

import styles from './documentPreview.module.css'
import { loadPdfJs } from './pdfjs'
import { openForViewer } from './viewerOpen'

type Zoom = 'fit' | 1 | 1.5

export function PdfFilePreview({ bytes, url, filename, label, size, forceFailure, onShowHtml }: {
  bytes: Uint8Array | null
  url: string
  filename: string
  label: string
  /** The file's size as shown in its status label, e.g. "73 KB". */
  size: string
  /** Scenario 11 only: make the viewer fail, deliberately and visibly. */
  forceFailure?: string
  /** Moves to the HTML preview, offered when the viewer fails. */
  onShowHtml?: () => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [attempt, setAttempt] = useState(0)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let cancelled = false
    const frame = frameRef.current
    if (!frame) return
    ;(async () => {
      try {
        const doc = await openForViewer(bytes, async (b) => (await loadPdfJs()).getDocument({ data: b.slice() }).promise, forceFailure)
        if (cancelled) { await doc.destroy(); return }
        setPages(doc.numPages)
        frame.replaceChildren()
        const ratio = window.devicePixelRatio || 1
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 96 / 72 })
          const scale = (zoom === 'fit' ? Math.min(1, (frame.clientWidth - 2) / base.width) : zoom) * (96 / 72)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * ratio)
          canvas.height = Math.floor(viewport.height * ratio)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          canvas.className = styles.pdfPage
          canvas.setAttribute('role', 'img')
          canvas.setAttribute('aria-label', `${filename}, page ${i} of ${doc.numPages}`)
          frame.appendChild(canvas)
          await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise
          if (cancelled) break
        }
        await doc.destroy()
      } catch (e) {
        if (!cancelled) { frame.replaceChildren(); setError(e instanceof Error ? e.message : String(e)) }
      }
    })()
    return () => { cancelled = true }
  }, [bytes, filename, zoom, forceFailure, attempt])

  /** The button that had focus disappears with the error, so focus moves to the preview's heading. */
  const tryAgain = () => { setError(null); setPages(null); setAttempt((n) => n + 1); titleRef.current?.focus() }

  return (
    <section aria-label={label}>
      <h3 ref={titleRef} tabIndex={-1} className={styles.pdfPreviewTitle}>{label}</h3>
      <div className={styles.pdfToolbar} role="group" aria-label="PDF zoom">
        {/* On a viewer error the alert below is the only message, so a screen reader hears it once. */}
        {!error && <span role="status">{pages === null ? 'Opening the PDF…' : `${pages} page${pages === 1 ? '' : 's'}`}</span>}
        <Button variant={zoom === 'fit' ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit width</Button>
        <Button variant={zoom === 1 ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100%</Button>
        <Button variant={zoom === 1.5 ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 1.5} onClick={() => setZoom(1.5)}>150%</Button>
        <a href={url} download={filename}>Download {filename}</a>
      </div>
      {error && (
        <div role="alert">
          <p className={styles.status}>The PDF was generated ({size}) but the viewer couldn’t show it: {error.replace(/\.$/, '')}. The download still works.</p>
          <div className={styles.pdfToolbar}>
            <Button variant="outline" size="sm" onClick={tryAgain}>Try the viewer again</Button>
            {onShowHtml && <Button variant="ghost" size="sm" onClick={onShowHtml}>Show the HTML preview</Button>}
          </div>
        </div>
      )}
      <div ref={frameRef} className={styles.pdfFrame} data-zoom={zoom} />
    </section>
  )
}
