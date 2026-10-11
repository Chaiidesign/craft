'use client'

import { AgentRouteError } from './_components/AgentRouteError'

export default function AgentsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return <AgentRouteError error={error} onRetry={unstable_retry} />
}
