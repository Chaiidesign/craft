// Test-only: reads a generated PDF back with pdfjs (legacy Node build) —
// page count, page sizes and the text drawn on each page.

export async function readPdf(bytes: Uint8Array): Promise<{ pages: { width: number; height: number; text: string }[]; info: Record<string, unknown> }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const [, , width, height] = page.view
    const content = await page.getTextContent()
    pages.push({ width, height, text: content.items.map((it) => ('str' in it ? it.str : '')).join('') })
  }
  const meta = await doc.getMetadata()
  await doc.destroy()
  return { pages, info: meta.info as Record<string, unknown> }
}

/** Whitespace (including no-break spaces) removed, for comparing drawn text with engine lines. */
export const squash = (s: string) => s.replace(/[\s ]+/g, '')
