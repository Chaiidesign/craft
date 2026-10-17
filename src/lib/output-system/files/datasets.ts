// Store data as tables, for raw data exports (the File kind, D-83). The model
// only picks the dataset, the period and the filters (FileSpec); this code
// builds every row from the sample store, so a file can't contain an invented
// number. Every order is listed whatever its status, with the status in its
// own column; filters narrow the list only when asked.

import { z } from 'zod'

import { lowStock } from '../fixtures/aggregates'
import type { OrderStatus, Store } from '../fixtures/stores'
import { PERIOD_NAMES, resolvePeriod } from '../storeTool'
import type { Table } from './table'

export const DATA_FORMATS = ['xlsx', 'csv', 'json', 'pdf'] as const
export type DataFormat = (typeof DATA_FORMATS)[number]

export const FileSpecSchema = z.object({
  dataset: z.enum(['orders', 'products', 'customers']),
  format: z.enum(DATA_FORMATS),
  period: z.union([z.enum(PERIOD_NAMES), z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })]).optional().describe('Orders only. Omit for all 12 months of sample data.'),
  status: z.array(z.enum(['fulfilled', 'refunded', 'cancelled'])).min(1).optional().describe('Orders only. Omit to include every status.'),
  lowStockOnly: z.boolean().optional().describe('Products only: just those at or below their reorder level.'),
  category: z.string().min(1).optional().describe('Products only: one category, exactly as the store names it.'),
})

export type FileSpec = z.infer<typeof FileSpecSchema>

const money = (minor: number) => Math.round(minor) / 100

export type DatasetResult = { table: Table; title: string; period?: { from: string; to: string } }

const STATUS_LABEL: Record<OrderStatus, string> = { fulfilled: 'Fulfilled', refunded: 'Refunded', cancelled: 'Cancelled' }
const CHANNEL_LABEL: Record<string, string> = { 'online store': 'Online store', marketplace: 'Marketplace', social: 'Social' }

const dmy = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function buildDataset(store: Store, spec: FileSpec): DatasetResult {
  if (spec.dataset === 'orders') {
    const period = spec.period ? resolvePeriod(spec.period) : undefined
    const names = new Map(store.customers.map((c) => [c.id, c]))
    const orders = store.orders.filter((o) => (!period || (o.date >= period.from && o.date <= period.to)) && (!spec.status || spec.status.includes(o.status)))
    const statusPart = spec.status && spec.status.length < 3 ? `${spec.status.map((s) => STATUS_LABEL[s]).join(' and ')} orders` : 'Orders'
    const title = period ? `${statusPart}, ${dmy(period.from)} to ${dmy(period.to)}` : statusPart
    return {
      title,
      ...(period ? { period: { from: period.from, to: period.to } } : {}),
      table: {
        name: statusPart,
        columns: [
          { key: 'orderNumber', label: 'Order number', type: 'text' },
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'customer', label: 'Customer', type: 'text' },
          { key: 'email', label: 'Customer email', type: 'text' },
          { key: 'status', label: 'Status', type: 'text' },
          { key: 'channel', label: 'Channel', type: 'text' },
          { key: 'units', label: 'Units', type: 'integer' },
          { key: 'subtotal', label: 'Subtotal', type: 'money' },
          { key: 'discount', label: 'Discount', type: 'money' },
          { key: 'shipping', label: 'Shipping', type: 'money' },
          { key: 'tax', label: 'Tax', type: 'money' },
          { key: 'total', label: 'Total', type: 'money' },
          { key: 'currency', label: 'Currency', type: 'text' },
        ],
        rows: orders.map((o) => {
          const c = names.get(o.customerId)
          return [
            o.number, o.date, c?.name ?? null, c?.email ?? null, STATUS_LABEL[o.status], CHANNEL_LABEL[o.channel] ?? o.channel,
            o.lines.reduce((t, l) => t + l.quantity, 0),
            money(o.subtotalMinor), money(o.discountMinor), money(o.shippingMinor), money(o.taxMinor), money(o.totalMinor), store.currency,
          ]
        }),
      },
    }
  }
  if (spec.dataset === 'products') {
    let products = spec.lowStockOnly ? lowStock(store) : store.products
    if (spec.category) products = products.filter((p) => p.category.toLowerCase() === spec.category!.toLowerCase())
    const name = spec.lowStockOnly ? 'Low-stock products' : spec.category ? `${spec.category}` : 'Products'
    return {
      title: name,
      table: {
        name,
        columns: [
          { key: 'sku', label: 'SKU', type: 'text' },
          { key: 'title', label: 'Product', type: 'text' },
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'price', label: 'Price', type: 'money' },
          { key: 'currency', label: 'Currency', type: 'text' },
          { key: 'stock', label: 'In stock', type: 'integer' },
          { key: 'reorderLevel', label: 'Reorder level', type: 'integer' },
        ],
        rows: products.map((p) => [p.sku, p.title, p.category, money(p.priceMinor), store.currency, p.stock, p.reorderLevel]),
      },
    }
  }
  const spent = new Map<string, { orders: number; minor: number }>()
  for (const o of store.orders) {
    if (o.status !== 'fulfilled') continue
    const s = spent.get(o.customerId) ?? { orders: 0, minor: 0 }
    s.orders++
    s.minor += o.totalMinor
    spent.set(o.customerId, s)
  }
  return {
    title: 'Customers',
    table: {
      name: 'Customers',
      columns: [
        { key: 'customerId', label: 'Customer ID', type: 'text' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'city', label: 'City', type: 'text' },
        { key: 'country', label: 'Country', type: 'text' },
        { key: 'firstOrder', label: 'First order', type: 'date' },
        { key: 'orders', label: 'Fulfilled orders', type: 'integer' },
        { key: 'spent', label: 'Total spent', type: 'money' },
        { key: 'currency', label: 'Currency', type: 'text' },
      ],
      rows: store.customers.map((c) => {
        const s = spent.get(c.id) ?? { orders: 0, minor: 0 }
        return [c.id, c.name, c.email, c.city, c.country, c.firstOrderOn, s.orders, money(s.minor), store.currency]
      }),
    },
  }
}

/** JSON export: the records as objects keyed by column, plus what they are. */
export function writeJson(store: Store, result: DatasetResult): string {
  const records = result.table.rows.map((r) => Object.fromEntries(result.table.columns.map((c, i) => [c.key, r[i]])))
  return `${JSON.stringify({ store: store.name, title: result.title, sampleData: true, ...(result.period ? { period: result.period } : {}), count: records.length, records }, null, 2)}\n`
}
