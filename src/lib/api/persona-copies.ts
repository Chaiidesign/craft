"use client";

import { type PersonaRepoResponse } from "./persona-schemas";
import { bustPersonasCache } from "./persona-cache";
import { copyPersonaRepo, getPersonaRepo, getPersonaRepoWithCache } from "./persona-list";
import { updateVersion } from "./persona-versions";

const COPY_MAP_LS_KEY = 'persona_copy_map'
// repoId (source) -> the source's published_version_id at the moment it was last
// copied/updated. There is no backend field linking a team-clone back to its
// source (unlike Super Link's source_share_id), so this — like COPY_MAP_LS_KEY
// itself — lives only in localStorage. Used purely to detect "the source has
// published something new since I copied/last updated" (see getTeamAgentCopyStatus).
const COPY_SOURCE_VERSION_LS_KEY = 'persona_copy_source_version'

function readJsonMap(key: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

function writeJsonMap(key: string, map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, JSON.stringify(map)) } catch { /* ignore quota errors */ }
}

/** repoId (this account's copy) that was cloned from `sourceRepoId`, if any. */
export function getExistingCopyId(sourceRepoId: string): string | null {
  return readJsonMap(COPY_MAP_LS_KEY)[sourceRepoId] ?? null
}

/**
 * Like copyPersonaRepo but deduplicates across sessions via localStorage.
 * Checks if the caller already has a copy of `repoId`; only POSTs /use when
 * no valid copy exists. Prevents unbounded copy accumulation when the
 * session-scoped caches in AddMenu / project page are cleared on refresh.
 *
 * `sourceVersionId` — pass the source's current published_version_id when the
 * caller has it handy (e.g. `persona.activeVersionId`) so getTeamAgentCopyStatus
 * can later tell whether the source has published something newer. Optional and
 * backward compatible: omitting it just means status checks fall back to
 * "assume stale" for this repo until the next copy/update records it.
 */
export async function copyPersonaRepoDeduped(repoId: string, sourceVersionId?: string | null): Promise<PersonaRepoResponse> {
  if (typeof window !== 'undefined') {
    try {
      const map = readJsonMap(COPY_MAP_LS_KEY)
      const existingId = map[repoId]
      if (existingId) {
        try {
          const existing = await getPersonaRepoWithCache(existingId)
          return existing
        } catch {
          delete map[repoId]
          writeJsonMap(COPY_MAP_LS_KEY, map)
        }
      }
    } catch { /* ignore parse/quota errors */ }
  }
  const copy = await copyPersonaRepo(repoId)
  if (typeof window !== 'undefined') {
    try {
      const map = readJsonMap(COPY_MAP_LS_KEY)
      map[repoId] = copy.id
      writeJsonMap(COPY_MAP_LS_KEY, map)
      if (sourceVersionId) {
        const versionMap = readJsonMap(COPY_SOURCE_VERSION_LS_KEY)
        versionMap[repoId] = sourceVersionId
        writeJsonMap(COPY_SOURCE_VERSION_LS_KEY, versionMap)
      }
    } catch { /* ignore quota errors */ }
  }
  return copy
}

export type TeamAgentCopyStatus = 'not_copied' | 'up_to_date' | 'update_available'

/**
 * Whether the caller has copied `sourceRepoId` yet, and if so whether the
 * source has published a newer version since the copy/last update. Missing
 * tracking data (e.g. a copy made before this tracking existed) is treated as
 * "update available" — the safe default, since an update in that case is a
 * harmless no-op overwrite with identical content.
 */
export function getTeamAgentCopyStatus(sourceRepoId: string, sourceCurrentVersionId: string | null): TeamAgentCopyStatus {
  const copyId = getExistingCopyId(sourceRepoId)
  if (!copyId) return 'not_copied'
  const copiedVersionId = readJsonMap(COPY_SOURCE_VERSION_LS_KEY)[sourceRepoId]
  if (!copiedVersionId || !sourceCurrentVersionId || copiedVersionId !== sourceCurrentVersionId) return 'update_available'
  return 'up_to_date'
}

/**
 * Refreshes the caller's existing copy of `sourceRepoId` with the source's
 * current published content (name/prompt/description/model/temperature/tags/
 * avatar) — PATCHed onto the copy's own published version in place, so the
 * copy keeps its own repo/version identity (chat history, etc.) rather than
 * being re-cloned. Knowledge documents are NOT synced — there is no frontend-
 * callable endpoint to duplicate documents onto an existing repo (only the
 * initial clone's server-side use_repo can do that), so a recipient whose
 * source agent's knowledge changed would need to re-copy to pick that up.
 * Throws if the caller has no existing copy to update.
 */
export async function updatePersonaCopyToLatest(sourceRepoId: string): Promise<PersonaRepoResponse> {
  const copyId = getExistingCopyId(sourceRepoId)
  if (!copyId) throw new Error('No existing copy to update')

  const [source, copy] = await Promise.all([
    getPersonaRepo(sourceRepoId),
    getPersonaRepo(copyId),
  ])
  const sourceVersion = source.published_version
  if (!sourceVersion || !source.published_version_id) throw new Error('Source agent has no published version')
  const copyVersionId = copy.published_version_id ?? copy.active_version_id
  if (!copyVersionId) throw new Error('Your copy has no version to update')

  const updated = await updateVersion({
    repoId: copyId,
    versionId: copyVersionId,
    name: sourceVersion.name,
    prompt: sourceVersion.prompt,
    description: sourceVersion.description,
    modelId: sourceVersion.model_id ?? undefined,
    temperature: sourceVersion.temperature,
    persona_tags: sourceVersion.persona_tags,
    imageUrl: sourceVersion.image_url,
  })

  const versionMap = readJsonMap(COPY_SOURCE_VERSION_LS_KEY)
  versionMap[sourceRepoId] = source.published_version_id
  writeJsonMap(COPY_SOURCE_VERSION_LS_KEY, versionMap)
  bustPersonasCache()

  return { ...copy, published_version: updated, active_version: copy.active_version_id === copyVersionId ? updated : copy.active_version }
}

