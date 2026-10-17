// Minimal Excel (.xlsx, Office Open XML SpreadsheetML) writer and reader on
// fflate's zip (MIT, already installed with jspdf; D-83). Enough for data files:
// one sheet, a bold frozen header row, column widths, real numbers for money
// and integers, real dates (serial numbers with a yyyy-mm-dd format) and
// inline strings. The reader handles what common tools write: shared or inline
// strings, numbers, booleans, and dates detected from the cell's number format.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { sheetName, type Cell, type Column, type ColumnType, type Table } from './table'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')

function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/** "2026-09-30" → Excel serial day number. */
export function isoToSerial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000)
}

export function serialToIso(serial: number): string {
  return new Date(EXCEL_EPOCH + Math.round(serial) * 86_400_000).toISOString().slice(0, 10)
}

// Style indexes in styles.xml cellXfs: 0 default, 1 bold header, 2 date, 3 money, 4 integer.
const STYLE: Record<ColumnType, number> = { text: 0, date: 2, money: 3, integer: 4, number: 0 }

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function cellXml(ref: string, value: Cell, type: ColumnType, header = false): string {
  if (value === null || value === '') return ''
  if (header) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `<c r="${ref}" s="${STYLE.date}"><v>${isoToSerial(value)}</v></c>`
  if (typeof value === 'number') return `<c r="${ref}" s="${STYLE[type]}"><v>${value}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
}

function width(col: Column, rows: Cell[][], i: number): number {
  const longest = Math.max(col.label.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length))
  return Math.min(60, Math.max(8, longest + 2))
}

export function writeXlsx(table: Table, options: { createdAt?: string } = {}): Uint8Array {
  const name = sheetName(table.name)
  const cols = table.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(c, table.rows, i)}" customWidth="1"/>`).join('')
  const header = `<row r="1">${table.columns.map((c, i) => cellXml(`${colName(i)}1`, c.label, 'text', true)).join('')}</row>`
  const body = table.rows
    .map((row, r) => `<row r="${r + 2}">${row.map((v, i) => cellXml(`${colName(i)}${r + 2}`, v, table.columns[i]?.type ?? 'text')).join('')}</row>`)
    .join('')
  const lastRef = `${colName(Math.max(0, table.columns.length - 1))}${table.rows.length + 1}`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastRef}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`
  const created = options.createdAt ?? '2026-09-30T00:00:00Z'
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(table.name)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  // Fixed modification time so the same table always gives the same bytes.
  return zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') })
}

export type ReadSheet = {
  sheetName: string
  /** Every row, header first. Dates come back as YYYY-MM-DD strings. */
  rows: Cell[][]
  /** Per column: whether its cells were dates, numbers or text in the file. */
  types: ColumnType[]
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]

/** Reads the first sheet of an .xlsx file. Throws on files that aren't xlsx. */
export function readXlsx(bytes: Uint8Array): ReadSheet {
  const files = unzipSync(bytes)
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : undefined)
  const workbook = text('xl/workbook.xml')
  if (!workbook) throw new Error('This file isn’t an Excel workbook.')
  const firstSheet = workbook.match(/<sheet\b[^>]*>/)?.[0] ?? ''
  const name = unesc(attr(firstSheet, 'name') ?? 'Sheet1')
  const rid = attr(firstSheet, 'r:id')
  const rels = text('xl/_rels/workbook.xml.rels') ?? ''
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'Id') === rid)
  const sheetPath = target ? `xl/${(attr(target, 'Target') ?? 'worksheets/sheet1.xml').replace(/^\/?xl\//, '').replace(/^\//, '')}` : 'xl/worksheets/sheet1.xml'
  const sheet = text(sheetPath) ?? text('xl/worksheets/sheet1.xml')
  if (!sheet) throw new Error('This workbook has no readable sheet.')

  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  )
  // Which style indexes are dates: built-in date formats 14–22 and 45–47, or custom formats with y/m/d.
  const styles = text('xl/styles.xml') ?? ''
  const customDate = new Set(
    [...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => m[0]).filter((t) => /[yd]/i.test(attr(t, 'formatCode') ?? '')).map((t) => Number(attr(t, 'numFmtId'))),
  )
  const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0)
    return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id)
  })

  const rows: Cell[][] = []
  const kinds: Set<ColumnType>[] = []
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const row: Cell[] = []
    for (const c of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c ${c[1]}>`
      const i = colIndex(attr(tag, 'r') ?? colName(row.length))
      const t = attr(tag, 't')
      const s = Number(attr(tag, 's') ?? 0)
      const inner = c[2] ?? ''
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value: Cell = null
      let kind: ColumnType = 'text'
      if (t === 's' && v !== undefined) value = shared[Number(v)] ?? ''
      else if (t === 'inlineStr') value = unesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))
      else if (t === 'str' || t === 'e') value = v !== undefined ? unesc(v) : ''
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else if (v !== undefined) {
        const n = Number(v)
        if (dateStyle[s]) {
          value = serialToIso(n)
          kind = 'date'
        } else {
          value = n
          kind = Number.isInteger(n) ? 'integer' : 'number'
        }
      }
      while (row.length < i) row.push(null)
      row[i] = value
      if (rows.length > 0 && value !== null) (kinds[i] ??= new Set()).add(kind)
    }
    rows.push(row)
  }
  const width = Math.max(0, ...rows.map((r) => r.length))
  for (const r of rows) while (r.length < width) r.push(null)
  const types: ColumnType[] = Array.from({ length: width }, (_, i) => {
    const k = kinds[i]
    if (!k || k.size === 0) return 'text'
    if (k.size === 1) return [...k][0]
    if ([...k].every((x) => x === 'integer' || x === 'number')) return 'number'
    return 'text'
  })
  return { sheetName: name, rows, types }
}
