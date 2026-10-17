// The read-only store questions the model may ask (D-80). A fixed set, no
// free-form queries: every number comes from code over the sample orders, with
// comparisons and percentage changes already computed, so the model quotes
// numbers and never calculates them. Periods are named ("last_month") and
// resolved here against the sample data's anchor date, which is "today" in
// sample mode (D-81), so the model does no date arithmetic either.

import { z } from 'zod'

import { formatMoney } from '../documents/money'
import { countsAsSale, lowStock, salesSummary, topProducts, type Period, type SalesSummary } from './fixtures/aggregates'
import { ANCHOR_DATE, type Store } from './fixtures/stores'

export const PERIOD_NAMES = ['last_week', 'last_month', 'last_3_months', 'last_quarter', 'this_year', 'last_12_months'] as const

const PeriodSchema = z.union([
  z.enum(PERIOD_NAMES),
  z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
])

export const StoreQuerySchema = z.discriminatedUnion('question', [
  z.object({ question: z.literal('sales_summary'), period: PeriodSchema }),
  z.object({ question: z.literal('sales_by_month'), period: PeriodSchema.optional() }),
  z.object({ question: z.literal('sales_by_week'), weeks: z.number().int().min(1).max(26) }),
  z.object({ question: z.literal('top_products'), period: PeriodSchema, limit: z.number().int().min(1).max(20), rankBy: z.enum(['units', 'sales']).optional() }),
  z.object({ question: z.literal('low_stock') }),
  z.object({ question: z.literal('orders_by_status'), period: PeriodSchema }),
  z.object({ question: z.literal('find_order'), orderNumber: z.string().min(1).max(40) }),
  z.object({ question: z.literal('customer_orders'), customer: z.string().min(1).max(80), limit: z.number().int().min(1).max(20).optional() }),
  z.object({ question: z.literal('find_products'), search: z.string().max(80).optional(), category: z.string().max(40).optional(), limit: z.number().int().min(1).max(60).optional() }),
])

export type StoreQuery = z.infer<typeof StoreQuerySchema>

/**
 * What the model fills in: one flat object, because the API refuses a tool
 * schema whose top level is a union (oneOf/anyOf). The loop then checks it
 * strictly against StoreQuerySchema, per question.
 */
export const StoreToolInputSchema = z.object({
  question: z.enum(['sales_summary', 'sales_by_month', 'sales_by_week', 'top_products', 'low_stock', 'orders_by_status', 'find_order', 'customer_orders', 'find_products']),
  period: PeriodSchema.optional().describe('Needed for sales_summary, top_products and orders_by_status; optional for sales_by_month.'),
  weeks: z.number().int().min(1).max(26).optional().describe('sales_by_week only.'),
  limit: z.number().int().min(1).max(20).optional().describe('top_products only.'),
  rankBy: z.enum(['units', 'sales']).optional().describe('top_products only; default units.'),
  orderNumber: z.string().min(1).max(40).optional().describe('find_order only: the order number, e.g. FH-01042.'),
  customer: z.string().min(1).max(80).optional().describe('customer_orders only: the customer’s name, or part of it.'),
  search: z.string().max(80).optional().describe('find_products only: words in the product title or its SKU.'),
  category: z.string().max(40).optional().describe('find_products only.'),
})

/** JSON Schema for the tool's input (D-66: offered, not forced). */
export const STORE_TOOL = {
  name: 'ask_store',
  description:
    'Ask the connected store one question and get exact figures back. Periods: last_week (the last full Monday–Sunday week), last_month, last_3_months, last_quarter, this_year (1 January to today), last_12_months, or { from, to } as YYYY-MM-DD. Only fulfilled orders count as sales. find_order gives one order in full; customer_orders lists a customer’s most recent orders; find_products searches the catalogue (titles, SKUs, prices, stock) and lists every product when given no search.',
  input_schema: z.toJSONSchema(StoreToolInputSchema) as Record<string, unknown>,
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (s: string) => new Date(`${s}T00:00:00Z`)
const addDays = (s: string, n: number) => {
  const d = day(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const monthStart = (s: string, back = 0) => {
  const d = day(s)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)))
}
const monthEnd = (s: string) => {
  const d = day(s)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}

