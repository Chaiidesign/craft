// What a renderer needs besides the snapshot, injected so renderers never
// fetch or read files themselves: the theme's font metrics and the exact TTF
// bytes the preview measured with (embedded as-is), the bytes of image assets
// that actually loaded, and an SVG → PNG rasteriser for the Word chart
// picture's fallback. The browser and the Node sample script each provide
// their own loader; renderers are identical in both.

import type { FontSet } from '../metrics'
import type { DocumentSnapshot } from '../model'

export interface ImageBytes {
  bytes: Uint8Array
  type: 'png' | 'jpeg'
}

export interface ExportResources {
  fonts: FontSet
  /** Font file bytes by `ThemeFace.file`, unmodified. */
  fontBytes: ReadonlyMap<string, Uint8Array>
  /** Assets that loaded, by `src`. Anything absent is unavailable and gets the labelled fallback. */
  images: ReadonlyMap<string, ImageBytes>
  /** SVG (no text — glyphs are outlines) → PNG at the given pixel size. */
  rasterize(svg: string, widthPx: number, heightPx: number): Promise<Uint8Array>
}

/** Every local image `src` a snapshot refers to (logo and image blocks). */
export function assetSources(snapshot: DocumentSnapshot): string[] {
  const out = new Set<string>()
  if (snapshot.brand.logo) out.add(snapshot.brand.logo.src)
  for (const b of snapshot.blocks) if (b.type === 'image') out.add(b.asset.src)
  return [...out]
}

export function unavailableAssets(snapshot: DocumentSnapshot, resources: ExportResources): Set<string> {
  return new Set(assetSources(snapshot).filter((src) => !resources.images.has(src)))
}

export function imageType(src: string): ImageBytes['type'] | null {
  if (/\.png$/i.test(src)) return 'png'
  if (/\.jpe?g$/i.test(src)) return 'jpeg'
  return null
}
