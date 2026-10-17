// Inline charts (Session 1, D-86). The model picks what to chart: which store
// question, which measure, bar or line, a title and one lead sentence. Code
// computes every point from the sample store, so a chart can't show an
// invented number, and the lead sentence goes through the number check.

import { z } from 'zod'

import { formatMoney } from '../documents/money'
import type { Store } from './fixtures/stores'
import { askStore, PERIOD_NAMES } from './storeTool'

export const ChartSpecSchema = z.object({
  data: z.enum(['sales_by_week', 'sales_by_month', 'top_products']).describe('Which store numbers to chart.'),
  measure: z.enum(['revenue', 'orders', 'units']).describe('revenue for sales_by_*; units or revenue for top_products; orders for sales_by_*.'),
  chartType: z.enum(['bar', 'line']).describe('bar to compare a few periods or products; line for a trend over many periods.'),
  title: z.string().min(3).max(80).describe('Says what the chart shows, in words, with its period: "Weekly sales, last 8 weeks".'),
  lead: z.string().min(3).max(300).describe('One or two sentences that answer the question. Quote numbers exactly as the chart shows them.'),
  weeks: z.number().int().min(2).max(26).optional().describe('sales_by_week only (default 8).'),
  period: z.union([z.enum(PERIOD_NAMES), z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })]).optional().describe('sales_by_month and top_products (default last_12_months).'),
  limit: z.number().int().min(3).max(12).optional().describe('top_products only (default 5).'),
})

export type ChartSpec = z.infer<typeof ChartSpecSchema>

/** display: the full value ("$3,033.79"); short: for narrow bars ("$3.03K", "₹1.13L"). */
export type ChartPoint = { label: string; value: number; display: string; short: string }

export type Chart = {
  title: string
  chartType: 'bar' | 'line'
  /** Horizontal bars for ranked lists with long names; vertical otherwise. */
  orientation: 'horizontal' | 'vertical'
  measure: ChartSpec['measure']
  unitLabel: string
  points: ChartPoint[]
  source: string
  /** The store answer the points came from, for the number check. */
  answer: Record<string, unknown>
}

/** At most 12 bars or 24 points (inline-chart guide). */
export const MAX_POINTS = { bar: 12, line: 24 }

const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })

export function buildChart(store: Store, spec: ChartSpec, today?: string): Chart {
  const money = (amount: number) => formatMoney({ amountMinor: Math.round(amount * 100), currency: store.currency }, store.locale).replace(/\.00$/, '')
  const count = (n: number) => n.toLocaleString(store.locale)
  const unitLabel = spec.measure === 'revenue' ? store.currency : spec.measure
  const shortMoney = (amount: number) => new Intl.NumberFormat(store.locale, { style: 'currency', currency: store.currency, notation: 'compact', maximumSignificantDigits: 3 }).format(amount)
  const withShort = (p: Omit<ChartPoint, 'short'>): ChartPoint => ({ ...p, short: spec.measure === 'revenue' ? shortMoney(p.value) : p.display })
  let points: Omit<ChartPoint, 'short'>[]
  let answer: Record<string, unknown>
  let range: string
  if (spec.data === 'sales_by_week') {
    answer = askStore(store, { question: 'sales_by_week', weeks: spec.weeks ?? 8 }, today)
    const weeks = answer.weeks as { weekStarting: string; weekEnding: string; orders: number; revenue: { amount: number } }[]
    points = weeks.map((w) => {
      const v = spec.measure === 'orders' ? w.orders : w.revenue.amount
      return { label: short(w.weekStarting), value: v, display: spec.measure === 'orders' ? count(v) : money(v) }
    })
    range = `weeks starting ${short(weeks[0].weekStarting)} to ${short(weeks.at(-1)!.weekStarting)}`
  } else if (spec.data === 'sales_by_month') {
    answer = askStore(store, { question: 'sales_by_month', period: spec.period ?? 'last_12_months' }, today)
    const months = answer.months as { month: string; orders: number; revenue: { amount: number } }[]
    points = months.map((m) => {
      const v = spec.measure === 'orders' ? m.orders : m.revenue.amount
      return { label: monthName(m.month), value: v, display: spec.measure === 'orders' ? count(v) : money(v) }
    })
    const p = answer.period as { from: string; to: string }
    range = `${short(p.from)} to ${short(p.to)}`
  } else {
    const rankBy = spec.measure === 'revenue' ? 'sales' : 'units'
    answer = askStore(store, { question: 'top_products', period: spec.period ?? 'last_12_months', limit: spec.limit ?? 5, rankBy }, today)
    const products = answer.products as { title: string; unitsSold: number; sales: { amount: number } }[]
    points = products.map((p) => {
      const v = spec.measure === 'revenue' ? p.sales.amount : p.unitsSold
      return { label: p.title, value: v, display: spec.measure === 'revenue' ? money(v) : count(v) }
    })
    const p = answer.period as { from: string; to: string }
    range = `${short(p.from)} to ${short(p.to)}`
  }
  const chartType = spec.data === 'top_products' ? 'bar' : spec.chartType
  return {
    title: spec.title,
    chartType,
    orientation: spec.data === 'top_products' ? 'horizontal' : 'vertical',
    measure: spec.measure,
    unitLabel,
    points: points.slice(-MAX_POINTS[chartType]).map(withShort),
    source: `Source: ${store.name} fulfilled orders, ${range}. Sample data.`,
    answer,
  }
}

/** The chart's numbers as CSV: one row per point, the value as a plain number. */
export function chartCsv(chart: Chart): string {
  const head = `${chart.orientation === 'horizontal' ? 'Product' : 'Period'},${chart.measure === 'revenue' ? `Revenue (${chart.unitLabel})` : chart.measure === 'orders' ? 'Orders' : 'Units sold'}`
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return `${[head, ...chart.points.map((p) => `${q(p.label)},${chart.measure === 'revenue' ? p.value.toFixed(2) : p.value}`)].join('\r\n')}\r\n`
}
