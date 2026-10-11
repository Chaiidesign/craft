"use client";

import { type EnhancePromptResponse, type PersonaDocumentResponse, type PersonaRepoResponse, type PersonaStarterResponse, type PersonaVersionListItem, type PersonaVersionResponse } from "./persona-schemas";
import { resolveConnectors } from "./connectors";
import type { Connector } from "@/lib/connector";

export type {
  PersonaDocumentResponse,
  PersonaVersionResponse,
  PersonaRepoResponse,
  PersonaVersionListItem,
  PersonaSound,
  PersonaStarterResponse,
  EnhanceOption,
  EnhanceQuestion,
  EnhancePromptResponse,
} from "./persona-schemas";

// ── Normalised frontend type ──────────────────────────────────────────────────

export type PersonaStatus = "draft" | "active" | "paused";

export interface Persona {
  id: string;
  name: string;
  handle: string;
  description: string;
  imageUrl: string | null;
  modelId: string | null;
  tags: string[];
  temperature: number | null;
  isActive: boolean;
  isPaused: boolean;
  status: PersonaStatus;
  /** Live/published version used for chat/library behavior. */
  activeVersionId: string | null;
  /** Current working/configure version selected on the repo. */
  workingVersionId: string | null;
  publishedAt: string | null;
  versionCount: number;
  visibility: 'private' | 'team';
  /** Connector slugs assigned to the live version — the reference, not a copy.
   *  Use `personaConnectors()` to turn them into renderable Connector objects. */
  connectorSlugs: string[];
  blockedConnectorSlugs: string[];
  /** True when the active version has a non-empty system prompt. */
  hasSystemInstructions: boolean;
  /** Non-null when this persona was accepted from a Super Link shared by another user. */
  sourceShareId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The persona's connectors as renderable identities. Resolved on read against
 *  the cached connector catalog, so a name/logo change lands in one place. */
export function personaConnectors(persona: Pick<Persona, 'connectorSlugs'>): Connector[] {
  return resolveConnectors(persona.connectorSlugs);
}

export function personaBlockedConnectors(persona: Pick<Persona, 'blockedConnectorSlugs'>): Connector[] {
  return resolveConnectors(persona.blockedConnectorSlugs);
}

/** A draft is an agent that was never published or has no instructions yet — it belongs on /agents only. */
export function isDraftPersona(persona: Pick<Persona, 'status' | 'hasSystemInstructions'>): boolean {
  return persona.status === 'draft' || !persona.hasSystemInstructions
}

/**
 * Agents selectable inside an org-shared project context. Only org-shared
 * agents are offered there — never private/individual ones. Outside that
 * context (`teamId` null/undefined) the list is returned unchanged.
 *
 * There is only ever one organization to share to (Team has no backend route
 * left at all), so "shared to this project's org" collapses to "shared to
 * the org at all" — no separate per-project deploy set to check against.
 */
export function personasForTeamContext(
  personas: Persona[],
  teamId: string | null | undefined,
): Persona[] {
  if (!teamId) return personas
  return personas.filter(p => p.visibility === 'team')
}

/**
 * Real per-persona ownership check — NOT the same as an org-role check.
 * `PersonaRepoResponse` carries no owner field, and Team (the only backend
 * source for a real per-persona owner map) has no route left at all, so
 * `ownerMap` is always empty now — `fallbackOwned` (the coarse
 * `currentUserRole === 'admin'` guess) is what actually decides every
 * org-shared persona. Accepted capability gap — see `EMPTY_PERSONA_OWNER_MAP`
 * call sites in agents/page.tsx and LeftSidebar.tsx.
 */
export function isPersonaOwnedByViewer(
  persona: Pick<Persona, 'id' | 'visibility'>,
  ownerMap: Record<string, string>,
  viewerId: string | number | null | undefined,
  fallbackOwned: boolean,
): boolean {
  if (persona.visibility !== 'team') return true
  const ownerId = ownerMap[persona.id]
  if (ownerId) return String(ownerId) === String(viewerId)
  return fallbackOwned
}

