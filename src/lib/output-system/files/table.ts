// The plain table every file is written from. A file is one header row and one
// record per row (build-loop.md §3, "Data files"): ISO dates, money as plain
// numbers with the currency in its own column, no merged cells.

export type ColumnType = 'text' | 'date' | 'money' | 'integer' | 'number'

export type Column = { key: string; label: string; type: ColumnType }

export type Cell = string | number | null

export type Table = {
  /** Sheet name in Excel; also used in titles. At most 31 characters (Excel's limit). */
  name: string
  columns: Column[]
  rows: Cell[][]
}

export const EXCEL_SHEET_NAME_MAX = 31

export function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, EXCEL_SHEET_NAME_MAX).trim() || 'Sheet1'
}
