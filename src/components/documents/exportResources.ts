'use client'

// Browser export resources: the same TTF bytes the preview measures with
// (loadFontBytes is cached per URL), the bytes of every image asset that
// loads, and a canvas rasteriser for the Word chart picture's PNG fallback.

import { assetSources, imageType, type ExportResources, type ImageBytes } from '@/lib/documents/export/resources'
import { createFontSet, loadFontBytes } from '@/lib/documents/metrics'
import type { DocumentSnapshot } from '@/lib/documents/model'
import { resolveTheme } from '@/lib/documents/theme'

async function rasterize(svg: string, widthPx: number, heightPx: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable for the chart picture')
    ctx.drawImage(img, 0, 0, widthPx, heightPx)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Chart picture could not be encoded as PNG')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function browserExportResources(snapshot: DocumentSnapshot): Promise<ExportResources> {
  const { theme } = resolveTheme(snapshot.brand.themeId)
  const fontBytes = new Map(await Promise.all(theme.faces.map(async (f) => [f.file, await loadFontBytes(f.url)] as const)))
  const images = new Map<string, ImageBytes>()
  await Promise.all(assetSources(snapshot).map(async (src) => {
    const type = imageType(src)
    if (!type) return
    const res = await fetch(src).catch(() => null)
    if (res?.ok) images.set(src, { bytes: new Uint8Array(await res.arrayBuffer()), type })
  }))
  return { fonts: createFontSet(theme, fontBytes), fontBytes, images, rasterize }
}
