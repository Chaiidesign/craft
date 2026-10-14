// Runnable checks for fixtures 6, 7, 8 and 9. Each run starts from a fresh,
// deterministic store (fixed clock and IDs), performs the scenario's steps
// with the real revision and export functions, and reports what it found.
// Exports are real files, read back with pdf.js. Nothing here is simulated:
// a failing rule shows as Fail.

import { FORCED_FAILURE_MESSAGE } from '@/lib/documents/export/adapters'
import { emptyExports, getExport, renderJob, retryRequest, settleExport, startExport, type ExportJob, type ExportState } from '@/lib/documents/export/jobs'
import type { ExportResources } from '@/lib/documents/export/resources'
import { formatFieldValue } from '@/lib/documents/display'
import { fixedEnv, text } from '@/lib/documents/fixtures/builders'
import { completeInvoice } from '@/lib/documents/fixtures/invoices'
import { SAMPLE_REVIEWER } from '@/lib/documents/fixtures/revisions'
import { computeInvoiceTotals } from '@/lib/documents/invoice'
import type { DocumentEnv, DocumentSnapshot, ExportRecord, InvoiceSnapshot } from '@/lib/documents/model'
import { formatMoney } from '@/lib/documents/money'
import {
  applyBoundedEdit,
  approvalLabel,
  approvalOf,
  compareSnapshots,
  createDocument,
  currentRevision,
  emptyStore,
  getRevision,
  history,
  markApproved,
  restoreRevision,
  saveEdit,
  versionLabel,
} from '@/lib/documents/revisions'

export interface ScenarioCheck { label: string; result: 'pass' | 'fail' | 'deferred'; detail: string }

/** What export scenarios need from their surroundings: resources and a PDF text reader (browser or Node). */
export interface ExportDeps {
  resources: (snapshot: DocumentSnapshot) => Promise<ExportResources>
  pdfPageTexts: (bytes: Uint8Array) => Promise<string[]>
}

const squash = (t: string) => t.replace(/[\s\u00a0]+/g, '')

/** Renders a started job and settles it, keeping the bytes so the check can read the file back. */
async function settle(state: ExportState, env: DocumentEnv, job: ExportJob, deps: ExportDeps, files: Map<string, Uint8Array>, forceFailure = false) {
  const outcome = await renderJob(job, { resources: await deps.resources(job.snapshot), title: 'Scenario export', subject: `Revision ${job.revisionId}`, createdAt: env.now(), forceFailure })
  return settleExport(state, env, job, outcome, (bytes, _m, filename) => { files.set(filename, bytes); return `memory:${filename}` })
}

const verdict = (ok: boolean): ScenarioCheck['result'] => (ok ? 'pass' : 'fail')
const day = (iso: string) => iso.slice(0, 10)

function start() {
  const env = fixedEnv()
  const { store, outputId, revision } = createDocument(emptyStore(), env, completeInvoice(), { outputId: 'out-scenario' })
  return { env, store, outputId, v1: revision }
}

const totalOf = (s: InvoiceSnapshot) => {
  const t = computeInvoiceTotals(s).total
  return t.known ? formatMoney(t.money, s.locale) : 'unknown'
}

/** Fixture 6: one line-item edit; every other block unchanged; a cancelled edit changes nothing. */
export async function runBoundedEdit(): Promise<ScenarioCheck[]> {
  const { env, store, outputId, v1 } = start()
  const { store: s2, revision: v2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'line-item', blockId: 'blk-lines', itemId: 'li-2', change: { property: 'quantity', quantityMilli: 10_000 } })
  const cmp = compareSnapshots(v1.snapshot, v2.snapshot)
  const cancelled = applyBoundedEdit(v2.snapshot, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
  return [
    { label: 'Saving creates a revision', result: verdict(versionLabel(s2, v2.revisionId) === 'v2' && v2.parentRevisionId === v1.revisionId), detail: `${versionLabel(s2, v2.revisionId)} — “${v2.changeSummary}”, from v1.` },
    { label: 'Only the edited block changed', result: verdict(cmp.changedBlocks.join() === 'blk-lines' && cmp.changedFields.length === 0), detail: `Changed: ${cmp.changedBlocks.join(', ') || 'none'}. Unchanged and identical: ${cmp.unchangedBlocks.length} blocks, ${cmp.unchangedFields.length} fields.` },
    { label: 'Brand and layout unchanged', result: verdict(cmp.brandUnchanged && cmp.layoutUnchanged), detail: 'Same issuer profile and page preset in both revisions.' },
    { label: 'Derived totals follow the edit', result: verdict(totalOf(v1.snapshot as InvoiceSnapshot) !== totalOf(v2.snapshot as InvoiceSnapshot)), detail: `v1 total ${totalOf(v1.snapshot as InvoiceSnapshot)} → v2 total ${totalOf(v2.snapshot as InvoiceSnapshot)}.` },
    { label: 'A prepared edit is not applied until saved', result: verdict(currentRevision(s2, outputId) === v2 && history(s2, outputId).length === 2 && cancelled.snapshot !== v2.snapshot), detail: 'A second edit was prepared and not saved: still v2, still 2 revisions. (Cancel and Escape in the edit forms do exactly this.)' },
  ]
}

