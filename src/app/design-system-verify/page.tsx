// ── Dev-only demo: image → design system → reskinned chat document block ─────
// Runs fully offline on the mock extractor and sample images; no backend, no
// AI calls. Outside the (app) group so it skips the auth shell, and let
// through without a session in development and previews (see src/proxy.ts).
// Returns 404 in production.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DesignSystemWorkbench } from '@/components/design-system/workbench/DesignSystemWorkbench'

export const metadata: Metadata = {
  title: 'Image to design system',
  robots: { index: false, follow: false },
}

export default function DesignSystemVerifyPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <DesignSystemWorkbench />
}
