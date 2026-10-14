import { describe, expect, it } from 'vitest'

import { fixedEnv, text } from '../fixtures/builders'
import { completeInvoice, incompleteInvoice } from '../fixtures/invoices'
import { evidenceBrief } from '../fixtures/brief'
import type { DocumentSnapshot } from '../model'
import { createDocument, deriveDeckRevision, emptyStore, saveEdit } from '../revisions'
import { nodeResources } from '../testing/nodeResources'
import { readPdf, squash } from '../testing/pdfText'
import { capability, formatsFor, FORMAT_FILE } from './capabilities'
import { FORCED_FAILURE_MESSAGE } from './adapters'
import { exportFilename, FILENAME_PART_MAX, shortRevisionId } from './filename'
import { emptyExports, ExportJobError, getExport, renderJob, retryRequest, settleExport, startExport, type ExportJob } from './jobs'
import { brandLongNameInvoice } from '../fixtures/invoices'

const files = new Map<string, Uint8Array>()
const keep = (bytes: Uint8Array, _mime: string, filename: string) => { files.set(filename, bytes); return `memory:${filename}` }

function setup(snapshot: DocumentSnapshot = completeInvoice()) {
  const env = fixedEnv()
  const { store, outputId, revision } = createDocument(emptyStore(), env, snapshot, { outputId: 'out-1' })
  return { env, store, outputId, v1: revision }
}

async function run(state: ReturnType<typeof emptyExports>, env: ReturnType<typeof fixedEnv>, job: ExportJob, forceFailure = false) {
  const outcome = await renderJob(job, { resources: nodeResources(job.snapshot), title: 't', subject: 's', createdAt: '2026-10-14T09:00:00.000Z', forceFailure })
  return settleExport(state, env, job, outcome, keep)
}

describe('capabilities', () => {
  it('invoices and briefs: PDF and Word; decks: PowerPoint and PDF; the rest unsupported with a reason', () => {
    expect(capability('invoice', 'pptx')).toEqual({ supported: false, reason: 'Invoices and briefs have no slide format.' })
    expect(capability('brief', 'pptx').supported).toBe(false)
    expect(capability('deck', 'docx')).toEqual({ supported: false, reason: 'Decks export as PowerPoint or PDF.' })
    for (const f of ['pdf', 'docx'] as const) expect(capability('invoice', f).supported).toBe(true)
    for (const f of ['pptx', 'pdf'] as const) expect(capability('deck', f).supported).toBe(true)
    expect(formatsFor('deck')[0]).toBe('pptx')
  })
})

describe('filenames', () => {
  it('{issuer}_{number}_v{n}_{short revision ID}.{ext}', () => {
    const name = exportFilename(completeInvoice(), 'pdf', 2, 'rev-002')
    expect(name).toBe(`halden-rowe-studio_HRS-2026-0142_v2_${shortRevisionId('rev-002')}.pdf`)
    expect(shortRevisionId('rev-002')).toMatch(/^[0-9a-f]{4}$/)
    expect(shortRevisionId('rev-002')).not.toBe(shortRevisionId('rev-003'))
  })
  it('briefs use the title; long parts are capped at 40 characters, cut at a hyphen', () => {
    const brief = exportFilename(evidenceBrief(), 'docx', 1, 'rev-001')
    const [issuer, title] = brief.split('_')
    expect(issuer).toBe('brightwater-research-studio')
    expect(title.length).toBeLessThanOrEqual(FILENAME_PART_MAX)
    expect(title.startsWith('reducing-first-month')).toBe(true)
    expect(title.endsWith('-')).toBe(false)
    const long = exportFilename(brandLongNameInvoice(), 'pdf', 1, 'rev-001').split('_')[0]
    expect(long.length).toBeLessThanOrEqual(FILENAME_PART_MAX)
    expect(FORMAT_FILE.docx.extension).toBe('docx')
  })
})