/** Resolves a period against "today" (the anchor date in sample mode). */
export function resolvePeriod(p: z.infer<typeof PeriodSchema>, today = ANCHOR_DATE): Period & { label: string } {
  if (typeof p === 'object') return { ...p, label: `${p.from} to ${p.to}` }
  const isEndOfMonth = monthEnd(today) === today
  // A month or quarter "last" means the last complete one; today counts as complete only on its last day.
  const lastFullMonthEnd = isEndOfMonth ? today : addDays(monthStart(today), -1)
  switch (p) {
    case 'last_week': {
      const dow = (day(today).getUTCDay() + 6) % 7 // Monday = 0
      const lastSunday = addDays(today, -dow - 1)
      return { from: addDays(lastSunday, -6), to: lastSunday, label: 'last week' }
    }
    case 'last_month':
      return { from: monthStart(lastFullMonthEnd), to: lastFullMonthEnd, label: 'last month' }
    case 'last_3_months':
      return { from: monthStart(lastFullMonthEnd, 2), to: lastFullMonthEnd, label: 'the last three months' }
    case 'last_quarter': {
      const d = day(lastFullMonthEnd)
      const qEndMonth = Math.floor((d.getUTCMonth() + 1) / 3) * 3 // 0 when before the first quarter ends
      const end = qEndMonth === 0 ? iso(new Date(Date.UTC(d.getUTCFullYear() - 1, 12, 0))) : iso(new Date(Date.UTC(d.getUTCFullYear(), qEndMonth, 0)))
      return { from: monthStart(end, 2), to: end, label: 'last quarter' }
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'this year so far' }
    case 'last_12_months':
      return { from: addDays(today, -364), to: today, label: 'the last 12 months' }
  }
}

/** The period to compare with: the previous calendar month or quarter for those, else the same length of time just before. */
export function previousPeriod(p: Period): Period {
  const whole = (from: string, to: string) => from.slice(8) === '01' && monthEnd(to) === to
  const months = (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1
  if (whole(p.from, p.to) && months <= 3) {
    const to = addDays(p.from, -1)
    return { from: monthStart(to, months - 1), to }
  }
  const days = Math.round((day(p.to).getTime() - day(p.from).getTime()) / 86_400_000) + 1
  return { from: addDays(p.from, -days), to: addDays(p.from, -1) }
}

const pct = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10)

function money(store: Store, minor: number) {
  return { amount: minor / 100, display: formatMoney({ amountMinor: minor, currency: store.currency }, store.locale) }
}

function summary(store: Store, s: SalesSummary) {
  return {
    orders: s.orders,
    unitsSold: s.units,
    revenue: money(store, s.revenueMinor),
    netSales: money(store, s.netSalesMinor),
    averageOrderValue: money(store, s.averageOrderMinor),
  }
}

const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function orderDetail(store: Store, o: Store['orders'][number]) {
  const customer = store.customers.find((c) => c.id === o.customerId)
  return {
    orderNumber: o.number,
    date: o.date,
    status: o.status,
    customer: customer ? { name: customer.name, city: customer.city, country: customer.country } : null,
    lines: o.lines.map((l) => ({ sku: l.sku, title: l.title, quantity: l.quantity, unitPrice: money(store, l.unitPriceMinor), lineTotal: money(store, l.lineTotalMinor) })),
    subtotal: money(store, o.subtotalMinor),
    discount: money(store, o.discountMinor),
    shipping: money(store, o.shippingMinor),
    tax: money(store, o.taxMinor),
    taxRatePercent: o.taxRateBp / 100,
    total: money(store, o.totalMinor),
  }
}

