import { getQueryClient } from '@/lib/query-client'

export const PERSONAS_CACHE_TTL = 30_000

// React Query keys for everything persona-derived. All sit under the
// ["personas"] prefix so one prefix match busts them together.
export const PERSONAS_QUERY_KEY = ['personas'] as const
export const PERSONA_REPOS_QUERY_KEY = ['personas', 'repos'] as const
export const personaDetailQueryKey = (repoId: string) => ['personas', 'detail', repoId] as const

const invalidationListeners = new Set<() => void>()

/**
 * Subscribe to persona changes — to clear a derived cache, or to refetch.
 * Listeners run after the React Query cache has been invalidated, in
 * registration order, so a listener that calls fetchPersonas() gets fresh data
 * and caches registered at module load are cleared before component refetches.
 * Returns an unsubscribe.
 */
export function onPersonasInvalidated(listener: () => void): () => void {
  invalidationListeners.add(listener)
  return () => { invalidationListeners.delete(listener) }
}

/** Invalidate every persona-derived cache and notify subscribers to refetch. */
export function bustPersonasCache(): void {
  // Mounted observers (usePersonas) refetch; unobserved entries are dropped
  // outright so a request already in flight can't hand a pre-mutation
  // snapshot to the next fetchPersonas() caller.
  const client = getQueryClient()
  client.removeQueries({ queryKey: PERSONAS_QUERY_KEY, type: 'inactive' })
  void client.invalidateQueries({ queryKey: PERSONAS_QUERY_KEY, type: 'active' })
  for (const listener of invalidationListeners) listener()
}
