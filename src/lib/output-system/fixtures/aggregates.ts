// Numbers derived from the sample orders. Replies, documents and files quote
// these, and the automatic checks recompute them from the same orders, so a
// quoted number either matches the fixtures exactly or fails (build-loop.md §8).
//
// Counted orders: fulfilled only. Refunded and cancelled orders are listed in
// exports but never counted as sales (D-77, assumed).

import type { Order, Store } from './stores'

export const countsAsSale = (o: Order) => o.status === 'fulfilled'

export type Period = { from: string; to: string }

export const inPeriod = (o: Order, p: Period) => o.date >= p.from && o.date <= p.to

export type SalesSummary = {
  orders: number
  units: number
  /** Integer minor units: sum of order totals (after discount, with shipping and tax). */
  revenueMinor: number
  /** Integer minor units: sum of subtotals less discounts (goods only). */
  netSalesMinor: number
  /** Integer minor units, rounded down: revenue ÷ orders. 0 when there are no orders. */
  averageOrderMinor: number
}

export function salesSummary(store: Store, period?: Period): SalesSummary {
  const orders = store.orders.filter((o) => countsAsSale(o) && (!period || inPeriod(o, period)))
  const revenueMinor = orders.reduce((t, o) => t + o.totalMinor, 0)
  return {
    orders: orders.length,
    units: orders.reduce((t, o) => t + o.lines.reduce((u, l) => u + l.quantity, 0), 0),
    revenueMinor,
    netSalesMinor: orders.reduce((t, o) => t + o.subtotalMinor - o.discountMinor, 0),
    averageOrderMinor: orders.length ? Math.floor(revenueMinor / orders.length) : 0,
  }
}

/** "YYYY-MM" for each of the 12 months, oldest first, with that month's summary. */
export function salesByMonth(store: Store): { month: string; summary: SalesSummary }[] {
  const months = [...new Set(store.orders.map((o) => o.date.slice(0, 7)))].sort()
  return months.map((month) => ({ month, summary: salesSummary(store, { from: `${month}-01`, to: `${month}-31` }) }))
}

export function topProducts(store: Store, limit: number, period?: Period): { productId: string; title: string; units: number; netSalesMinor: number }[] {
  const byProduct = new Map<string, { productId: string; title: string; units: number; netSalesMinor: number }>()
  for (const o of store.orders) {
    if (!countsAsSale(o) || (period && !inPeriod(o, period))) continue
    for (const l of o.lines) {
      const row = byProduct.get(l.productId) ?? { productId: l.productId, title: l.title, units: 0, netSalesMinor: 0 }
      row.units += l.quantity
      row.netSalesMinor += l.lineTotalMinor
      byProduct.set(l.productId, row)
    }
  }
  return [...byProduct.values()].sort((a, b) => b.units - a.units || b.netSalesMinor - a.netSalesMinor || a.productId.localeCompare(b.productId)).slice(0, limit)
}

export function lowStock(store: Store) {
  return store.products.filter((p) => p.stock <= p.reorderLevel).sort((a, b) => a.stock - b.stock || a.id.localeCompare(b.id))
}