/** Answers one store question. The result is plain JSON the model reads. */
export function askStore(store: Store, query: StoreQuery, today = ANCHOR_DATE): Record<string, unknown> {
  const base = { store: store.name, currency: store.currency, today, sampleData: true }
  switch (query.question) {
    case 'sales_summary': {
      const p = resolvePeriod(query.period, today)
      const prev = previousPeriod(p)
      const now = salesSummary(store, p)
      const before = salesSummary(store, prev)
      return {
        ...base,
        period: p,
        current: summary(store, now),
        previousPeriod: { ...prev, ...summary(store, before) },
        changePercent: { revenue: pct(now.revenueMinor, before.revenueMinor), orders: pct(now.orders, before.orders), averageOrderValue: pct(now.averageOrderMinor, before.averageOrderMinor) },
      }
    }
    case 'sales_by_month': {
      const p = query.period ? resolvePeriod(query.period, today) : resolvePeriod('last_12_months', today)
      const months: { month: string; orders: number; revenue: ReturnType<typeof money> }[] = []
      for (let m = monthStart(p.from); m <= p.to; m = monthStart(addDays(monthEnd(m), 1))) {
        const s = salesSummary(store, { from: m < p.from ? p.from : m, to: monthEnd(m) > p.to ? p.to : monthEnd(m) })
        months.push({ month: m.slice(0, 7), orders: s.orders, revenue: money(store, s.revenueMinor) })
      }
      return { ...base, period: p, months }
    }
    case 'sales_by_week': {
      const last = resolvePeriod('last_week', today)
      const weeks = []
      for (let i = query.weeks - 1; i >= 0; i--) {
        const w = { from: addDays(last.from, -7 * i), to: addDays(last.to, -7 * i) }
        const s = salesSummary(store, w)
        weeks.push({ weekStarting: w.from, weekEnding: w.to, orders: s.orders, revenue: money(store, s.revenueMinor) })
      }
      return { ...base, weeks }
    }
    case 'top_products': {
      const p = resolvePeriod(query.period, today)
      const rows = topProducts(store, 1000, p)
      if (query.rankBy === 'sales') rows.sort((a, b) => b.netSalesMinor - a.netSalesMinor || b.units - a.units)
      return {
        ...base,
        period: p,
        rankedBy: query.rankBy ?? 'units',
        products: rows.slice(0, query.limit).map((r, i) => ({ rank: i + 1, title: r.title, unitsSold: r.units, sales: money(store, r.netSalesMinor) })),
      }
    }
    case 'low_stock':
      return {
        ...base,
        products: lowStock(store).map((p) => ({ title: p.title, sku: p.sku, inStock: p.stock, reorderLevel: p.reorderLevel })),
      }
    case 'orders_by_status': {
      const p = resolvePeriod(query.period, today)
      const orders = store.orders.filter((o) => o.date >= p.from && o.date <= p.to)
      const count = (status: string) => orders.filter((o) => o.status === status).length
      return { ...base, period: p, totalOrders: orders.length, fulfilled: orders.filter(countsAsSale).length, refunded: count('refunded'), cancelled: count('cancelled') }
    }
    case 'find_order': {
      // "FH-01042", "fh01042" or just "1042" (digits alone match the number part).
      const key = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '')
      const digitsOnly = /^\d+$/.test(key(query.orderNumber))
      const order = store.orders.find((o) => key(o.number) === key(query.orderNumber) || (digitsOnly && Number(o.number.replace(/\D/g, '')) === Number(key(query.orderNumber))))
      if (!order) return { ...base, found: false, orderNumber: query.orderNumber, note: `There is no order ${query.orderNumber}. Order numbers look like ${store.orders[0].number} to ${store.orders[store.orders.length - 1].number}.` }
      return { ...base, found: true, order: orderDetail(store, order) }
    }
    case 'customer_orders': {
      const wanted = plain(query.customer)
      const matches = store.customers.filter((c) => plain(c.name).includes(wanted))
      const ids = new Set(matches.map((c) => c.id))
      const orders = store.orders.filter((o) => ids.has(o.customerId)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
      return {
        ...base,
        customersMatched: matches.map((c) => c.name),
        orders: orders.slice(0, query.limit ?? 5).map((o) => ({ orderNumber: o.number, date: o.date, status: o.status, customer: store.customers.find((c) => c.id === o.customerId)?.name, total: money(store, o.totalMinor) })),
      }
    }
    case 'find_products': {
      const words = query.search ? plain(query.search).split(' ').filter(Boolean) : []
      const rows = store.products.filter((p) => (!query.category || plain(p.category) === plain(query.category)) && words.every((w) => plain(`${p.title} ${p.sku}`).includes(w)))
      const limit = query.limit ?? 20
      return {
        ...base,
        matched: rows.length,
        products: rows.slice(0, limit).map((p) => ({ sku: p.sku, title: p.title, category: p.category, price: money(store, p.priceMinor), inStock: p.stock })),
        ...(rows.length > limit ? { note: `Showing ${limit} of ${rows.length}. Narrow the search or raise the limit (up to 60).` } : {}),
      }
    }
  }
}
