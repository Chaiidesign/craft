import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { OutputVerify } from './OutputVerify'

// Output-system prototype (build-loop.md). Sample stores and local state only.
// Development only: 404 everywhere else, including Vercel previews (D-78).
// It lives outside the (app) group; the /output-verify line in src/proxy.ts
// that lets it through without a session waits for Chaitanya's approval.

export const metadata: Metadata = {
  title: 'Output verify (prototype)',
  robots: { index: false, follow: false },
}

export default function OutputVerifyPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <OutputVerify />
}
