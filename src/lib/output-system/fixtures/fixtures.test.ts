import { describe, expect, it } from 'vitest'

import { lowStock, salesByMonth, salesSummary, topProducts } from './aggregates'
import { ANCHOR_DATE, sampleStores, seeded } from './stores'
import { REGISTRY } from '../registry'
import { LANES } from '../lanes'

const stores = Object.values(sampleStores())

describe('sample stores', () => {
  it('has two stores, one INR and one USD', () => {
    expect(stores.map((s) => s.currency).sort()).toEqual(['INR', 'USD'])
  })

  it.each(stores)('$name has 60 products, 200 customers and 500 orders over 12 months', (s) => {
    expect(s.products).toHaveLength(60)
    expect(s.customers).toHaveLength(200)
    expect(s.orders).toHaveLength(500)
    const dates = s.orders.map((o) => o.date).sort()
    expect(dates.at(-1)! <= ANCHOR_DATE).toBe(true)
    expect(dates[0] >= '2025-10-01').toBe(true)
    expect(new Set(dates.map((d) => d.slice(0, 7))).size).toBe(12)
    expect(new Set(s.products.map((p) => p.sku)).size).toBe(60)
    expect(new Set(s.orders.map((o) => o.number)).size).toBe(500)
  })

  it.each(stores)('$name keeps money in integer minor units, and every order adds up', (s) => {
    for (const p of s.products) expect(Number.isInteger(p.priceMinor) && p.priceMinor > 0).toBe(true)
    for (const o of s.orders) {
      for (const l of o.lines) expect(l.lineTotalMinor).toBe(l.unitPriceMinor * l.quantity)
      expect(o.subtotalMinor).toBe(o.lines.reduce((t, l) => t + l.lineTotalMinor, 0))
      expect(o.totalMinor).toBe(o.subtotalMinor - o.discountMinor + o.shippingMinor + o.taxMinor)
      for (const v of [o.subtotalMinor, o.discountMinor, o.shippingMinor, o.taxMinor, o.totalMinor]) expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('is the same every time: fixed seed and anchor date', () => {
    const a = seeded(42)
    const b = seeded(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    // A fingerprint of the generated data; changes only when the generator changes.
    const fingerprint = stores.map((s) => `${s.id}:${salesSummary(s).revenueMinor}:${s.orders[0].number}:${s.orders[499].date}`)
    expect(fingerprint).toMatchSnapshot()
  })

  it.each(stores)('$name totals by month add up to the year', (s) => {
    const year = salesSummary(s)
    const months = salesByMonth(s)
    expect(months).toHaveLength(12)
    expect(months.reduce((t, m) => t + m.summary.revenueMinor, 0)).toBe(year.revenueMinor)
    expect(months.reduce((t, m) => t + m.summary.orders, 0)).toBe(year.orders)
    expect(topProducts(s, 5)).toHaveLength(5)
    for (const p of lowStock(s)) expect(p.stock <= p.reorderLevel).toBe(true)
  })

  it('uses only reserved example.com addresses', () => {
    for (const s of stores) for (const c of s.customers) expect(c.email.endsWith('@example.com')).toBe(true)
  })
})

describe('lane registry', () => {
  it('has one entry per lane, in the router order of LANES', () => {
    expect(REGISTRY.map((e) => e.lane)).toEqual([...LANES])
  })

  it('builds the four launch lanes and shows the rest as coming later', () => {
    const launch = REGISTRY.filter((e) => e.scope === 'launch').map((e) => e.lane).sort()
    expect(launch).toEqual(['chat_reply', 'composed_document', 'file', 'strict_document'])
    for (const e of REGISTRY.filter((e) => e.scope === 'later')) expect(e.status).toBe('coming-later')
    for (const e of REGISTRY) expect(e.action).toBeTruthy()
  })
})
