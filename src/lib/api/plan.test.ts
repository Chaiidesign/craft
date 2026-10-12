import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetchJson } = vi.hoisted(() => ({ apiFetchJson: vi.fn() }))

vi.mock('./client', async importOriginal => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, apiFetchJson }
})

import { Plan } from './plan'

// Mirrors services/organizations/schemas.py PlanResponse: snake_case top level,
// camelCase members (MemberResponse declares a serialization_alias per field).
function rawPlan(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: 'org-1',
    plan_type: null,
    billing_model: 'prepaid',
    plan_credits: 0,
    topup_credits: 0,
    total_credits: 0,
    used: 0,
    remaining: 0,
    percent_used: 0,
    pool_status: 'healthy',
    members: [{
      userId: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'admin',
      usageTotal: 12.5,
      inviteStatus: 'active',
      inviteId: null,
      isPendingInvite: false,
    }],
    ...overrides,
  }
}

describe('Plan', () => {
  beforeEach(() => {
    apiFetchJson.mockReset()
  })

  it('reads an unselected org as a Free Plan with nothing to spend', async () => {
    apiFetchJson.mockResolvedValue(rawPlan())

    const plan = await Plan.fetch('org-1')

    expect(plan.planType).toBeNull()
    expect(plan.hasSelectedPlan).toBe(false)
    expect(plan.isFunded).toBe(false)
    expect(plan.chipLabel).toBe('Free Plan')
    expect(plan.members).toEqual([expect.objectContaining({
      id: 'user-1', name: 'Ada', email: 'ada@example.com', role: 'admin', inviteStatus: 'signed_up', creditUsed: 12500,
    })])
  })

  it('renders a Teams plan from the backend tier, cycle, and wallet', () => {
    const plan = Plan.parse(rawPlan({
      plan_type: 'teams', plan_id: '250', billing_interval: 'annual',
      current_period_start: '2026-09-19T21:06:24', current_period_end: '2026-10-19T21:06:24',
      plan_credits: 100, total_credits: 108.695, used: 8.695, remaining: 100,
    }))

    expect(plan.chipLabel).toBe('Core')
    expect(plan.title).toBe('Core Plan · $187.5/mo')
    expect(plan.credits).toEqual({ value: '108,695', caption: 'total credits' })
    expect(plan.cycleStart?.toISOString()).toBe('2026-09-19T21:06:24.000Z')
    expect(plan.cycleLabel).toMatch(/Sep 19 – Oct 19, 2026/)
  })

  it('renders Enterprise as unlimited everywhere except the exact charge', () => {
    const plan = Plan.parse(rawPlan({
      plan_type: 'enterprise', billing_model: 'postpaid', budget_usd: null,
      current_period_start: '2026-10-01T00:00:00', current_period_end: '2026-11-01T00:00:00',
      provider_usage_usd: 1619.44, overage_usd: 1862.36, projected_invoice_usd: 1862.36,
    }))

    expect(plan.isEnterprise).toBe(true)
    expect(plan.isFunded).toBe(true)
    expect(plan.chipLabel).toBe('Enterprise')
    expect(plan.credits).toEqual({ value: 'Unlimited', caption: null })
    expect(plan.budgetLabel).toBe('Unlimited')
    expect(plan.used).toBe(1619440)
    expect(plan.chargesThisCycleLabel).toBe('$1,862.36')
    expect(plan.paymentDueLabel).toBeNull()
  })

  it('shows a budget and an overdue cycle when the backend reports them', () => {
    const plan = Plan.parse(rawPlan({
      plan_type: 'enterprise', billing_model: 'postpaid', budget_usd: 500, overage_usd: 125,
      payment_due_at: '2026-10-26T21:06:24',
    }))

    expect(plan.budgetLabel).toBe('$500.00')
    expect(plan.budgetUsedPct).toBe(25)
    expect(plan.paymentDueLabel).toBe('Oct 26, 2026')
  })

  it('sends null to lift the budget', async () => {
    apiFetchJson.mockResolvedValue(rawPlan({ plan_type: 'enterprise', billing_model: 'postpaid' }))

    await Plan.setBudget('org-1', null)

    expect(apiFetchJson).toHaveBeenCalledWith(expect.stringContaining('/plan/budget'), {
      method: 'PATCH', body: JSON.stringify({ budgetUsd: null }),
    })
  })
})
