// Test- and script-only: export resources from the filesystem. Fonts are the
// committed TTFs; `/document-fixtures/…` assets are read from public/; the
// Word chart picture's PNG fallback is rasterised with sharp (installed with
// Next). Never imported by app code (it uses node:fs).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ExportResources, ImageBytes } from '../export/resources'
import { assetSources, imageType } from '../export/resources'
import { createFontSet } from '../metrics'
import type { DocumentSnapshot } from '../model'
import { resolveTheme } from '../theme'

const PUBLIC_DIR = fileURLToPath(new URL('../../../../public/', import.meta.url))

export function nodeFontBytes(themeId?: string): Map<string, Uint8Array> {
  const { theme } = resolveTheme(themeId)
  return new Map(theme.faces.map((f) => [f.file, new Uint8Array(readFileSync(fileURLToPath(f.url)))]))
}

export async function nodeRasterize(svg: string, widthPx: number, heightPx: number): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp')
  return new Uint8Array(await sharp(Buffer.from(svg), { density: 72 }).resize(widthPx, heightPx).png().toBuffer())
}

export function nodeResources(snapshot: DocumentSnapshot): ExportResources {
  const { theme } = resolveTheme(snapshot.brand.themeId)
  const fontBytes = nodeFontBytes(theme.id)
  const images = new Map<string, ImageBytes>()
  for (const src of assetSources(snapshot)) {
    const path = join(PUBLIC_DIR, src)
    const type = imageType(src)
    if (type && src.startsWith('/') && existsSync(path)) images.set(src, { bytes: new Uint8Array(readFileSync(path)), type })
  }
  return { fonts: createFontSet(theme, fontBytes), fontBytes, images, rasterize: nodeRasterize }
}
