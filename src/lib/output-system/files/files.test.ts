import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { nodeResources } from '../../documents/testing/nodeResources'
import { sampleStore } from '../fixtures/stores'
import { buildFile } from './build'
import { parseCsv, writeCsv } from './csv'
import { buildDataset } from './datasets'
import { applyChanges, readUpload, roundToEnding, writeUpload } from './upload'
import { readXlsx, writeXlsx } from './xlsx'

const UPLOADS = fileURLToPath(new URL('../../../../docs/output-system/evals/uploads/', import.meta.url))
const fernhill = sampleStore('fernhill-goods')
const saffron = sampleStore('saffron-loom')

describe('CSV', () => {
  it('quotes only when needed and parses back to the same cells', () => {
    const table = { name: 't', columns: [{ key: 'a', label: 'Name', type: 'text' as const }, { key: 'b', label: 'Total', type: 'money' as const }], rows: [['Bloom, & "Co"', 12.5], ['Plain', 3]] }
    const text = writeCsv(table)
    expect(text).toBe('Name,Total\r\n"Bloom, & ""Co""",12.50\r\nPlain,3.00\r\n')
    expect(parseCsv(text)).toEqual([['Name', 'Total'], ['Bloom, & "Co"', '12.50'], ['Plain', '3.00']])
  })
})

describe('Excel', () => {
  it('round-trips text, money, integers and dates, with the sheet name', () => {
    const { table } = buildDataset(fernhill, { dataset: 'orders', format: 'xlsx', period: 'last_month' })
    const back = readXlsx(writeXlsx(table))
    expect(back.sheetName).toBe('Orders')
    expect(back.rows[0]).toEqual(table.columns.map((c) => c.label))
    expect(back.rows.slice(1)).toEqual(table.rows)
    expect(back.types[1]).toBe('date')
  })

  it('gives the same bytes for the same table', () => {
    const { table } = buildDataset(saffron, { dataset: 'products', format: 'xlsx' })
    expect(writeXlsx(table)).toEqual(writeXlsx(table))
  })
})

describe('datasets', () => {
  it('lists every order in the period, any status, unless a status is asked for', () => {
    const all = buildDataset(fernhill, { dataset: 'orders', format: 'csv', period: 'last_month' })
    const sept = fernhill.orders.filter((o) => o.date >= '2026-09-01' && o.date <= '2026-09-30')
    expect(all.table.rows).toHaveLength(sept.length)
    const refunded = buildDataset(fernhill, { dataset: 'orders', format: 'csv', period: 'this_year', status: ['refunded'] })
    expect(refunded.table.rows.every((r) => r[4] === 'Refunded')).toBe(true)
    expect(refunded.title).toMatch(/^Refunded orders, 1 Jan 2026 to 30 Sept? 2026$/)
  })

  it('keeps currency in its own column and money as numbers', () => {
    const { table } = buildDataset(saffron, { dataset: 'products', format: 'csv' })
    const price = table.columns.findIndex((c) => c.key === 'price')
    const currency = table.columns.findIndex((c) => c.key === 'currency')
    expect(table.rows.every((r) => typeof r[price] === 'number' && r[currency] === 'INR')).toBe(true)
  })
})

describe('uploaded files', () => {
  it('rounds to the nearest price ending', () => {
    expect(roundToEnding(61.32, 0.99)).toBe(60.99)
    expect(roundToEnding(61.6, 0.99)).toBe(61.99)
    expect(roundToEnding(10.24, 0.99)).toBe(9.99)
  })

  it('raises the Excel price list 5% to .99 and keeps its structure', () => {
    const up = readUpload('fernhill-wholesale-prices.xlsx', new Uint8Array(readFileSync(`${UPLOADS}fernhill-wholesale-prices.xlsx`)))
    const { upload, summary } = applyChanges(up, [{ change: 'adjust_numbers', column: 'Wholesale price (USD)', percent: 5, rounding: { mode: 'ending', ending: 0.99 } }])
    const back = readXlsx(writeUpload(upload))
    expect(back.sheetName).toBe(up.sheetName)
    expect(back.rows[0]).toEqual(up.header)
    expect(back.rows).toHaveLength(up.rows.length + 1)
    expect(back.rows[1][2]).toBe(roundToEnding(58.4 * 1.05, 0.99))
    expect(back.rows.slice(1).every((r) => String(r[2]).endsWith('.99'))).toBe(true)
    expect(back.rows.slice(1).map((r) => r[0])).toEqual(up.rows.map((r) => r[0]))
    expect(summary[0]).toBe('Raised 8 values in “Wholesale price (USD)” by 5%.')
  })

  it('removes duplicate emails ignoring case and fixes name capitalisation in the CSV', () => {
    const up = readUpload('saffron-customers.csv', new Uint8Array(readFileSync(`${UPLOADS}saffron-customers.csv`)))
    const { upload } = applyChanges(up, [
      { change: 'remove_duplicates', column: 'Email', ignoreCase: true },
      { change: 'change_case', column: 'Name', case: 'title' },
    ])
    const back = parseCsv(new TextDecoder().decode(writeUpload(upload)))
    expect(back[0]).toEqual(['Name', 'Email', 'City'])
    expect(back).toHaveLength(7)
    expect(back.slice(1).map((r) => r[0])).toEqual(['Ananya Iyer', 'Rohan Kapoor', 'Meera Nair', 'Dev Joshi', 'Tara Das', 'Kabir Reddy'])
  })

  it('refuses a column that is not there', () => {
    const up = readUpload('saffron-customers.csv', new Uint8Array(readFileSync(`${UPLOADS}saffron-customers.csv`)))
    expect(() => applyChanges(up, [{ change: 'change_case', column: 'Surname', case: 'title' }])).toThrow('There is no column called “Surname”')
  })
})

describe('PDF through the document engine', () => {
  it('renders a three-month orders table across pages', async () => {
    const file = await buildFile(saffron, { dataset: 'orders', format: 'pdf', period: 'last_quarter' }, { resources: nodeResources })
    expect(file.fileName).toMatch(/^Saffron Loom Textiles Orders, 1 Jul 2026 to 30 Sept? 2026\.pdf$/)
    expect(new TextDecoder().decode(file.bytes.slice(0, 5))).toBe('%PDF-')
    expect(file.rows).toBe(saffron.orders.filter((o) => o.date >= '2026-07-01' && o.date <= '2026-09-30').length)
  }, 30_000)
})
