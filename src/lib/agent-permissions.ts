import { isPersonaOwnedByViewer, type Persona } from '@/lib/api/persona-model'

/**
 * Who may do what with an agent — one place instead of per-screen checks on
 * `visibility`, `sourceShareId` and the org role.
 *
 * Roles, in precedence order:
 *  - `team-viewer`: org-shared (`visibility: 'team'`) and not the viewer's own.
 *                   They copy it before changing anything.
 *  - `recipient`:   accepted from someone's Super Link (`sourceShareId` set).
 *                   They can use and remove it, never edit or re-share it.
 *  - `owner`:       everything else the viewer can see.
 */
export interface AgentViewer {
  userId: string | number | null | undefined
  /** Org admin — the fallback owner guess for team agents with no known owner. */
  isAdmin: boolean
  /** persona id → owner user id, when known. Usually empty (no backend source). */
  ownerMap?: Record<string, string>
}

export type AgentRole = 'owner' | 'recipient' | 'team-viewer'

export type AgentAction =
  | 'list'    // appears in the viewer's agent list / pickers
  | 'use'     // start a chat with it
  | 'edit'
  | 'share'
  | 'pause'
  | 'delete'
  | 'copy'    // clone into the viewer's own account

type PersonaFacts = Pick<Persona, 'id' | 'visibility' | 'sourceShareId'>

export function agentRole(persona: PersonaFacts, viewer: AgentViewer): AgentRole {
  const owned = isPersonaOwnedByViewer(persona, viewer.ownerMap ?? {}, viewer.userId, viewer.isAdmin)
  if (persona.visibility === 'team' && !owned) return 'team-viewer'
  if (persona.sourceShareId !== null) return 'recipient'
  return 'owner'
}

export function can(viewer: AgentViewer, action: AgentAction, persona: PersonaFacts): boolean {
  const role = agentRole(persona, viewer)
  switch (action) {
    case 'list':
      // Same rule as before: org-shared agents the viewer doesn't own never list.
      return role !== 'team-viewer'
    case 'use':
      return true
    case 'edit':
    case 'share':
    case 'pause':
      return role === 'owner'
    case 'delete':
      return role !== 'team-viewer'
    case 'copy':
      return role === 'team-viewer'
  }
}
