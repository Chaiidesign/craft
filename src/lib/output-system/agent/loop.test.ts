import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'

import { salesSummary } from '../fixtures/aggregates'
import { ANCHOR_DATE, sampleStore } from '../fixtures/stores'
import { LANES, type Lane } from '../lanes'
import { findForbiddenWords } from '../words'
import { runTurn, type ModelCall, type TurnInput } from './loop'
import { progressLabel, TERMINAL } from './tools'

type Block = { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown }

/** A scripted model: returns the given replies in order, and records what it was sent. */
function scripted(...replies: Block[][]) {
  const seen: Parameters<ModelCall>[0][] = []
  let n = 0
  const call: ModelCall = async (params) => {
    seen.push(structuredClone(params))
    const blocks = replies[n++] ?? [{ type: 'text', text: 'out of script' }]
    return {
      id: `msg_${n}`, type: 'message', role: 'assistant', model: 'scripted', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: blocks.map((b, i) => (b.type === 'text' ? { type: 'text', text: b.text, citations: null } : { type: 'tool_use', id: `tu_${n}_${i}`, name: b.name, input: b.input })),
    } as unknown as Anthropic.Message
  }
  return { call, seen }
}

const store = sampleStore('fernhill-goods')
const guides = Object.fromEntries(LANES.map((l) => [l, `Guide for ${l}`])) as Record<Lane, string>
const base = (call: ModelCall, extra: Partial<TurnInput> = {}): TurnInput => ({
  store, history: [], request: 'How did sales go last month?', prompt: 'PROMPT', guides, formats: { kinds: { file: { label: 'File' } } }, call, today: ANCHOR_DATE, ...extra,
})

const sept = salesSummary(store, { from: '2026-09-01', to: '2026-09-30' })
const usd = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