/** Fixture 7: approved v1, edited v2; the marker stays on v1 and an export of v1 is v1's file. */
export async function runApprovedThenEdited(deps: ExportDeps): Promise<ScenarioCheck[]> {
  const { env, store, outputId, v1 } = start()
  const s1 = markApproved(store, env, v1.revisionId, SAMPLE_REVIEWER)
  const { store: s2, revision: v2 } = saveEdit(s1, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
  const v1Label = approvalLabel(s2, v1.revisionId, day)
  const v2Label = approvalLabel(s2, v2.revisionId, day)
  return [
    { label: 'Marker stays on v1', result: verdict(v1Label.startsWith('Approved (sample)') && v1Label.endsWith('applies to v1 only')), detail: v1Label },
    { label: 'v2 starts unapproved', result: verdict(v2Label === 'Not approved'), detail: `v2: ${v2Label}` },
    { label: 'v1 stays selectable by its own ID', result: verdict(currentRevision(s2, outputId) === v2 && getRevision(s2, v1.revisionId).snapshot === v1.snapshot && getRevision(s2, v1.revisionId).snapshot.fields['payment.terms'] !== v2.snapshot.fields['payment.terms'] && approvalOf(s2, v1.revisionId) !== null), detail: `With v2 current, ${v1.revisionId} still returns v1’s own content and approval marker.` },
    await exportCheck(),
  ]

  async function exportCheck(): Promise<ScenarioCheck> {
    const started = startExport(emptyExports(), env, s2, { outputId, revisionId: v1.revisionId, format: 'pdf' })
    const files = new Map<string, Uint8Array>()
    const state = await settle(started.state, env, started.job!, deps, files)
    const rec = getExport(state, started.record.exportId)
    if (rec.status !== 'succeeded') return { label: 'Export of the selected revision', result: 'fail', detail: rec.status === 'pending' ? 'Still pending.' : rec.error.message }
    const text = squash((await deps.pdfPageTexts(files.get(rec.artifact.filename)!)).join(''))
    const v1Terms = v1.snapshot.fields['payment.terms']
    const v1Text = v1Terms?.state.status === 'provided' ? formatFieldValue(v1Terms.state.value, v1.snapshot.locale, v1Terms) : ''
    const ok = v1Text.length > 0 && rec.revisionId === v1.revisionId && rec.artifact.filename.includes('_v1_') && text.includes(squash(v1Text)) && !text.includes(squash('Net 15.'))
    return { label: 'Export of the selected revision', result: verdict(ok), detail: `With v2 current, exported v1: ${rec.artifact.filename}. The PDF's own text has v1's payment terms (“${v1Text}”), not v2's (“Net 15.”).` }
  }
}

/** Fixture 8: restore v1 after v3 → v4 with ancestry; later history kept; approval not inherited. */
export async function runRestore(): Promise<ScenarioCheck[]> {
  const { env, store, outputId, v1 } = start()
  const s1 = markApproved(store, env, v1.revisionId, SAMPLE_REVIEWER)
  const r2 = saveEdit(s1, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
  const r3 = saveEdit(r2.store, env, outputId, r2.revision.revisionId, { kind: 'line-item', blockId: 'blk-lines', itemId: 'li-2', change: { property: 'quantity', quantityMilli: 8_000 } })
  const { store: s4, revision: v4 } = restoreRevision(r3.store, env, outputId, v1.revisionId)
  const all = history(s4, outputId)
  return [
    { label: 'Restore creates a new revision', result: verdict(versionLabel(s4, v4.revisionId) === 'v4' && v4.revisionId !== v1.revisionId), detail: `${versionLabel(s4, v4.revisionId)} — “${v4.changeSummary}”, by ${v4.author.name}.` },
    { label: 'Ancestry recorded', result: verdict(v4.parentRevisionId === r3.revision.revisionId && v4.operation.type === 'restore' && v4.operation.fromRevisionId === v1.revisionId), detail: 'Parent v3; content restored from v1.' },
    { label: 'Content equals v1', result: verdict(JSON.stringify(v4.snapshot) === JSON.stringify(v1.snapshot)), detail: `Total ${totalOf(v4.snapshot as InvoiceSnapshot)} (v1: ${totalOf(v1.snapshot as InvoiceSnapshot)}).` },
    { label: 'Later history kept', result: verdict(all.length === 4), detail: all.map((r) => `${versionLabel(s4, r.revisionId)} ${r.changeSummary}`).join(' · ') },
    { label: 'Approval not inherited', result: verdict(approvalLabel(s4, v4.revisionId, day) === 'Not approved'), detail: `v1: ${approvalLabel(s4, v1.revisionId, day)} · v4: ${approvalLabel(s4, v4.revisionId, day)}` },
  ]
}

const statusOf = (r: ExportRecord) => r.status

/** Fixture 9: PDF succeeds, Word fails (forced), PowerPoint unsupported; retry keeps the revision. */
export async function runPartialExport(deps: ExportDeps): Promise<ScenarioCheck[]> {
  const { env, store, outputId, v1 } = start()
  const files = new Map<string, Uint8Array>()
  const req = (format: 'pdf' | 'docx' | 'pptx') => ({ outputId, revisionId: v1.revisionId, format })
  const pdf = startExport(emptyExports(), env, store, req('pdf'))
  let state = await settle(pdf.state, env, pdf.job!, deps, files)
  const docx = startExport(state, env, store, req('docx'))
  state = await settle(docx.state, env, docx.job!, deps, files, true)
  const pptx = startExport(state, env, store, req('pptx'))
  state = pptx.state
  const p = getExport(state, pdf.record.exportId), w = getExport(state, docx.record.exportId), s = getExport(state, pptx.record.exportId)
  const pdfText = p.status === 'succeeded' ? (await deps.pdfPageTexts(files.get(p.artifact.filename)!)).join('') : ''
  const retry = startExport(state, env, store, retryRequest(state, docx.record.exportId))
  state = await settle(retry.state, env, retry.job!, deps, files)
  const r = getExport(state, retry.record.exportId)
  const statuses = state.records.map((x) => `${x.format} ${statusOf(x)}`).join(' · ')
  return [
    { label: 'PDF succeeds with a real file', result: verdict(p.status === 'succeeded' && p.artifact.mimeType === 'application/pdf' && p.artifact.byteSize > 0 && squash(pdfText).includes('Totaldue')), detail: p.status === 'succeeded' ? `${p.artifact.filename}, ${p.artifact.byteSize} bytes; pdf.js reads ${squash(pdfText).length} characters of text from it.` : 'No PDF.' },
    { label: 'Word fails with its own typed error', result: verdict(w.status === 'failed' && w.error.code === 'renderer-failed' && w.error.message === FORCED_FAILURE_MESSAGE), detail: w.status === 'failed' ? `${w.error.code}: ${w.error.message}` : `Word is ${w.status}.` },
    { label: 'PowerPoint unsupported, with a reason', result: verdict(s.status === 'unsupported'), detail: s.status === 'unsupported' ? s.error.message : `PowerPoint is ${s.status}.` },
    { label: 'No blanket success', result: verdict(new Set([p.status, w.status, s.status]).size === 3), detail: 'Each format keeps its own record: ' + [p, w, s].map((x) => `${x.format} ${x.status}`).join(', ') + '.' },
    { label: 'Retry keeps the original revision', result: verdict(r.revisionId === v1.revisionId && r.format === 'docx' && r.retryOf === docx.record.exportId && r.status === 'succeeded'), detail: `Retry ${r.exportId} of ${docx.record.exportId}: ${r.revisionId}, ${r.status}. Records: ${statuses}.` },
  ]
}
