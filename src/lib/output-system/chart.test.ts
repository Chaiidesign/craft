import { describe, expect, it } from 'vitest'

import { buildChart, chartCsv } from './chart'
import { salesSummary, topProducts } from './fixtures/aggregates'
import { sampleStore } from './fixtures/stores'

const fernhill = sampleStore('fernhill-goods')

describe('inline charts', () => {
  it('computes weekly points from the store, oldest first', () => {
    const c = buildChart(fernhill, { data: 'sales_by_week', measure: 'revenue', chartType: 'bar', title: 'Weekly sales, last 8 weeks', lead: 'x', weeks: 8 })
    expect(c.points).toHaveLength(8)
    expect(c.points.at(-1)!.value).toBe(salesSummary(fernhill, { from: '2026-09-21', to: '2026-09-27' }).revenueMinor / 100)
    expect(c.orientation).toBe('vertical')
    expect(c.source).toContain('Sample data')
  })

  it('draws top products as horizontal bars with the store’s ranking', () => {
    const c = buildChart(fernhill, { data: 'top_products', measure: 'units', chartType: 'line', title: 'Top products', lead: 'x', limit: 5, period: 'this_year' })
    expect(c.chartType).toBe('bar')
    expect(c.orientation).toBe('horizontal')
    expect(c.points.map((p) => p.value)).toEqual(topProducts(fernhill, 5, { from: '2026-01-01', to: '2026-09-30' }).map((p) => p.units))
  })

  it('caps a line at 24 points and writes the numbers as CSV', () => {
    const c = buildChart(fernhill, { data: 'sales_by_month', measure: 'orders', chartType: 'line', title: 'Monthly orders', lead: 'x' })
    expect(c.points.length).toBeLessThanOrEqual(24)
    expect(chartCsv(c).split('\r\n')[0]).toBe('Period,Orders')
  })
})
