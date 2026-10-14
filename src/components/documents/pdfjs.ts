'use client'

// pdf.js in the browser: the worker is public/pdf.worker.min.mjs, identical to
// the installed pdfjs-dist build (same version, so API and worker match).

type PdfJs = typeof import('pdfjs-dist')

let loading: Promise<PdfJs> | null = null
export function loadPdfJs(): Promise<PdfJs> {
  if (!loading) {
    loading = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      return pdfjs
    })
    loading.catch(() => { loading = null })
  }
  return loading
}

/** Text drawn on each page of a PDF (scenario checks read the generated file itself). */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfJs()
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  try {
    const out: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(''))
    }
    return out
  } finally {
    await doc.destroy()
  }
}
