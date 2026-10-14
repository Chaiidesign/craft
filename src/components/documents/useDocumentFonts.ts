'use client'

// Loads a document theme's faces into the browser with the FontFace API, from
// the same TTF files the PDF/DOCX exporters embed. Client-only (runs in an
// effect), so server and client markup never disagree. Reports per-face status
// so the preview can say when it is showing a fallback instead of the theme.

import { useEffect, useState } from 'react'

import { resolveTheme } from '@/lib/documents/theme'

export type FontLoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; failedFiles: string[] }

const LOADING: FontLoadState = { status: 'loading' }

export function useDocumentFonts(themeId: string | undefined): FontLoadState {
  // The settled result is tagged with its theme; a result for another theme reads as loading.
  const [settled, setSettled] = useState<{ themeId: string | undefined; state: FontLoadState } | null>(null)

  useEffect(() => {
    let cancelled = false
    const { theme } = resolveTheme(themeId)
    Promise.allSettled(theme.faces.map(async (face) => {
      const family = theme.roles[face.role].family
      const loaded = await new FontFace(family, `url(${face.url.href}) format("truetype")`, {
        weight: String(face.weight),
        style: face.style,
        display: 'block',
      }).load()
      document.fonts.add(loaded)
      return face.file
    })).then((results) => {
      if (cancelled) return
      const failedFiles = results.flatMap((r, i) => (r.status === 'rejected' ? [theme.faces[i].file] : []))
      setSettled({ themeId, state: failedFiles.length ? { status: 'failed', failedFiles } : { status: 'ready' } })
    })
    return () => { cancelled = true }
  }, [themeId])

  return settled && settled.themeId === themeId ? settled.state : LOADING
}
