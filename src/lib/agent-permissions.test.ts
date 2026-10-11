import { describe, expect, it } from 'vitest'
import { agentRole, can, type AgentViewer } from './agent-permissions'

const persona = (over: Partial<{ id: string; visibility: 'private' | 'team'; sourceShareId: string | null }> = {}) => ({
  id: 'a1', visibility: 'private' as const, sourceShareId: null, ...over,
})
const member: AgentViewer = { userId: 'u1', isAdmin: false }
const admin: AgentViewer = { userId: 'u1', isAdmin: true }

describe('agentRole', () => {
  it('private own agent → owner', () => {
    expect(agentRole(persona(), member)).toBe('owner')
  })
  it('private agent received via Super Link → recipient', () => {
    expect(agentRole(persona({ sourceShareId: 's1' }), member)).toBe('recipient')
  })
  it('team agent, non-admin, owner unknown → team-viewer', () => {
    expect(agentRole(persona({ visibility: 'team' }), member)).toBe('team-viewer')
  })
  it('team agent, admin fallback → owner', () => {
    expect(agentRole(persona({ visibility: 'team' }), admin)).toBe('owner')
  })
  it('team agent with a known owner follows the owner id, not the admin guess', () => {
    const p = persona({ visibility: 'team' })
    expect(agentRole(p, { ...admin, ownerMap: { a1: 'someone-else' } })).toBe('team-viewer')
    expect(agentRole(p, { ...member, ownerMap: { a1: 'u1' } })).toBe('owner')
  })
  it('team-viewer wins over recipient', () => {
    expect(agentRole(persona({ visibility: 'team', sourceShareId: 's1' }), member)).toBe('team-viewer')
  })
})

describe('can', () => {
  it('owner may do everything except copy', () => {
    for (const a of ['list', 'use', 'edit', 'share', 'pause', 'delete'] as const) {
      expect(can(member, a, persona())).toBe(true)
    }
    expect(can(member, 'copy', persona())).toBe(false)
  })
  it('recipient may use, list and delete but not edit, share or pause', () => {
    const p = persona({ sourceShareId: 's1' })
    expect(can(member, 'list', p)).toBe(true)
    expect(can(member, 'use', p)).toBe(true)
    expect(can(member, 'delete', p)).toBe(true)
    expect(can(member, 'edit', p)).toBe(false)
    expect(can(member, 'share', p)).toBe(false)
    expect(can(member, 'pause', p)).toBe(false)
  })
  it('team-viewer may only use and copy', () => {
    const p = persona({ visibility: 'team' })
    expect(can(member, 'use', p)).toBe(true)
    expect(can(member, 'copy', p)).toBe(true)
    for (const a of ['list', 'edit', 'share', 'pause', 'delete'] as const) {
      expect(can(member, a, p)).toBe(false)
    }
  })
})