describe('export jobs', () => {
  it('fixture 7: exporting v1 while v2 is current produces v1’s file', async () => {
    const { env, store, outputId, v1 } = setup()
    const { store: s2, revision: v2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    const started = startExport(emptyExports(), env, s2, { outputId, revisionId: v1.revisionId, format: 'pdf' })
    expect(started.record).toMatchObject({ status: 'pending', revisionId: v1.revisionId, draft: false })
    const settled = await run(started.state, env, started.job!)
    const rec = getExport(settled, started.record.exportId)
    if (rec.status !== 'succeeded') throw new Error(`expected success, got ${rec.status}`)
    expect(rec.artifact.filename).toContain('_v1_')
    expect(rec.artifact.mimeType).toBe('application/pdf')
    const pdf = await readPdf(files.get(rec.artifact.filename)!)
    const all = squash(pdf.pages.map((p) => p.text).join(''))
    expect(all).toContain(squash('Net 30. Bank transfer'))
    expect(all).not.toContain('Net15.')
    expect(v2.revisionId).not.toBe(v1.revisionId)
  })

  it('later edits never retarget a pending job', async () => {
    const { env, store, outputId, v1 } = setup()
    const started = startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format: 'pdf' })
    // The document moves on while the job is pending.
    saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    expect(started.job!.snapshot).toBe(v1.snapshot)
    expect(Object.isFrozen(started.job!.snapshot)).toBe(true)
    const settled = await run(started.state, env, started.job!)
    expect(getExport(settled, started.record.exportId).revisionId).toBe(v1.revisionId)
  })

  it('a second job for the same revision and format is refused while one is pending; other formats proceed', () => {
    const { env, store, outputId, v1 } = setup()
    const a = startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format: 'pdf' })
    expect(() => startExport(a.state, env, store, { outputId, revisionId: v1.revisionId, format: 'pdf' })).toThrow(ExportJobError)
    try { startExport(a.state, env, store, { outputId, revisionId: v1.revisionId, format: 'pdf' }) } catch (e) { expect((e as ExportJobError).code).toBe('duplicate-pending') }
    expect(startExport(a.state, env, store, { outputId, revisionId: v1.revisionId, format: 'docx' }).record.status).toBe('pending')
  })

  it('a draft needs the warning confirmed, and the record says draft', () => {
    const { env, store, outputId, v1 } = setup(incompleteInvoice())
    expect(() => startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format: 'pdf' })).toThrow(/draft/)
    const ok = startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format: 'pdf', confirmDraft: true })
    expect(ok.record).toMatchObject({ status: 'pending', draft: true })
  })

  it('the empty document is refused before rendering, with its reason', () => {
    const empty = { ...completeInvoice(), fields: {}, fieldOrder: [], blocks: [] }
    const { env, store, outputId, v1 } = setup(empty)
    const r = startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format: 'pdf', confirmDraft: true })
    expect(r.job).toBeNull()
    expect(r.record).toMatchObject({ status: 'failed', error: { code: 'validation-blocked', message: 'This invoice has no fields and no content blocks, so there is nothing to export.' } })
    expect(r.state.events.map((e) => e.type)).toEqual(['exportFailed'])
  })

  it('fixture 9: PDF succeeds, Word fails (forced), PowerPoint unsupported — no blanket success; retry keeps the revision', async () => {
    const { env, store, outputId, v1 } = setup()
    let state = emptyExports()
    const pdf = startExport(state, env, store, { outputId, revisionId: v1.revisionId, format: 'pdf' })
    state = await run(pdf.state, env, pdf.job!)
    const docx = startExport(state, env, store, { outputId, revisionId: v1.revisionId, format: 'docx' })
    state = await run(docx.state, env, docx.job!, true)
    const pptx = startExport(state, env, store, { outputId, revisionId: v1.revisionId, format: 'pptx' })
    state = pptx.state
    expect(state.records.map((r) => [r.format, r.status])).toEqual([['pdf', 'succeeded'], ['docx', 'failed'], ['pptx', 'unsupported']])
    const failed = getExport(state, docx.record.exportId)
    expect(failed.status === 'failed' && failed.error).toEqual({ code: 'renderer-failed', message: FORCED_FAILURE_MESSAGE })
    const unsupported = getExport(state, pptx.record.exportId)
    expect(unsupported.status === 'unsupported' && unsupported.error.message).toBe('Invoices and briefs have no slide format.')
    // The PDF stays usable.
    const ok = getExport(state, pdf.record.exportId)
    expect(ok.status === 'succeeded' && files.get(ok.artifact.filename)!.byteLength).toBeGreaterThan(1000)
    // Retry: a new record, same revision and format; this time the renderer is not forced to fail.
    const retry = startExport(state, env, store, retryRequest(state, docx.record.exportId))
    expect(retry.record).toMatchObject({ revisionId: v1.revisionId, format: 'docx', retryOf: docx.record.exportId })
    state = await run(retry.state, env, retry.job!)
    const after = getExport(state, retry.record.exportId)
    expect(after.status).toBe('succeeded')
    expect(after.status === 'succeeded' && after.artifact.mimeType).toBe(FORMAT_FILE.docx.mimeType)
    expect(state.events.map((e) => e.type)).toEqual(['exportStarted', 'exportSucceeded', 'exportStarted', 'exportFailed', 'exportStarted', 'exportSucceeded'])
    expect(() => retryRequest(state, pdf.record.exportId)).toThrow(/only a failed export/)
  })

  it('a deck exports to PowerPoint and PDF from its own frozen revision', async () => {
    const env = fixedEnv()
    const { store, outputId: briefId, revision } = createDocument(emptyStore(), env, evidenceBrief(), { outputId: 'out-brief' })
    const d = deriveDeckRevision(store, env, briefId, revision.revisionId)
    let state = emptyExports()
    for (const format of ['pptx', 'pdf'] as const) {
      const s = startExport(state, env, d.store, { outputId: d.outputId, revisionId: d.revision.revisionId, format })
      state = await run(s.state, env, s.job!)
      const rec = getExport(state, s.record.exportId)
      expect(rec.status).toBe('succeeded')
      expect(rec.status === 'succeeded' && rec.artifact.filename.endsWith(`.${format}`)).toBe(true)
    }
    expect(startExport(state, env, d.store, { outputId: d.outputId, revisionId: d.revision.revisionId, format: 'docx' }).record.status).toBe('unsupported')
  })

  it('an invalid revision is refused before rendering, with its validation messages', () => {
    const brief = evidenceBrief()
    const invalid = { ...brief, blocks: brief.blocks.map((b) => (b.type === 'chart' ? { ...b, unit: '' } : b)) }
    const { env, store, outputId, v1 } = setup(invalid)
    for (const format of ['pdf', 'docx'] as const) {
      const r = startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format, confirmDraft: true })
      expect(r.job).toBeNull()
      expect(r.record).toMatchObject({ status: 'failed', error: { code: 'validation-blocked', message: 'Chart has no unit.' } })
    }
  })

  it('characters the fonts cannot draw refuse every format with font-missing-glyph', async () => {
    const invoice = completeInvoice()
    const buyer = invoice.fields['buyer.name']
    const devanagari = { ...invoice, fields: { ...invoice.fields, 'buyer.name': { ...buyer, state: { status: 'provided' as const, value: { type: 'text' as const, text: 'कॉर्विड लेन' } } } } }
    const { env, store, outputId, v1 } = setup(devanagari)
    for (const format of ['pdf', 'docx'] as const) {
      const s = startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format })
      const rec = getExport(await run(s.state, env, s.job!), s.record.exportId)
      expect(rec.status === 'failed' && rec.error.code, format).toBe('font-missing-glyph')
      expect(rec.status === 'failed' && rec.error.message).toMatch(/cannot draw “क”/)
    }
    // A deck whose brief title the fonts cannot draw: PowerPoint and PDF both refuse.
    const brief = evidenceBrief()
    const title = brief.fields['brief.title']
    const yen = { ...brief, fields: { ...brief.fields, 'brief.title': { ...title, state: { status: 'provided' as const, value: { type: 'text' as const, text: 'Prices in ￥' } } } } }
    const e2 = fixedEnv()
    const created = createDocument(emptyStore(), e2, yen, { outputId: 'out-brief' })
    const d = deriveDeckRevision(created.store, e2, created.outputId, created.revision.revisionId)
    for (const format of ['pptx', 'pdf'] as const) {
      const s = startExport(emptyExports(), e2, d.store, { outputId: d.outputId, revisionId: d.revision.revisionId, format })
      const rec = getExport(await run(s.state, e2, s.job!), s.record.exportId)
      expect(rec.status === 'failed' && rec.error.code, format).toBe('font-missing-glyph')
    }
  })

  it('a block taller than a page refuses the export with the engine’s message', async () => {
    const brief = evidenceBrief()
    const huge = { ...brief, blocks: brief.blocks.map((b) => (b.id === 'blk-summary' && b.type === 'paragraph' ? { ...b, runs: [{ text: 'A summary that never ends. '.repeat(400) }] } : b)) }
    const { env, store, outputId, v1 } = setup(huge)
    for (const format of ['pdf', 'docx'] as const) {
      const s = startExport(emptyExports(), env, store, { outputId, revisionId: v1.revisionId, format })
      const rec = getExport(await run(s.state, env, s.job!), s.record.exportId)
      expect(rec.status === 'failed' && rec.error.code, format).toBe('validation-blocked')
      expect(rec.status === 'failed' && rec.error.message).toMatch(/“blk-summary” needs .*pt but a page holds/)
    }
  })
})
