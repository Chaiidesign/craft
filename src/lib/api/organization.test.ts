import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetchJson } = vi.hoisted(() => ({ apiFetchJson: vi.fn() }))

vi.mock('./client', async importOriginal => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, apiFetchJson }
})

import { listMembers } from './organization'

// Regression coverage for a live ZodError: services/organizations/schemas.py's
// MemberResponse declares a `serialization_alias` on every multi-word field
// (userId, usageTotal, inviteStatus, inviteId, isPendingInvite), and FastAPI
// serializes with `by_alias=True` by default — so the actual wire shape is
// camelCase even though PlanResponse's own top-level fields (organization_id,
// plan_type, ...) have no alias and stay snake_case.

describe('listMembers', () => {
  beforeEach(() => {
    apiFetchJson.mockReset()
  })

  it('parses the camelCase MemberResponse shape', async () => {
    apiFetchJson.mockResolvedValue([{
      userId: 'user-1', name: 'Ada', email: 'ada@example.com', role: 'admin',
      usageTotal: 0, inviteStatus: 'active', inviteId: null, isPendingInvite: false,
    }])

    const members = await listMembers('org-1')
    expect(members[0]).toEqual(expect.objectContaining({ id: 'user-1', email: 'ada@example.com' }))
  })
})
