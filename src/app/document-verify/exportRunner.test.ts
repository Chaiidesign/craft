import { describe, expect, it } from 'vitest'

import { cancelExport, emptyExports, getExport, type ExportState } from '@/lib/documents/export/jobs'
import type { ExportResources } from '@/lib/documents/export/resources'
import { fixedEnv, text } from '@/lib/documents/fixtures/builders'
import { completeInvoice } from '@/lib/documents/fixtures/invoices'
import { createDocument, emptyStore, saveEdit } from '@/lib/documents/revisions'
import { nodeResources } from '@/lib/documents/testing/nodeResources'

import { exportStatusLabel, runExport, type ExportControls } from './exportRunner'

function controls(): ExportControls & { state: () => ExportState } {
  let state = emptyExports()
  return {
    get exports() { return state },
    readExports: () => state,
    updateExports: (change) => { state = change(state) },
    state: () => state,
  }
}

function setup() {
  const env = fixedEnv()
  const { store, outputId, revision } = createDocument(emptyStore(), env, completeInvoice(), { outputId: 'out-1' })
  return { env, store, outputId, v1: revision }
}

describe('runExport: reports follow the stored record', () => {
  it('a finished PDF announces ready and opens its preview', async () => {
    const { env, store, outputId, v1 } = setup()
    const c = controls()
    const said: string[] = []
    const previews: string[] = []
    const result = await runExport({ controls: c, env, store, req: { outputId, revisionId: v1.revisionId, format: 'pdf' }, resources: async (s) => nodeResources(s), localUrl: () => 'blob:x', announce: (m) => said.push(m), onPdfReady: (id) => previews.push(id) })
    expect('record' in result && result.record.status).toBe('succeeded')
    expect(said).toEqual(['Preparing PDF of v1…', 'PDF of v1 ready.'])
    expect(previews).toHaveLength(1)
  })

  it('cancelled while rendering: the late result announces nothing, opens no preview and makes no file', async () => {
    const { env, store, outputId, v1 } = setup()
    const c = controls()
    const said: string[] = []
    const previews: string[] = []
    let urls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const resources = async (s: Parameters<typeof nodeResources>[0]): Promise<ExportResources> => { await gate; return nodeResources(s) }
    const running = runExport({ controls: c, env, store, req: { outputId, revisionId: v1.revisionId, format: 'pdf' }, resources, localUrl: () => { urls++; return 'blob:late' }, announce: (m) => said.push(m), onPdfReady: (id) => previews.push(id) })
    const pending = c.state().records[0]
    expect(pending.status).toBe('pending')
    // The person edits the document and cancels while the render is still running.
    const { store: s2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    c.updateExports((s) => cancelExport(s, env, pending.exportId))
    release()
    const result = await running
    const rec = getExport(c.state(), pending.exportId)
    expect('record' in result && result.record).toBe(rec)
    expect(rec.status === 'failed' && rec.error.code).toBe('cancelled')
    expect(exportStatusLabel(s2, rec)).toBe('PDF of v1 cancelled — the result will be discarded when it arrives')
    expect(said).toEqual(['Preparing PDF of v1…'])
    expect(previews).toEqual([])
    expect(urls).toBe(0)
    expect(c.state().events.map((e) => e.type)).toEqual(['exportStarted', 'exportCancelled'])
  })

  it('a renderer failure announces the failure; a refusal comes back as text', async () => {
    const { env, store, outputId, v1 } = setup()
    const c = controls()
    const said: string[] = []
    await runExport({ controls: c, env, store, req: { outputId, revisionId: v1.revisionId, format: 'docx' }, resources: async (s) => nodeResources(s), localUrl: () => 'blob:x', forceFailure: 'Forced renderer failure (scenario 11 only)', announce: (m) => said.push(m) })
    expect(said.at(-1)).toBe('Word failed: Forced renderer failure (scenario 11 only)')
    c.updateExports((s) => ({ ...s, records: [...s.records, { ...s.records[0], exportId: 'exp-x', status: 'pending' }] }))
    const refused = await runExport({ controls: c, env, store, req: { outputId, revisionId: v1.revisionId, format: 'docx' }, resources: async (s) => nodeResources(s), localUrl: () => 'blob:x' })
    expect(refused).toEqual({ refusal: 'An export of this revision to docx is already in progress (exp-x).' })
  })

  it('status labels for expired and reload-cancelled records', () => {
    const { store, outputId, v1 } = setup()
    const base = { exportId: 'e', outputId, revisionId: v1.revisionId, format: 'docx' as const, draft: false }
    expect(exportStatusLabel(store, { ...base, status: 'expired', artifact: { filename: 'f.docx', mimeType: 'x', byteSize: 1 } })).toBe('Word of v1 — file not kept after reload. Export again to download.')
    expect(exportStatusLabel(store, { ...base, status: 'failed', error: { code: 'cancelled', message: 'the page was reloaded before it finished' } })).toBe('Word of v1 cancelled — the page was reloaded before it finished')
  })
})
