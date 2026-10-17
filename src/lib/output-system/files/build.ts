// Turns a file spec into bytes: Excel, CSV and JSON directly, PDF through the
// document engine (a brief with a table, so it gets the engine's type, the
// store's brand and pagination with repeated table headers). Pure: the PDF
// needs export resources passed in, browser or Node.

import { ADAPTERS } from '../../documents/export/adapters'
import { FORMAT_FILE } from '../../documents/export/capabilities'
import type { ExportResources } from '../../documents/export/resources'
import { formatMoney } from '../../documents/money'
import type { BriefSnapshot, TableColumn } from '../../documents/model'
import { BRIEF_FIELDS } from '../../documents/brief'
import { date, fieldMap, provided, text } from '../../documents/fixtures/builders'
import { ANCHOR_DATE, type Store } from '../fixtures/stores'
import { writeCsv } from './csv'
import { buildDataset, writeJson, type DatasetResult, type DataFormat, type FileSpec } from './datasets'
import type { Table } from './table'
import { writeXlsx } from './xlsx'

export const MIME: Record<DataFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  json: 'application/json',
  pdf: FORMAT_FILE.pdf.mimeType,
}

export const FORMAT_NAME: Record<DataFormat, string> = { xlsx: 'Excel', csv: 'CSV', json: 'JSON', pdf: 'PDF' }

export type BuiltFile = { fileName: string; format: DataFormat; mimeType: string; bytes: Uint8Array; rows: number; title: string }

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Which columns a PDF shows: the ones a reader scans, so the table fits the page. */
const PDF_COLUMNS: Record<FileSpec['dataset'], string[]> = {
  orders: ['orderNumber', 'date', 'customer', 'status', 'units', 'total'],
  products: ['sku', 'title', 'category', 'price', 'stock'],
  customers: ['name', 'city', 'firstOrder', 'orders', 'spent'],
}

function pdfSnapshot(store: Store, spec: FileSpec, result: DatasetResult): BriefSnapshot {
  const keep = PDF_COLUMNS[spec.dataset].map((k) => result.table.columns.findIndex((c) => c.key === k)).filter((i) => i >= 0)
  const columns: TableColumn[] = keep.map((i) => {
    const c = result.table.columns[i]
    const numeric = c.type === 'money' || c.type === 'integer' || c.type === 'number'
    return { id: c.key, label: c.label, align: numeric ? 'end' : 'start', numeric }
  })
  const show = (v: unknown, type: string) =>
    v === null || v === undefined ? '' : type === 'money' ? formatMoney({ amountMinor: Math.round(Number(v) * 100), currency: store.currency }, store.locale).replace(/[^\d.,-]/g, '') : String(v)
  const { fields, fieldOrder } = fieldMap([
    provided(BRIEF_FIELDS.title, 'Title', text(result.title)),
    provided(BRIEF_FIELDS.audience, 'Intended audience', text(`${store.name} team`)),
    provided(BRIEF_FIELDS.preparedBy, 'Prepared by', text(store.name), { required: false }),
    provided(BRIEF_FIELDS.date, 'Date', date(ANCHOR_DATE), { required: false }),
  ])
  const n = result.table.rows.length
  return {
    schemaVersion: 1,
    kind: 'brief',
    templateId: 'brief@1',
    locale: store.locale,
    brand: store.brand,
    fields,
    fieldOrder,
    citations: [],
    layoutPreset: store.pageSize,
    blocks: [
      { id: 'blk-about', type: 'paragraph', runs: [{ text: `${n} ${n === 1 ? 'row' : 'rows'}. Amounts in ${store.currency}. Sample data from a fictional store.` }] },
      {
        id: 'blk-table',
        type: 'table',
        columns,
        rows: result.table.rows.map((r, ri) => ({ id: `r${ri + 1}`, cells: Object.fromEntries(keep.map((i) => [result.table.columns[i].key, show(r[i], result.table.columns[i].type)])) })),
      },
    ],
  }
}

export type BuildOptions = { resources?: (snapshot: BriefSnapshot) => Promise<ExportResources> | ExportResources; createdAt?: string }

export async function buildFile(store: Store, spec: FileSpec, options: BuildOptions = {}): Promise<BuiltFile> {
  const result = buildDataset(store, spec)
  const base = { format: spec.format, mimeType: MIME[spec.format], rows: result.table.rows.length, title: result.title, fileName: `${safeName(`${store.name} ${result.title}`)}.${spec.format}` }
  if (spec.format === 'xlsx') return { ...base, bytes: writeXlsx(result.table, { createdAt: options.createdAt }) }
  if (spec.format === 'csv') return { ...base, bytes: new TextEncoder().encode(writeCsv(result.table)) }
  if (spec.format === 'json') return { ...base, bytes: new TextEncoder().encode(writeJson(store, result)) }
  if (!options.resources) throw new Error('A PDF needs export resources.')
  const snapshot = pdfSnapshot(store, spec, result)
  const out = await ADAPTERS.pdf.render(snapshot, { resources: await options.resources(snapshot), title: result.title, subject: `${store.name}: ${result.title}`, createdAt: options.createdAt ?? `${ANCHOR_DATE}T00:00:00.000Z` })
  if (!out.ok) throw new Error(out.error.message)
  return { ...base, bytes: out.bytes }
}

export type { Table }
