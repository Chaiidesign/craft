"use client";

import { apiFetch, apiFetchJson } from "./client";
import { personaRepoSchema, type PersonaRepoResponse } from "./persona-schemas";
import { fetchPersonaRepo, fetchPersonaRepos } from "./persona-repo";
import { PERSONAS_CACHE_TTL, PERSONAS_QUERY_KEY, bustPersonasCache, personaDetailQueryKey } from "./persona-cache";
import { getQueryClient } from "@/lib/query-client";
import { trackBrowserEvent } from "@/lib/analytics/events";
import { clearPersonaRepoStorage } from "@/lib/storage-keys";
import { PERSONAS_ENDPOINT, PERSONA_DETAIL_ENDPOINT, PERSONA_USE_ENDPOINT, PERSONA_PAUSE_ENDPOINT, PERSONA_ACTIVE_ENDPOINT, PERSONA_PUBLISH_ENDPOINT, PERSONA_VISIBILITY_ENDPOINT, directUpload } from "@/lib/config";
import type { Persona } from "./persona-model";

// ── Repo CRUD ─────────────────────────────────────────────────────────────────

// Caching lives in React Query (see lib/query-client.ts). Mutating operations
// (create, delete, save) must call bustPersonasCache() to invalidate it.

export { bustPersonasCache } from "./persona-cache";

/** The uncached list load — the queryFn shared by fetchPersonas() and usePersonas(). */
export async function loadPersonas(): Promise<Persona[]> {
  return (await fetchPersonaRepos()).toPersonas()
}

/**
 * Cached persona list. Shares one React Query entry (and one in-flight
 * request) with usePersonas(); bustPersonasCache() invalidates it.
 */
export function fetchPersonas(): Promise<Persona[]> {
  return getQueryClient().fetchQuery({
    queryKey: PERSONAS_QUERY_KEY,
    queryFn: loadPersonas,
    staleTime: PERSONAS_CACHE_TTL,
    retry: false,
  })
}

export async function getPersona(repoId: string): Promise<Persona> {
  return (await fetchPersonaRepo(repoId)).toPersona();
}

export async function getPersonaRepo(repoId: string): Promise<PersonaRepoResponse> {
  return getPersonaRepoWithCache(repoId);
}

/**
 * Cached variant of getPersonaRepo — used by the /agents list page so that
 * persona_tags + image_url are available instantly on return visits.
 * Cache is busted by bustPersonasCache() (called on publish / delete / update).
 */
export function getPersonaRepoWithCache(repoId: string): Promise<PersonaRepoResponse> {
  return getQueryClient().fetchQuery({
    queryKey: personaDetailQueryKey(repoId),
    staleTime: PERSONAS_CACHE_TTL,
    retry: false,
    queryFn: async () => personaRepoSchema.parse(await apiFetchJson<unknown>(PERSONA_DETAIL_ENDPOINT(repoId))),
  })
}

export async function createPersonaRepo(params: {
  name: string;
  modelId: string;
  prompt?: string;
  description?: string;
  temperature?: number | null;
  /** Persona tags (a JSON array on the wire). */
  tags?: string[];
  image?: File | null;
}): Promise<PersonaRepoResponse> {
  const form = new FormData();
  form.append("name", params.name);
  if (params.modelId) form.append("model_id", params.modelId);
  if (params.prompt) form.append("prompt", params.prompt);
  if (params.description) form.append("description", params.description);
  if (params.temperature != null) form.append("temperature", String(params.temperature));
  if (params.tags && params.tags.length > 0) form.append("persona_tags", JSON.stringify(params.tags));
  if (params.image) form.append("image", params.image);
  // Direct-to-backend: image uploads can exceed the 4.5 MB serverless proxy cap.
  const repo = personaRepoSchema.parse(await apiFetchJson<unknown>(directUpload(PERSONAS_ENDPOINT), {
    method: "POST",
    body: form,
  }));
  // Invalidate the shared list/detail cache so /agents never renders a pre-creation snapshot.
  bustPersonasCache();
  return repo;
}