describe('the output loop', () => {
  it('reads the guide, asks the store, and shows a reply whose numbers match', async () => {
    const { call, seen } = scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'chat_reply' } }],
      [{ type: 'tool_use', name: 'ask_store', input: { question: 'sales_summary', period: 'last_month' } }],
      [{ type: 'text', text: `September brought in ${usd(sept.revenueMinor)} from ${sept.orders} orders.` }],
    )
    const events: string[] = []
    const r = await runTurn(base(call, { onEvent: (e) => e.type === 'progress' && events.push(e.label) }))
    expect(r.made.kind).toBe('reply')
    expect(r.calls).toBe(3)
    expect(events).toEqual(['Writing your answer', 'Checking your store data'])
    expect(JSON.stringify(seen[1].messages)).toContain('Guide for chat_reply')
    expect(seen[0].system[1].text).toContain('Today is 2026-09-30')
    expect(seen[0].system[2].text).toContain('Guide for chat_reply')
  })

  it('retries once when a reply has a number the store never gave, then shows an honest error', async () => {
    const { call, seen } = scripted(
      [{ type: 'text', text: 'Sales were $99,999.00 from 1234 orders.' }],
      [{ type: 'text', text: 'Still $99,999.00.' }],
    )
    const r = await runTurn(base(call))
    expect(r.made).toEqual({ kind: 'error', message: 'Souvenir’s answer had numbers that don’t match your store data, so it wasn’t shown. Try asking again.' })
    expect(JSON.stringify(seen[1].messages)).toContain("These figures don't match any store answer: $99,999.00, 1234 orders")
  })

  it('retries a reply that uses system words', async () => {
    const { call } = scripted([{ type: 'text', text: 'I ran a sandbox command to check.' }], [{ type: 'text', text: 'Here is my answer.' }])
    const r = await runTurn(base(call, { request: 'hello' }))
    expect(r.made).toMatchObject({ kind: 'reply', text: 'Here is my answer.' })
  })

  it('refuses to make something before its guide is read', async () => {
    const { call, seen } = scripted(
      [{ type: 'tool_use', name: 'build_file', input: { source: 'store', dataset: 'orders', format: 'csv' } }],
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'file' } }],
      [{ type: 'tool_use', name: 'build_file', input: { source: 'store', dataset: 'orders', format: 'csv' } }],
    )
    const r = await runTurn(base(call, { request: 'orders as csv' }))
    expect(r.made.kind).toBe('file')
    expect(JSON.stringify(seen[1].messages)).toContain('Read the guide for file with read_guide before you make it')
  })

  it('makes a file from a store spec, and retries a malformed one once', async () => {
    const { call, seen } = scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'file' } }],
      [{ type: 'tool_use', name: 'build_file', input: { source: 'store', dataset: 'orders', format: 'docx' } }],
      [{ type: 'tool_use', name: 'build_file', input: { source: 'store', dataset: 'orders', format: 'xlsx', period: 'last_month' } }],
    )
    const r = await runTurn(base(call, { request: 'Export last month’s orders as Excel.' }))
    expect(r.made).toEqual({ kind: 'file', spec: { dataset: 'orders', format: 'xlsx', period: 'last_month' } })
    expect(JSON.stringify(seen[2].messages)).toContain('Not accepted')
  })

  it('refuses an upload change when nothing was uploaded', async () => {
    const { call } = scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'file' } }],
      [{ type: 'tool_use', name: 'build_file', input: { source: 'upload', changes: [{ change: 'trim_spaces' }] } }],
      [{ type: 'tool_use', name: 'build_file', input: { source: 'upload', changes: [{ change: 'trim_spaces' }] } }],
    )
    const r = await runTurn(base(call, { request: 'clean my file' }))
    expect(r.made.kind).toBe('error')
  })

  it('names offered formats from formats.json, whatever the model wrote', async () => {
    const { call } = scripted([{ type: 'tool_use', name: 'show_format_options', input: { thing: 'file', requestedFormat: 'docx', offered: ['pdf', 'Excel', '.csv'], message: 'Orders can’t be a Word file.' } }])
    const r = await runTurn(base(call, { formats: { kinds: {}, formats: { pdf: { label: 'PDF' }, docx: { label: 'Word' }, xlsx: { label: 'Excel' }, csv: { label: 'CSV' } } } }))
    expect(r.made).toMatchObject({ kind: 'format-options', requestedFormat: 'Word', offered: ['PDF', 'Excel', 'CSV'] })
  })

  it('shows coming later for kinds this build loop does not make', async () => {
    const { call } = scripted([{ type: 'tool_use', name: 'read_guide', input: { type: 'design' } }], [{ type: 'tool_use', name: 'create_design', input: { summary: 'A square summer sale ad' } }])
    expect((await runTurn(base(call, { request: 'Instagram ad' }))).made).toEqual({ kind: 'coming-later', lane: 'design', summary: 'A square summer sale ad' })
  })

  it('stops after the call limit', async () => {
    const loop = Array.from({ length: 10 }, () => [{ type: 'tool_use' as const, name: 'ask_store', input: { question: 'low_stock' } }])
    const r = await runTurn(base(scripted(...loop).call))
    expect(r.made.kind).toBe('error')
    expect(r.calls).toBe(6)
  })
})

