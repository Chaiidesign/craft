'use client'

import { useCallback, useEffect, useState } from 'react'
import { bustPersonasCache } from '@/lib/api/personas'
import { fetchDashboard, listReceived, type ReceivedShareResponse, type ShareDashboardResponse } from '@/lib/api/persona-shares'

export type SuperLinksRange = '7d' | '30d' | '90d'

const RANGE_DAYS: Record<SuperLinksRange, 7 | 30 | 90> = { '7d': 7, '30d': 30, '90d': 90 }

/**
 * Data behind the Super Links tab: the usage dashboard for the chosen date
 * range, and the links other people shared with the viewer. Both load whenever
 * the tab becomes active (or the route / range changes).
 */
export function useSuperLinksData({ active, pathname }: { active: boolean; pathname: string | null }) {
  const [dashboard, setDashboard] = useState<ShareDashboardResponse | null>(null)
  // Defaults true (not false) so the tab's zero-links empty state can't flash on
  // first mount before the fetch effect runs — dashboard is null and totalLinks
  // resolves to 0 on that very first render otherwise, which would read as
  // "confirmed empty" for a frame.
  const [sharesLoading, setSharesLoading] = useState(true)
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false)
  const [slRange, setSlRange] = useState<SuperLinksRange>('30d')
  const slDays = RANGE_DAYS[slRange]

  // Received shares (/persona-shares/received) — the tab's "Shared with me" section.
  const [receivedShares, setReceivedShares] = useState<ReceivedShareResponse[]>([])
  const [receivedLoading, setReceivedLoading] = useState(false)

  useEffect(() => {
    if (!active) return
    // Loading flag for a fetch-on-activate effect; the request below is what resolves it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSharesLoading(true)
    fetchDashboard(slDays)
      .then(setDashboard)
      .catch(console.error)
      .finally(() => setSharesLoading(false))
  }, [active, pathname, slDays])

  useEffect(() => {
    if (!active) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReceivedLoading(true)
    listReceived()
      .then(setReceivedShares)
      .catch(console.error)
      .finally(() => setReceivedLoading(false))
  }, [active, pathname])

  // Manual refresh — usage numbers (credit_used/pct_used) on a recipient's Super
  // Link only change on the backend as they use the shared agent; there's no
  // push/poll, so this re-pulls the dashboard on demand.
  const refreshDashboard = useCallback(() => {
    setDashboardRefreshing(true)
    bustPersonasCache()
    fetchDashboard(slDays)
      .then(setDashboard)
      .catch(console.error)
      .finally(() => setDashboardRefreshing(false))
  }, [slDays])

  return {
    dashboard, setDashboard, sharesLoading, dashboardRefreshing, refreshDashboard,
    slRange, setSlRange, slDays,
    receivedShares, setReceivedShares, receivedLoading,
  }
}
