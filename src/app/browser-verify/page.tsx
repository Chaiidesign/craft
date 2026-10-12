'use client'

// ── Dev-only verification harness ──────────────────────────────────────────
// Mounts the REAL Browser panel screen, driving a display link passed as
// ?url=, so the video path can be exercised without a chat or a login.
// Reachable at /browser-verify in dev only (see the guard in src/proxy.ts).
// Not linked anywhere. Safe to delete.

import React, { useEffect, useState } from 'react'
import { BrowserScreen } from '@/components/BrowserPanel/BrowserScreen'
import { setOpenedView, useBrowserSession } from '@/components/BrowserPanel/use-browser-session'

export default function BrowserVerifyPage() {
  const session = useBrowserSession()
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('url')
    if (url) setOpenedView({ url, pageUrl: 'https://example.com/' })
    return () => setOpenedView(null)
  }, [])
  return (
    <main style={{ width: 960, margin: '24px auto', fontFamily: 'sans-serif' }}>
      <p id="state">{session.status} · control={String(session.control)} · frame={session.frame ? 'set' : 'none'}</p>
      <BrowserScreen session={session} expanded={expanded} onExpandedChange={setExpanded} />
    </main>
  )
}