describe('strict documents in the loop', () => {
  let n = 0
  const env = { now: () => '2026-09-30T10:00:00.000Z', nextId: (p: string) => `${p}-t${++n}` }
  const order = store.orders.find((o) => o.status === 'fulfilled')!

  it('makes a receipt from an order, says what it is making, and returns the new version', async () => {
    const { call, seen } = scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'strict_document' } }],
      [{ type: 'tool_use', name: 'create_strict_document', input: { type: 'receipt', fromOrder: order.number, followUp: 'What receipt number should it have?' } }],
    )
    const events: string[] = []
    const r = await runTurn(base(call, { request: `Receipt for order ${order.number}`, env, onEvent: (e) => e.type === 'progress' && events.push(e.label) }))
    expect(r.made).toMatchObject({ kind: 'document', docKind: 'receipt', version: 1, created: true, followUp: 'What receipt number should it have?' })
    expect(events).toContain('Making your receipt')
    expect(r.revisions?.revisions.size).toBe(1)
    expect(seen).toHaveLength(2)
  })

  it('a document is made only after its guide is read', async () => {
    const { call } = scripted(
      [{ type: 'tool_use', name: 'create_strict_document', input: { type: 'receipt', fromOrder: order.number } }],
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'strict_document' } }],
      [{ type: 'tool_use', name: 'create_strict_document', input: { type: 'receipt', fromOrder: order.number } }],
    )
    expect((await runTurn(base(call, { env }))).made.kind).toBe('document')
  })

  it('sends gate errors back once, then gives an honest error and saves nothing', async () => {
    const bad = { type: 'quote', products: [{ sku: 'NOPE-1', quantity: 1 }] }
    const { call, seen } = scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'strict_document' } }],
      [{ type: 'tool_use', name: 'create_strict_document', input: bad }],
      [{ type: 'tool_use', name: 'create_strict_document', input: bad }],
    )
    const r = await runTurn(base(call, { env }))
    expect(r.made.kind).toBe('error')
    expect(r.revisions).toBeUndefined()
    expect(JSON.stringify(seen[2].messages)).toContain('no product with SKU NOPE-1')
  })

  it('a follow-up changes the current document; its digests are in the context', async () => {
    const first = await runTurn(base(scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'strict_document' } }],
      [{ type: 'tool_use', name: 'create_strict_document', input: { type: 'receipt', fromOrder: order.number } }],
    ).call, { env }))
    if (first.made.kind !== 'document') throw new Error('no document')
    const documents = { revisions: first.revisions!, current: first.made.outputId }
    const { call, seen } = scripted(
      [{ type: 'tool_use', name: 'update_document', input: { operations: [{ op: 'setField', fieldId: 'invoice.number', value: { type: 'text', text: 'R-77' }, provenance: { source: 'prompt', evidence: 'number it R-77' }, expectedDigest: 'deadbeef' }] } }],
      [{ type: 'tool_use', name: 'update_document', input: { operations: [] } }],
    )
    const r = await runTurn(base(call, { request: 'Number it R-77', env, documents }))
    expect(seen[0].system[1].text).toContain('Made earlier in this conversation: a receipt, now at version 1')
    expect(JSON.stringify(seen[1].messages)).toContain('has changed since it was read')
    expect(r.made.kind).toBe('error')
  })

  it('exports the version asked for, and refuses a format the kind has no export for', async () => {
    const first = await runTurn(base(scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'strict_document' } }],
      [{ type: 'tool_use', name: 'create_strict_document', input: { type: 'receipt', fromOrder: order.number } }],
    ).call, { env }))
    if (first.made.kind !== 'document') throw new Error('no document')
    const documents = { revisions: first.revisions!, current: first.made.outputId }
    const pdf = await runTurn(base(scripted([{ type: 'tool_use', name: 'export_version', input: { format: 'PDF' } }]).call, { request: 'Make it a PDF', env, documents }))
    expect(pdf.made).toMatchObject({ kind: 'export', format: 'pdf', version: 1, revisionId: first.made.revisionId })
    const { call, seen } = scripted(
      [{ type: 'tool_use', name: 'export_version', input: { format: 'PowerPoint' } }],
      [{ type: 'tool_use', name: 'show_format_options', input: { thing: 'strict_document', requestedFormat: 'PowerPoint', offered: ['PDF', 'Word'], message: 'A receipt can’t be slides; it can be a PDF or Word file.' } }],
    )
    const slides = await runTurn(base(call, { request: 'As slides', env, documents }))
    expect(JSON.stringify(seen[1].messages)).toContain('show_format_options')
    expect(slides.made.kind).toBe('format-options')
  })

  it('a policy is coming later', async () => {
    const { call } = scripted(
      [{ type: 'tool_use', name: 'read_guide', input: { type: 'strict_document' } }],
      [{ type: 'tool_use', name: 'create_strict_document', input: { type: 'other', summary: 'A returns policy' } }],
    )
    expect((await runTurn(base(call, { env }))).made).toEqual({ kind: 'coming-later', lane: 'strict_document', summary: 'A returns policy' })
  })
})

describe('progress labels', () => {
  it('never use system words', () => {
    const labels = new Set([
      progressLabel('ask_store', {}), ...LANES.map((l) => progressLabel('read_guide', { type: l })), ...Object.keys(TERMINAL).map((t) => progressLabel(t, {})),
      ...['invoice', 'quote', 'purchase-order', 'receipt'].map((type) => progressLabel('create_strict_document', { type })),
      progressLabel('update_document', {}, 'quote'), progressLabel('export_version', {}, 'purchase order'),
    ])
    expect(labels).toContain('Making your purchase order')
    for (const l of labels) expect(findForbiddenWords(l), l).toEqual([])
  })
})

describe('tool schemas', () => {
  it('are plain objects at the top level, which the API requires', async () => {
    const { toolDefs } = await import('./tools')
    for (const t of toolDefs()) {
      expect(t.input_schema.type, t.name).toBe('object')
      for (const k of ['oneOf', 'anyOf', 'allOf']) expect(t.input_schema[k], `${t.name}.${k}`).toBeUndefined()
    }
  })
})
