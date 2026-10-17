import { describe, expect, it } from 'vitest'

import { salesSummary } from './fixtures/aggregates'
import { sampleStore } from './fixtures/stores'
import { checkNumbers, extractClaims } from './numbers'
import { askStore, resolvePeriod, StoreQuerySchema } from './storeTool'

describe('periods resolve against the sample anchor date (30 Sep 2026, a Wednesday)', () => {
  it.each([
    ['last_week', '2026-09-21', '2026-09-27'],
    ['last_month', '2026-09-01', '2026-09-30'],
    ['last_3_months', '2026-07-01', '2026-09-30'],
    ['last_quarter', '2026-07-01', '2026-09-30'],
    ['this_year', '2026-01-01', '2026-09-30'],
    ['last_12_months', '2025-10-01', '2026-09-30'],
  ] as const)('%s', (name, from, to) => {
    expect(resolvePeriod(name)).toMatchObject({ from, to })
  })

  it('treats a month as complete only on its last day', () => {
    expect(resolvePeriod('last_month', '2026-09-15')).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolvePeriod('last_quarter', '2026-09-15')).toMatchObject({ from: '2026-04-01', to: '2026-06-30' })
  })
})

describe('comparison periods', () => {
  it('compares whole months and quarters with the previous calendar month or quarter', async () => {
    const { previousPeriod } = await import('./storeTool')
    expect(previousPeriod({ from: '2026-09-01', to: '2026-09-30' })).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(previousPeriod({ from: '2026-07-01', to: '2026-09-30' })).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(previousPeriod({ from: '2026-09-21', to: '2026-09-27' })).toEqual({ from: '2026-09-14', to: '2026-09-20' })
  })
})

describe('store answers', () => {
  const store = sampleStore('fernhill-goods')

  it('quotes the same figures as the aggregates, with comparisons computed', () => {
    const r = askStore(store, { question: 'sales_summary', period: 'last_month' }) as { current: { orders: number; revenue: { amount: number } }; changePercent: { revenue: number | null } }
    const s = salesSummary(store, { from: '2026-09-01', to: '2026-09-30' })
    expect(r.current.orders).toBe(s.orders)
    expect(r.current.revenue.amount).toBe(s.revenueMinor / 100)
    expect(typeof r.changePercent.revenue).toBe('number')
  })

  it('rejects free-form questions', () => {
    expect(StoreQuerySchema.safeParse({ question: 'run_sql', sql: 'select *' }).success).toBe(false)
  })

  it('counts orders by status over a period', () => {
    const r = askStore(store, { question: 'orders_by_status', period: 'last_quarter' }) as Record<string, number>
    expect(r.fulfilled + r.refunded + r.cancelled).toBe(r.totalOrders)
  })
})

describe('number check', () => {
  const answer = { revenue: { amount: 3993259.35, display: '₹39,93,259.35' }, orders: 431, changePercent: -12.4 }

  it('accepts the same value written different ways and at stated precision', () => {
    for (const reply of ['Revenue was ₹39,93,259.35.', 'Revenue was ₹3,993,259.35.', 'About ₹39.9 lakh in sales.', 'Sales fell 12.4%.', 'down 12%', 'from 431 orders']) {
      expect(checkNumbers(reply, [answer]).ok, reply).toBe(true)
    }
  })

  it('fails a number no source has', () => {
    const r = checkNumbers('Revenue was ₹41,00,000 from 450 orders, up 8%.', [answer])
    expect(r.unmatched.map((c) => c.text)).toEqual(['₹41,00,000', '8%', '450 orders'])
  })

  it('ignores plain numbers that are not store claims', () => {
    expect(extractClaims('A 30-day window, under 60 characters, 2 options.')).toEqual([])
  })

  it('reads US dollars and thousands', () => {
    expect(checkNumbers('Roughly $76k this year.', [{ v: 76144.13 }]).ok).toBe(true)
    expect(checkNumbers('Roughly $80k this year.', [{ v: 76144.13 }]).ok).toBe(false)
  })
})
