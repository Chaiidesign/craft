'use client'

// PDF preview of a generated file: pdf.js draws the exported bytes
// themselves (not the HTML preview), with the page count, fit / zoom and a
// download link for exactly that file.

import React, { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/Button'

import styles from './documentPreview.module.css'
import { loadPdfJs } from './pdfjs'

type Zoom = 'fit' | 1 | 1.5

export function PdfFilePreview({ bytes, url, filename, label }: { bytes: Uint8Array | null; url: string; filename: string; label: string }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Zoom>('fit')

  useEffect(() => {
    let cancelled = false
    const frame = frameRef.current
    if (!frame) return
    ;(async () => {
      try {
        if (!bytes) throw new Error('The generated file is no longer in memory (reloading clears exports).')
        const pdfjs = await loadPdfJs()
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
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
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [bytes, filename, zoom])

  return (
    <section aria-label={label}>
      <h3 className={styles.pdfPreviewTitle}>{label}</h3>
      <div className={styles.pdfToolbar} role="group" aria-label="PDF zoom">
        <span role="status">{error ? 'The PDF could not be shown.' : pages === null ? 'Opening the PDF…' : `${pages} page${pages === 1 ? '' : 's'}`}</span>
        <Button variant={zoom === 'fit' ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit width</Button>
        <Button variant={zoom === 1 ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100%</Button>
        <Button variant={zoom === 1.5 ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 1.5} onClick={() => setZoom(1.5)}>150%</Button>
        <a href={url} download={filename}>Download {filename}</a>
      </div>
      {error && <p className={styles.status} role="alert">{error}</p>}
      <div ref={frameRef} className={styles.pdfFrame} data-zoom={zoom} />
    </section>
  )
}
