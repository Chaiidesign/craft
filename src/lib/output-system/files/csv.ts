// CSV (RFC 4180): comma-separated, CRLF line endings, fields quoted only when
// they contain a comma, quote or line break. UTF-8 without a byte-order mark
// (D-83, assumed). Money is written as a plain number with two decimals.

import type { Cell, Column, Table } from './table'

const needsQuotes = /[",\r\n]/

function field(value: Cell, type: Column['type']): string {
  if (value === null) return ''
  const text = typeof value === 'number' ? (type === 'money' ? value.toFixed(2) : String(value)) : value
  return needsQuotes.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function writeCsv(table: Table): string {
  const lines = [table.columns.map((c) => field(c.label, 'text')).join(',')]
  for (const row of table.rows) lines.push(row.map((v, i) => field(v, table.columns[i]?.type ?? 'text')).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Parses CSV text into rows of strings. Handles quoted fields, escaped quotes, CRLF or LF, and a leading byte-order mark. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}
