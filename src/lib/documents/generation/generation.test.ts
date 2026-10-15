import { describe, expect, it } from 'vitest'

import { composeDocument } from '@/lib/documents/compose'
import { fixedEnv } from '@/lib/documents/fixtures/builders'
import { INVOICE_FIELDS as F } from '@/lib/documents/invoice'
import { emptyStore, getDocument, getRevision, history } from '@/lib/documents/revisions'
import { nodeResources } from '@/lib/documents/testing/nodeResources'
import { readZip, zipText } from '@/lib/documents/testing/zip'
import type { InvoiceSnapshot } from '@/lib/documents/model'

import { ModelError, ScriptedModel } from './model'
import { MAX_RETRIES } from './loop'
import { blankInvoice, exportDocument, generateDocument, reviseDocument, toolSchemas, type DocumentResult } from './tools'

const PROMPT = 'invoice for Acme, $2,400'

/** What a well-behaved model proposes for the done-condition prompt. */
const acmeProposal = {
  intent: { docType: 'invoice', audience: 'recipient', summary: 'Invoice to Acme for $2,400' },
  statedAmount: { amount: '2400', evidence: '$2,400' },
  operations: [
    { op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Acme' }, provenance: { source: 'prompt', evidence: 'Acme' } },
    { op: 'setField', fieldId: F.currency, value: { type: 'currency', code: 'USD' }, provenance: { source: 'prompt', evidence: '$2,400' } },
    { op: 'addLineItem', description: null, quantity: '1', unitPrice: { amount: '2400' }, provenance: { source: 'prompt', evidence: '$2,400' } },
  ],
  followUp: 'What does the $2,400 cover?',
}

const withOps = (operations: unknown[], extra: Record<string, unknown> = {}) => ({ ...acmeProposal, operations, ...extra })

function context(model?: ScriptedModel) {
  return { store: emptyStore(), env: fixedEnv(), model }
}

async function generated(model = new ScriptedModel([acmeProposal])) {
  const ctx = context(model)
  const out = await generateDocument({ prompt: PROMPT }, ctx)
  if (!out.ok) throw new Error(JSON.stringify(out.error))
  return { ...ctx, store: out.store, result: out.result }
}

describe('generate: the done-condition prompt', () => {
  it('saves a validated, incomplete invoice as v1 with every unstated fact left unknown', async () => {
    const { store, result } = await generated()
    expect(result).toMatchObject({ version: 1, readiness: 'incomplete', followUp: 'What does the $2,400 cover?', attempts: 1 })
    const snapshot = getRevision(store, result.revisionId).snapshot as InvoiceSnapshot
    expect(snapshot.fields[F.buyerName].state).toEqual({ status: 'provided', value: { type: 'text', text: 'Acme' } })
    for (const id of [F.issuerName, F.number, F.issueDate, F.dueDate, F.taxApplicability, F.paymentTerms]) {
      expect(snapshot.fields[id].state.status).toBe('missing')
    }
    const lines = result.document.lineItems
    expect(lines).toEqual([expect.objectContaining({ description: null, quantity: '1', unitPrice: '2400.00' })])
    expect(result.document.totals).toMatchObject({ subtotal: '2400.00', total: null })
    expect(result.document.missing).toContain('Description for line 1 has not been supplied.')
    // Provenance: each set value quotes the prompt; unknowns have none.
    expect(snapshot.provenance).toEqual({
      [`field:${F.buyerName}`]: { source: 'prompt', evidence: 'Acme' },
      [`field:${F.currency}`]: { source: 'prompt', evidence: '$2,400' },
      [`line:${lines[0].id}`]: { source: 'prompt', evidence: '$2,400' },
    })
  })

  it('composes without a letterhead or an invented issuer (D-61) and marks the description missing', async () => {
    const { store, result } = await generated()
    const plan = composeDocument(getRevision(store, result.revisionId).snapshot)
    expect(plan.nodes.some((n) => n.primitive === 'letterhead')).toBe(false)
    const footer = plan.nodes.find((n) => n.primitive === 'page-footer')
    expect(footer).toMatchObject({ identification: 'Invoice (number missing)' })
    const table = plan.nodes.find((n) => n.primitive === 'invoice-line-items')
    expect(table?.primitive === 'invoice-line-items' && table.rows[0].description).toEqual({ kind: 'missing', label: 'Description', required: true })
  })

  it('records the generator as the author and the prompt-derived values as the change', async () => {
    const { store, result } = await generated()
    const revision = getRevision(store, result.revisionId)
    expect(revision.author.name).toBe('Document generator')
    expect(revision.operation).toEqual({ type: 'create' })
    expect(result.changed).toHaveLength(3)
  })
})

describe('unbranded documents (D-61)', () => {
  it('take a stated issuer as an ordinary field and show it in the footer, still with no letterhead', async () => {
    const v1 = await generated()
    const issuer = v1.result.document.fields.find((f) => f.id === F.issuerName)!
    const out = await reviseDocument({ revisionId: v1.result.revisionId, operations: [{ op: 'setField', fieldId: F.issuerName, expectedDigest: issuer.digest, value: { type: 'text', text: 'Northwind Studio' }, provenance: { source: 'caller' } }] }, { store: v1.store, env: v1.env })
    if (!out.ok) throw new Error(JSON.stringify(out.error))
    const plan = composeDocument(getRevision(out.store, out.result.revisionId).snapshot)
    expect(plan.nodes.some((n) => n.primitive === 'letterhead')).toBe(false)
    expect(plan.nodes.find((n) => n.primitive === 'page-footer')).toMatchObject({ identification: 'Northwind Studio · Invoice (number missing)' })
  })
})

describe('the gate (D-49): invalid output never becomes a revision', () => {
  async function refused(proposals: unknown[]) {
    const model = new ScriptedModel(proposals)
    const ctx = context(model)
    const out = await generateDocument({ prompt: PROMPT }, ctx)
    expect(out.ok).toBe(false)
    expect(out.store.documents.size).toBe(0)
    expect(out.store.revisions.size).toBe(0)
    if (out.ok) throw new Error('unreachable')
    return { error: out.error, model }
  }
  const thrice = (p: unknown) => [p, p, p]

  it('refuses line items that do not add up to the stated amount', async () => {
    const { error } = await refused(thrice(withOps([acmeProposal.operations[0], acmeProposal.operations[1], { op: 'addLineItem', description: null, quantity: '2', unitPrice: { amount: '2400' }, provenance: { source: 'prompt', evidence: '$2,400' } }])))
    expect(error.code).toBe('gate-failed')
    expect(error.errors).toContainEqual(expect.objectContaining({ code: 'sum-mismatch', message: 'The request states 2400, but the line items come to 4800.00.' }))
  })

  it('refuses a value of the wrong type for its field', async () => {
    const { error } = await refused(thrice(withOps([...acmeProposal.operations, { op: 'setField', fieldId: F.issueDate, value: { type: 'text', text: 'today' }, provenance: { source: 'prompt', evidence: 'invoice' } }])))
    expect(error.errors).toContainEqual(expect.objectContaining({ code: 'wrong-type', path: 'operations[3].value.type', target: `field:${F.issueDate}` }))
  })

  it('refuses malformed output at the schema layer, with paths', async () => {
    const { error } = await refused(thrice({ intent: acmeProposal.intent, statedAmount: null, operations: [{ fieldId: F.buyerName }], followUp: null }))
    expect(error.errors?.every((e) => e.code === 'schema')).toBe(true)
    expect(error.errors?.map((e) => e.path)).toContain('operations[0].op')
  })

  it('refuses values the request does not state (quote not found, number not in the quote)', async () => {
    const { error } = await refused(thrice(withOps([
      { op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Globex' }, provenance: { source: 'prompt', evidence: 'Globex' } },
      acmeProposal.operations[1],
      { op: 'addLineItem', description: null, quantity: '1', unitPrice: { amount: '3000' }, provenance: { source: 'prompt', evidence: '$2,400' } },
    ], { statedAmount: null })))
    expect(error.errors?.map((e) => e.code)).toEqual(['evidence-not-found', 'evidence-not-found'])
    expect(error.errors?.[1].message).toBe('The quote “$2,400” does not state 3000. Numbers must come from the request.')
  })

  it('refuses unknown targets and a model claiming caller provenance', async () => {
    const { error } = await refused(thrice(withOps([
      ...acmeProposal.operations,
      { op: 'updateLineItem', itemId: 'li-999', expectedDigest: '00000000', quantity: '2', provenance: { source: 'prompt', evidence: 'Acme' } },
      { op: 'setField', fieldId: F.number, value: { type: 'text', text: 'INV-1' }, provenance: { source: 'caller' } },
    ])))
    expect(error.errors?.map((e) => e.code)).toEqual(['unknown-target', 'provenance-not-allowed'])
  })

  it('refuses a document craft\'s own validation calls invalid (layer 3)', async () => {
    const { error } = await refused(thrice(withOps([
      ...acmeProposal.operations,
      { op: 'setField', fieldId: F.taxApplicability, value: { type: 'choice', option: 'exempt' }, provenance: { source: 'prompt', evidence: 'Acme' } },
      { op: 'setField', fieldId: F.taxRate, value: { type: 'percent', percent: '0' }, provenance: { source: 'prompt', evidence: '$2,400' } },
    ], { statedAmount: null })))
    expect(error.errors).toEqual([expect.objectContaining({ code: 'semantic', path: `field:${F.taxRate}:contradiction`, target: `field:${F.taxRate}` })])
  })

  it('refuses a value outside its range', async () => {
    const { error } = await refused(thrice(withOps([
      ...acmeProposal.operations,
      { op: 'setField', fieldId: F.taxRate, value: { type: 'percent', percent: '2400' }, provenance: { source: 'prompt', evidence: '$2,400' } },
    ], { statedAmount: null })))
    expect(error.errors).toEqual([expect.objectContaining({ code: 'invalid-value', target: `field:${F.taxRate}` })])
  })

  it('gives up after the bounded retries, returning the last errors', async () => {
    const bad = withOps([{ op: 'setField', fieldId: F.issueDate, value: { type: 'date', iso: '2026-02-30' }, provenance: { source: 'prompt', evidence: 'Acme' } }], { statedAmount: null })
    const { error, model } = await refused([bad, bad, bad, acmeProposal])
    expect(model.requests).toHaveLength(MAX_RETRIES + 1)
    expect(error).toMatchObject({ code: 'gate-failed', message: 'No valid document after 3 attempts; nothing was saved.', retryable: true })
    expect(error.errors).toEqual([expect.objectContaining({ code: 'invalid-value', message: '2026-02-30 is not a real calendar date.' })])
  })
})

describe('the retry loop', () => {
  it('feeds the gate\'s errors back and saves the corrected proposal', async () => {
    const bad = withOps([acmeProposal.operations[0], acmeProposal.operations[1], { op: 'addLineItem', description: null, quantity: '1', unitPrice: { amount: '2000' }, provenance: { source: 'prompt', evidence: '$2,400' } }])
    const model = new ScriptedModel([bad, acmeProposal])
    const { result } = await generated(model)
    expect(result.attempts).toBe(2)
    expect(model.requests[0].previousErrors).toBeUndefined()
    expect(model.requests[1].previousErrors).toEqual([expect.objectContaining({ code: 'evidence-not-found' })])
  })

  it('reports a model that cannot run as model-unavailable, without retrying or substituting', async () => {
    const model = new ScriptedModel([new ModelError('model-unavailable', 'ANTHROPIC_API_KEY is not set.')])
    const out = await generateDocument({ prompt: PROMPT }, context(model))
    expect(out).toMatchObject({ ok: false, error: { code: 'model-unavailable', message: 'ANTHROPIC_API_KEY is not set.', retryable: false } })
    expect(model.requests).toHaveLength(1)
  })

  it('tells the model what it is working on: the blank document view and today', async () => {
    const model = new ScriptedModel([acmeProposal])
    await generated(model)
    const [request] = model.requests
    expect(request).toMatchObject({ task: 'generate', docType: 'invoice', request: PROMPT, today: '2026-10-01' })
    expect(request.document.fields.map((f) => f.id)).toContain(F.buyerName)
  })
})

describe('revise', () => {
  async function revised(prev: { store: ReturnType<typeof emptyStore>; env: ReturnType<typeof fixedEnv>; result: DocumentResult }, instruction: string, proposal: unknown) {
    const model = new ScriptedModel([proposal])
    const out = await reviseDocument({ revisionId: prev.result.revisionId, instruction }, { store: prev.store, env: prev.env, model })
    return { out, model }
  }

  it('applies two refinements in a row as v2 and v3, keeping every untouched ID', async () => {
    const v1 = await generated()
    const line1 = v1.result.document.lineItems[0]
    const currency = v1.result.document.fields.find((f) => f.id === F.currency)!

    const add = 'add a line item: design review, $600'
    const r2 = await revised(v1, add, {
      intent: acmeProposal.intent, statedAmount: null, followUp: null,
      operations: [{ op: 'addLineItem', description: 'Design review', quantity: '1', unitPrice: { amount: '600' }, provenance: { source: 'prompt', evidence: 'design review, $600' } }],
    })
    if (!r2.out.ok) throw new Error(JSON.stringify(r2.out.error))
    expect(r2.out.result).toMatchObject({ version: 2, attempts: 1 })
    expect(r2.model.requests[0]).toMatchObject({ task: 'revise', request: add })
    const lines2 = r2.out.result.document.lineItems
    expect(lines2.map((l) => l.id)).toEqual([line1.id, expect.any(String)])
    expect(lines2[0].digest).toBe(line1.digest)
    expect(r2.out.result.document.totals.subtotal).toBe('3000.00')

    const v2 = { store: r2.out.store, env: v1.env, result: r2.out.result }
    const due = 'due in 30 days'
    const dueDigest = v2.result.document.fields.find((f) => f.id === F.paymentTerms)!.digest
    const r3 = await revised(v2, due, {
      intent: acmeProposal.intent, statedAmount: null, followUp: 'What is the invoice date?',
      operations: [{ op: 'setField', fieldId: F.paymentTerms, expectedDigest: dueDigest, value: { type: 'text', text: 'Due within 30 days of the invoice date.' }, provenance: { source: 'prompt', evidence: 'due in 30 days' } }],
    })
    if (!r3.out.ok) throw new Error(JSON.stringify(r3.out.error))
    expect(r3.out.result.version).toBe(3)
    expect(r3.out.result.document.lineItems.map((l) => l.digest)).toEqual(lines2.map((l) => l.digest))
    expect(r3.out.result.document.fields.find((f) => f.id === F.currency)!.digest).toBe(currency.digest)

    const store = r3.out.store
    const doc = getDocument(store, v1.result.outputId)
    expect(doc.revisionIds).toHaveLength(3)
    const summaries = history(store, v1.result.outputId).map((r) => r.changeSummary)
    expect(summaries).toEqual(['Created', 'Added line 2', 'Set Payment terms'])
    expect(getRevision(store, r3.out.result.revisionId).operation).toEqual({ type: 'generate', caller: 'model', targets: [`field:${F.paymentTerms}`] })
    // v1 is unchanged: history is never rewritten.
    expect(getRevision(store, v1.result.revisionId).snapshot).toBe(getRevision(v1.store, v1.result.revisionId).snapshot)
  })

  it('refuses a stale or missing digest, and a revision that is not current', async () => {
    const v1 = await generated()
    const line = v1.result.document.lineItems[0]
    const base = { intent: acmeProposal.intent, statedAmount: null, followUp: null }
    const stale = await reviseDocument({ revisionId: v1.result.revisionId, operations: [{ op: 'updateLineItem', itemId: line.id, expectedDigest: 'deadbeef', quantity: '2', provenance: { source: 'caller' } }] }, { store: v1.store, env: v1.env })
    expect(stale).toMatchObject({ ok: false, error: { code: 'gate-failed', errors: [expect.objectContaining({ code: 'stale-target', target: `line:${line.id}` })] } })

    const noDigest = { ...base, operations: [{ op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Acme Corp' }, provenance: { source: 'prompt', evidence: 'Acme Corp' } }] }
    const r = await reviseDocument({ revisionId: v1.result.revisionId, instruction: 'bill Acme Corp instead' }, { store: v1.store, env: v1.env, model: new ScriptedModel([noDigest, noDigest, noDigest]) })
    expect(r).toMatchObject({ ok: false, error: { code: 'gate-failed' } })
    if (r.ok) throw new Error('unreachable')
    expect(r.error.errors?.[0]).toMatchObject({ code: 'missing-digest', path: 'operations[0].expectedDigest' })

    const ok = await reviseDocument({ revisionId: v1.result.revisionId, operations: [{ op: 'updateLineItem', itemId: line.id, expectedDigest: line.digest, description: 'Brand workshop', provenance: { source: 'caller' } }] }, { store: v1.store, env: v1.env })
    if (!ok.ok) throw new Error(JSON.stringify(ok.error))
    const old = await reviseDocument({ revisionId: v1.result.revisionId, operations: [{ op: 'removeLineItem', itemId: line.id, expectedDigest: line.digest }] }, { store: ok.store, env: v1.env })
    expect(old).toMatchObject({ ok: false, error: { code: 'not-current', retryable: true } })
  })

  it('refuses operations that change nothing', async () => {
    const v1 = await generated()
    const buyer = v1.result.document.fields.find((f) => f.id === F.buyerName)!
    const out = await reviseDocument({ revisionId: v1.result.revisionId, operations: [{ op: 'setField', fieldId: F.buyerName, expectedDigest: buyer.digest, value: { type: 'text', text: 'Acme' }, provenance: { source: 'caller' } }] }, { store: v1.store, env: v1.env })
    expect(out).toMatchObject({ ok: false, error: { code: 'gate-failed', errors: [expect.objectContaining({ code: 'no-change' })] } })
  })
})

describe('direct callers (agents) use the same gate without a model', () => {
  it('generates from operations with caller provenance, and refuses prompt quotes with no prompt', async () => {
    const ctx = context()
    const ops = [
      { op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Acme' }, provenance: { source: 'caller' } },
      { op: 'setField', fieldId: F.currency, value: { type: 'currency', code: 'USD' }, provenance: { source: 'caller' } },
      { op: 'addLineItem', description: 'Consulting', quantity: '1', unitPrice: { amount: '2400' }, provenance: { source: 'caller' } },
    ]
    const out = await generateDocument({ docType: 'invoice', operations: ops }, ctx)
    expect(out).toMatchObject({ ok: true, result: { version: 1, attempts: 0, readiness: 'incomplete' } })
    if (!out.ok) throw new Error('unreachable')
    expect(getRevision(out.store, out.result.revisionId).author.name).toBe('Tool caller')

    const quoted = await generateDocument({ docType: 'invoice', operations: [{ ...ops[0], provenance: { source: 'prompt', evidence: 'Acme' } }] }, ctx)
    expect(quoted).toMatchObject({ ok: false, error: { code: 'gate-failed', errors: [expect.objectContaining({ code: 'provenance-not-allowed' })] } })
  })

  it('needs a model for prompts, and says so instead of guessing', async () => {
    expect(await generateDocument({ prompt: PROMPT }, context())).toMatchObject({ ok: false, error: { code: 'model-required' } })
  })

  it('rejects input that does not match the tool schema, with paths', async () => {
    const out = await generateDocument({ prompt: '' }, context())
    expect(out).toMatchObject({ ok: false, error: { code: 'invalid-input', errors: [expect.objectContaining({ code: 'schema' })] } })
  })

  it('publishes JSON schemas for the three tools and the operations', () => {
    const { tools, operations_schema } = toolSchemas()
    expect(tools.map((t) => t.name)).toEqual(['generate_document', 'revise_document', 'export_document'])
    for (const t of tools) expect(t.input_schema).toMatchObject({ $schema: expect.stringContaining('draft-07') })
    expect(JSON.stringify(operations_schema)).toContain('addLineItem')
    // Results are plain JSON: they survive a round trip.
    expect(JSON.parse(JSON.stringify(blankInvoice()))).toEqual(blankInvoice())
  })
})

describe('export: deterministic files from the pinned revision', () => {
  it('renders PDF and Word from v1 as drafts: PDF byte-identical, Word content-identical (D-62)', async () => {
    const v1 = await generated()
    const ctx = { store: v1.store, env: v1.env, resources: nodeResources }
    const twice = async (format: 'pdf' | 'docx') => {
      const a = await exportDocument({ revisionId: v1.result.revisionId, format }, ctx)
      const b = await exportDocument({ revisionId: v1.result.revisionId, format }, ctx)
      if (!a.ok || !b.ok) throw new Error(JSON.stringify(!a.ok ? a.error : !b.ok ? b.error : null))
      expect(a.result).toMatchObject({ version: 1, format, draft: true, pageCount: 1 })
      return [a.result.bytes, b.result.bytes] as const
    }
    const [pdfA, pdfB] = await twice('pdf')
    expect(Buffer.from(pdfA).equals(Buffer.from(pdfB))).toBe(true)
    const [docA, docB] = await twice('docx')
    // The docx library numbers pictures per process and keys embedded fonts randomly; the content is the same.
    const body = (bytes: Uint8Array) => zipText(readZip(bytes), 'word/document.xml').replace(/ id="\d+"/g, ' id=""')
    expect(body(docA)).toBe(body(docB))
    expect(body(docA)).toContain('Acme')
  })

  it('reports resources that fail to load as export-failed', async () => {
    const v1 = await generated()
    const out = await exportDocument({ revisionId: v1.result.revisionId, format: 'pdf' }, { store: v1.store, env: v1.env, resources: () => Promise.reject(new Error('Font file could not be fetched.')) })
    expect(out).toMatchObject({ ok: false, error: { code: 'export-failed', message: 'Font file could not be fetched.', retryable: true } })
  })

  it('refuses a format the kind does not support, and an unknown revision', async () => {
    const v1 = await generated()
    const ctx = { store: v1.store, env: v1.env, resources: nodeResources }
    expect(await exportDocument({ revisionId: v1.result.revisionId, format: 'pptx' }, ctx)).toMatchObject({ ok: false, error: { code: 'unsupported' } })
    expect(await exportDocument({ revisionId: 'rev-nope', format: 'pdf' }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})

describe('requests for a type the generator cannot make yet', () => {
  it('stop at once with unsupported-type, without retrying or saving', async () => {
    const memo = { intent: { docType: 'other', audience: 'internal', summary: 'A memo for the team' }, statedAmount: null, operations: [], followUp: null }
    const model = new ScriptedModel([memo, memo, memo])
    const out = await generateDocument({ prompt: 'memo for the team about the offsite' }, context(model))
    expect(model.requests).toHaveLength(1)
    expect(out).toMatchObject({ ok: false, error: { code: 'gate-failed', retryable: false, errors: [expect.objectContaining({ code: 'unsupported-type', retryable: false })] } })
    expect(out.store.revisions.size).toBe(0)
  })
})
