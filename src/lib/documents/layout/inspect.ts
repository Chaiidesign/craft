// Plain-text view of laid-out fragments, in reading order. Used by tests to
// prove every word and row lands exactly once across pages, and by the browser
// parity check to compare drawn lines with engine lines.

import type { Line } from './text'
import type { FragmentBody, ValueLayout } from './blocks'

export const lineText = (l: Line) => l.segments.map((s) => s.text).join('')

export function valueLines(v: ValueLayout | null): Line[] {
  if (!v) return []
  return v.kind === 'unknown' ? [...v.lines, ...v.reasonLines] : v.lines
}

/** Every line a fragment draws, in order (repeated table headers included). */
export function fragmentLines(body: FragmentBody): Line[] {
  switch (body.primitive) {
    case 'letterhead': return [...(body.logo.kind === 'fallback' ? body.logo.lines : []), ...body.issuerLines]
    case 'title-block': return [...(body.draft?.lines ?? []), ...valueLines(body.title), ...body.meta.flatMap((c) => [...c.label, ...valueLines(c.value)])]
    case 'text': return [...(body.label ?? []), ...body.lines]
    case 'list': return body.items.flatMap((i) => i.lines)
    case 'key-value-group': return [...(body.title ?? []), ...body.cells.flatMap((c) => [...c.label, ...valueLines(c.value)])]
    case 'table': return [...(body.caption ?? []), ...body.header.cells.flat(), ...body.rows.flatMap((r) => [...(r.continuedLabel ? [r.continuedLabel] : []), ...r.cells.flatMap(valueLines)])]
    case 'totals': return body.rows.flatMap((r) => [...r.label, ...valueLines(r.value)])
    case 'chart': return [...body.title, ...body.axes, ...body.summary]
    case 'image': return [...body.note, ...body.caption]
    case 'source-list': return body.entries.flatMap((e) => e.lines)
  }
}

/** Lines that carry content (not repeated table headers or captions). */
export function contentLines(body: FragmentBody): string[] {
  if (body.primitive === 'table') return body.rows.flatMap((r) => r.cells.flatMap(valueLines)).map(lineText)
  return fragmentLines(body).map(lineText)
}