/**
 * POST /persona/{repoId}/use — copy a visible persona (e.g. a team-published one)
 * into the caller's own list. Returns the newly-created repo. Busts the list so
 * the copy shows up immediately.
 *
 * Named `copyPersonaRepo` (not `usePersonaRepo`) deliberately — a `use`-prefixed
 * name on a plain async function trips eslint-plugin-react-hooks' rules-of-hooks
 * heuristic (any `use[A-Z]…` identifier is treated as a hook call site) wherever
 * this is awaited inside a conditional branch, which it legitimately is in several
 * callers. It was never a hook; the old name was flagged as 3 "hook called
 * conditionally" errors purely from the naming collision.
 */
export async function copyPersonaRepo(repoId: string): Promise<PersonaRepoResponse> {
  const repo = personaRepoSchema.parse(await apiFetchJson<unknown>(PERSONA_USE_ENDPOINT(repoId), {
    method: "POST",
  }));
  bustPersonasCache();
  return repo;
}

export async function deletePersona(repoId: string): Promise<void> {
  // apiFetch returns non-2xx responses as-is (it doesn't throw), so we must check
  // res.ok ourselves — otherwise a failed delete would look successful and the
  // caller would optimistically remove the card for an agent still on the server.
  const res = await apiFetch(PERSONA_DETAIL_ENDPOINT(repoId), { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete persona (status ${res.status})`);
  // Drop this agent's per-repo browser storage so the keys don't accumulate.
  clearPersonaRepoStorage(repoId);
  // Mutation — bust so every consumer (sidebar, search, agents grid) refetches.
  bustPersonasCache();
}

export async function togglePause(repoId: string): Promise<void> {
  // Same guard as deletePersona: apiFetch won't throw on non-2xx, so check
  // res.ok before the caller optimistically flips pause state in the UI.
  const res = await apiFetch(PERSONA_PAUSE_ENDPOINT(repoId), { method: "PATCH" });
  if (!res.ok) throw new Error(`Failed to toggle pause (status ${res.status})`);
  bustPersonasCache();
}

export async function setActiveVersion(repoId: string, versionId: string): Promise<PersonaRepoResponse> {
  return personaRepoSchema.parse(await apiFetchJson<unknown>(PERSONA_ACTIVE_ENDPOINT(repoId), {
    method: "PATCH",
    body: JSON.stringify({ persona_id: versionId }),
  }));
}

export async function publishPersonaVersion(repoId: string, versionId: string): Promise<PersonaRepoResponse> {
  const result = personaRepoSchema.parse(await apiFetchJson<unknown>(PERSONA_PUBLISH_ENDPOINT(repoId), {
    method: "POST",
    body: JSON.stringify({ persona_id: versionId }),
  }));
  // Analytics: do agents spread beyond their creator? (choke point for all publish flows)
  trackBrowserEvent("agent_published");
  return result;
}

/** PATCH /persona/{repoId}/visibility — 204 */
export async function setPersonaVisibility(
  repoId: string,
  visibility: 'private' | 'team',
  teamId?: string,
): Promise<void> {
  // Backend's real enum is ("private", "shared") — VISIBILITY_VALUES in
  // services/organizations/schemas.py. "org" isn't a valid value there at
  // all: every call with it 400s, so sharing an agent has never worked.
  const body: Record<string, unknown> = { visibility: visibility === 'team' ? 'shared' : 'private' }
  if (visibility === 'team' && teamId) body.organizationId = teamId
  const res = await apiFetch(PERSONA_VISIBILITY_ENDPOINT(repoId), {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Failed to update visibility (status ${res.status})`)
}

/** Names compare ignoring case, outer whitespace and runs of inner whitespace. */
export function normalizeAgentName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The agent that already uses `name`, if any (every agent the viewer can see, so a name never
 * means two things in the list or the @-mention menu). `excludeRepoId` is the agent being
 * edited, so keeping its own name is fine. Reads a fresh list; fails open (null) when the
 * list can't be fetched — the backend stays the final word.
 */
export async function findAgentNameConflict(name: string, excludeRepoId?: string): Promise<Persona | null> {
  const wanted = normalizeAgentName(name)
  if (!wanted) return null
  try {
    bustPersonasCache()
    const personas = await fetchPersonas()
    return personas.find(p => p.id !== excludeRepoId && normalizeAgentName(p.name) === wanted) ?? null
  } catch {
    return null
  }
}
