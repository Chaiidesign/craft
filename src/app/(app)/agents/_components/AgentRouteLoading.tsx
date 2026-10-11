import React from 'react'
import { Skeleton } from '@/components/Skeleton'

/** Route-transition placeholder shared by the agent routes' `loading.tsx` files. */
export function AgentRouteLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      style={{ flex: '1 0 0', display: 'flex', flexDirection: 'column', gap: 24, padding: 32, minHeight: 0 }}
    >
      <Skeleton width={240} height={28} radius={8} />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: 1 - i * 0.15 }}>
          <Skeleton width={120} height={12} />
          <Skeleton height={40} radius={10} />
        </div>
      ))}
    </div>
  )
}
