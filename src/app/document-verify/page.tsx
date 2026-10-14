import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { DocumentWorkbench } from './DocumentWorkbench'

// Document-quality workbench. Fictional fixtures and local state only — no
// backend, AI, auth or sending. Lives outside the (app) group so it needs no
// session (see the /document-verify guard in src/proxy.ts). Available in
// development and on Vercel preview deployments; 404s in production.

export const metadata: Metadata = {
  title: 'Document quality workbench (prototype)',
  robots: { index: false, follow: false },
}

export default function DocumentVerifyPage() {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV !== 'preview') notFound()
  return <DocumentWorkbench />
}
