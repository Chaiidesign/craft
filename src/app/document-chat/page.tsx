import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { DocumentChat } from './DocumentChat'

// Chat-to-document demo (D-50). The page keeps its documents in this browser;
// generation goes through /api/document-model. Outside the (app) group, so it
// needs no session (see the /document-chat rule in src/proxy.ts). Available in
// development and on Vercel preview deployments; 404s in production.

export const metadata: Metadata = {
  title: 'Draft a document (prototype)',
  robots: { index: false, follow: false },
}

export default function DocumentChatPage() {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV !== 'preview') notFound()
  return <DocumentChat />
}
