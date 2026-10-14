'use client'

// Loads a document theme's TTFs once and uses the same bytes twice: registered
// with the browser (FontFace) for drawing, and parsed into metrics for the
// layout engine. Layout therefore measures exactly the files the page draws
// with — and the files the PDF exporter will embed. If any face fails, the
// preview reports it instead of laying out with a fallback font.

import { useEffect, useMemo, useState } from 'react'

import { createFontSet, loadFontBytes, type FontSet } from '@/lib/documents/metrics'
import { resolveTheme } from '@/lib/documents/theme'

export type FontLoadState =
  | { status: 'loading' }
  | { status: 'ready'; fonts: FontSet }
  | { status: 'failed'; failedFiles: string[] }

const LOADING: FontLoadState = { status: 'loading' }

export function useDocumentFonts(themeId: string | undefined): FontLoadState {
  // The settled result is tagged with its theme; a result for another theme reads as loading.
  const [settled, setSettled] = useState<{ themeId: string | undefined; state: FontLoadState } | null>(null)

  useEffect(() => {
    let cancelled = false
    const { theme } = resolveTheme(themeId)
    Promise.allSettled(theme.faces.map(async (face) => {
      const bytes = await loadFontBytes(face.url)
      const loaded = await new FontFace(theme.roles[face.role].family, bytes.slice().buffer, {
        weight: String(face.weight),
        style: face.style,
        display: 'block',
      }).load()
      document.fonts.add(loaded)
      return [face.file, bytes] as const
    })).then((results) => {
      if (cancelled) return
      const failedFiles = results.flatMap((r, i) => (r.status === 'rejected' ? [theme.faces[i].file] : []))
      if (failedFiles.length) { setSettled({ themeId, state: { status: 'failed', failedFiles } }); return }
      const bytes = new Map(results.map((r) => (r as PromiseFulfilledResult<readonly [string, Uint8Array]>).value))
      setSettled({ themeId, state: { status: 'ready', fonts: createFontSet(theme, bytes) } })
    })
    return () => { cancelled = true }
  }, [themeId])

  return settled && settled.themeId === themeId ? settled.state : LOADING
}

/** Checks which local image assets actually load, so layout uses the labelled fallback for broken files. */
export function useAssetAvailability(srcs: readonly string[]): { checked: boolean; unavailable: ReadonlySet<string> } {
  const key = [...srcs].sort().join('|')
  const [result, setResult] = useState<{ key: string; unavailable: Set<string> } | null>(null)
  useEffect(() => {
    let cancelled = false
    const list = key ? key.split('|') : []
    Promise.all(list.map((src) => new Promise<[string, boolean]>((resolve) => {
      const img = new Image()
      img.onload = () => resolve([src, true])
      img.onerror = () => resolve([src, false])
      img.src = src
    }))).then((checks) => {
      if (!cancelled) setResult({ key, unavailable: new Set(checks.filter(([, ok]) => !ok).map(([src]) => src)) })
    })
    return () => { cancelled = true }
  }, [key])
  // Stable identity per result, so consumers can memoise on it without re-rendering in a loop.
  return useMemo(() => (result && result.key === key ? { checked: true, unavailable: result.unavailable } : NOT_CHECKED), [result, key])
}

const NOT_CHECKED: { checked: boolean; unavailable: ReadonlySet<string> } = { checked: false, unavailable: new Set() }
