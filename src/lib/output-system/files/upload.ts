// Changes to a file the person uploaded (router step 2, D-84). The model sees
// only the header, a few sample rows and the row count (`describeUpload`), and
// picks changes from this fixed list; code applies them to every row. The
// result keeps the upload's columns, their order, its sheet name and its
// format, so "keeps its structure" holds by construction.

import { z } from 'zod'

import { parseCsv, writeCsv } from './csv'
import type { Cell, ColumnType, Table } from './table'
import { readXlsx, writeXlsx } from './xlsx'

export type Upload = { fileName: string; format: 'csv' | 'xlsx'; sheetName: string; header: string[]; rows: Cell[][]; types: ColumnType[] }

export class UploadError extends Error {}

export function readUpload(fileName: string, bytes: Uint8Array): Upload {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) {
    const [header = [], ...rows] = parseCsv(new TextDecoder().decode(bytes))
    if (header.length === 0) throw new UploadError('This CSV file is empty.')
    return { fileName, format: 'csv', sheetName: fileName.replace(/\.csv$/i, ''), header, rows: rows.map((r) => header.map((_, i) => r[i] ?? '')), types: header.map(() => 'text') }
  }
  if (lower.endsWith('.xlsx')) {
    const sheet = readXlsx(bytes)
    const [header = [], ...rows] = sheet.rows
    if (header.length === 0) throw new UploadError('This Excel file has no rows.')
    return { fileName, format: 'xlsx', sheetName: sheet.sheetName, header: header.map((h) => String(h ?? '')), rows, types: sheet.types }
  }
  throw new UploadError('Upload a CSV or Excel (.xlsx) file.')
}

/** What the model is shown: never the whole file. */
export function describeUpload(u: Upload, sample = 5) {
  return { fileName: u.fileName, format: u.format, sheet: u.sheetName, columns: u.header, rowCount: u.rows.length, sampleRows: u.rows.slice(0, sample) }
}

const Column = z.string().min(1).describe('A column name exactly as it appears in the header.')

export const UploadChangeSchema = z.discriminatedUnion('change', [
  z.object({
    change: z.literal('adjust_numbers'),
    column: Column,
    percent: z.number().min(-90).max(500).describe('Percent change, e.g. 5 for +5% or -10 for −10%.'),
    rounding: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('ending'), ending: z.number().min(0).max(0.99).describe('Round to the nearest price ending in this, e.g. 0.99.') }),
      z.object({ mode: z.literal('decimals'), places: z.number().int().min(0).max(4) }),
    ]),
  }),
  z.object({ change: z.literal('remove_duplicates'), column: Column, ignoreCase: z.boolean().describe('Treat "A@x.com" and "a@x.com" as the same.') }),
  z.object({ change: z.literal('change_case'), column: Column, case: z.enum(['title', 'upper', 'lower']) }),
  z.object({ change: z.literal('trim_spaces'), column: Column.optional().describe('Omit to trim every text column.') }),
])

export type UploadChange = z.infer<typeof UploadChangeSchema>

/** Rounds to the nearest value ending in `ending` (in cents), e.g. 23.40 → 22.99 or 23.99, whichever is nearer; ties go up. */
export function roundToEnding(value: number, ending: number): number {
  const cents = Math.round(value * 100)
  const end = Math.round(ending * 100)
  const k = Math.floor((cents - end) / 100)
  const below = k * 100 + end
  const above = below + 100
  return (cents - below < above - cents ? below : above) / 100
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())

export function applyChanges(u: Upload, changes: UploadChange[]): { upload: Upload; summary: string[] } {
  let rows = u.rows.map((r) => [...r])
  const summary: string[] = []
  const col = (name: string) => {
    const i = u.header.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase())
    if (i < 0) throw new UploadError(`There is no column called “${name}” in ${u.fileName}.`)
    return i
  }
  for (const c of changes) {
    switch (c.change) {
      case 'adjust_numbers': {
        const i = col(c.column)
        let changed = 0
        rows = rows.map((r) => {
          const raw = r[i]
          const n = typeof raw === 'number' ? raw : raw !== null && raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : null
          if (n === null) return r
          const next = n * (1 + c.percent / 100)
          const rounded = c.rounding.mode === 'ending' ? roundToEnding(next, c.rounding.ending) : Math.round(next * 10 ** c.rounding.places) / 10 ** c.rounding.places
          changed++
          const out = [...r]
          out[i] = typeof raw === 'number' ? rounded : rounded.toFixed(c.rounding.mode === 'ending' ? 2 : c.rounding.places)
          return out
        })
        summary.push(`${c.percent > 0 ? 'Raised' : 'Lowered'} ${changed} values in “${u.header[i]}” by ${Math.abs(c.percent)}%.`)
        break
      }
      case 'remove_duplicates': {
        const i = col(c.column)
        const seen = new Set<string>()
        const before = rows.length
        rows = rows.filter((r) => {
          const key = String(r[i] ?? '').trim()
          const k = c.ignoreCase ? key.toLowerCase() : key
          if (k === '') return true
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        summary.push(`Removed ${before - rows.length} duplicate rows by “${u.header[i]}”, keeping the first of each.`)
        break
      }
      case 'change_case': {
        const i = col(c.column)
        rows = rows.map((r) => {
          if (typeof r[i] !== 'string') return r
          const out = [...r]
          const s = r[i] as string
          out[i] = c.case === 'title' ? titleCase(s) : c.case === 'upper' ? s.toUpperCase() : s.toLowerCase()
          return out
        })
        summary.push(`Changed “${u.header[i]}” to ${c.case === 'title' ? 'title case' : `${c.case} case`}.`)
        break
      }
      case 'trim_spaces': {
        const idx = c.column ? [col(c.column)] : u.header.map((_, i) => i)
        rows = rows.map((r) => r.map((v, i) => (idx.includes(i) && typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v)))
        summary.push(c.column ? `Trimmed spaces in “${c.column}”.` : 'Trimmed spaces in every column.')
        break
      }
    }
  }
  return { upload: { ...u, rows }, summary }
}

/** Writes the changed upload back in its own format, with its own header, column order and sheet name. */
export function writeUpload(u: Upload): Uint8Array {
  const table: Table = {
    name: u.sheetName,
    columns: u.header.map((label, i) => ({ key: `c${i}`, label, type: u.types[i] === 'integer' ? 'number' : (u.types[i] ?? 'text') })),
    rows: u.rows,
  }
  return u.format === 'csv' ? new TextEncoder().encode(writeCsv({ ...table, columns: table.columns.map((c) => ({ ...c, type: 'text' })) })) : writeXlsx(table)
}
