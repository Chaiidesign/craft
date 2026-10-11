"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { deletePersona, loadPersonas, togglePause, type Persona } from "@/lib/api/personas";
import { PERSONAS_QUERY_KEY } from "@/lib/api/persona-cache";

// Shared cache entry for the personas list. fetchPersonas() reads the very same
// entry (same key, same QueryClient), and bustPersonasCache() invalidates it, so
// React and non-React callers see one cache and one in-flight request.
export { PERSONAS_QUERY_KEY };

export function usePersonas() {
  return useQuery({
    queryKey: PERSONAS_QUERY_KEY,
    queryFn: loadPersonas,
    // The old code never retried a failed list fetch — keep that.
    retry: false,
  });
}

// ── Optimistic mutations ─────────────────────────────────────────────────────
// Each helper applies the change to the cached list immediately and returns a
// rollback that undoes just that agent's change, so a failure never clobbers
// unrelated edits made in the meantime. The API call itself still busts the
// cache on success, so the list then refetches the server's truth.

/** The agent after a pause ↔ resume flip. Keeps isPaused === !isActive === (status === 'paused'). */
export function withTogglePause(p: Persona): Persona {
  const nextActive = p.isPaused; // was paused → resuming
  return {
    ...p,
    isActive: nextActive,
    isPaused: !nextActive,
    // Paused takes precedence; when resuming fall back to live/draft by published version.
    status: !nextActive ? "paused" : p.activeVersionId ? "active" : "draft",
  };
}

async function beginOptimistic(queryClient: QueryClient) {
  // An in-flight list fetch would overwrite the optimistic change when it lands.
  await queryClient.cancelQueries({ queryKey: PERSONAS_QUERY_KEY, exact: true });
  return queryClient.getQueryData<Persona[]>(PERSONAS_QUERY_KEY);
}

export async function optimisticTogglePause(queryClient: QueryClient, id: string): Promise<() => void> {
  const before = (await beginOptimistic(queryClient))?.find(p => p.id === id);
  queryClient.setQueryData<Persona[]>(PERSONAS_QUERY_KEY, list =>
    list?.map(p => (p.id === id ? withTogglePause(p) : p)),
  );
  return () => {
    if (!before) return;
    queryClient.setQueryData<Persona[]>(PERSONAS_QUERY_KEY, list =>
      list?.map(p => (p.id === id ? before : p)),
    );
  };
}

export async function optimisticDelete(queryClient: QueryClient, id: string): Promise<() => void> {
  const list = await beginOptimistic(queryClient);
  const index = list?.findIndex(p => p.id === id) ?? -1;
  const removed = index >= 0 ? list![index] : undefined;
  queryClient.setQueryData<Persona[]>(PERSONAS_QUERY_KEY, current => current?.filter(p => p.id !== id));
  return () => {
    if (!removed) return;
    queryClient.setQueryData<Persona[]>(PERSONAS_QUERY_KEY, current => {
      if (!current || current.some(p => p.id === id)) return current;
      const next = current.slice();
      next.splice(Math.min(index, next.length), 0, removed);
      return next;
    });
  };
}

/** Pause/resume an agent: the card flips at once and reverts if the request fails. */
export function useTogglePauseAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => togglePause(id),
    onMutate: async (id): Promise<{ rollback: () => void }> => ({
      rollback: await optimisticTogglePause(queryClient, id),
    }),
    onError: (_err, _id, ctx) => ctx?.rollback(),
  });
}

/** Delete an agent: it leaves the list at once and is put back if the request fails. */
export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePersona(id),
    onMutate: async (id): Promise<{ rollback: () => void }> => ({
      rollback: await optimisticDelete(queryClient, id),
    }),
    onError: (_err, _id, ctx) => ctx?.rollback(),
  });
}
