// Runnable checks for fixtures 6, 7, 8, 9 and 11. Each run starts from a fresh,
// deterministic store (fixed clock and IDs), performs the scenario's steps
// with the real revision and export functions, and reports what it found.
// Exports are real files, read back with pdf.js. Nothing here is simulated:
// a failing rule shows as Fail.

import { FORCED_VIEWER_FAILURE, openForViewer } from '@/components/documents/viewerOpen'
import { FORCED_FAILURE_MESSAGE, forcedRendererFailure } from '@/lib/documents/export/adapters'
import { cancelExport, CANCEL_MESSAGE, emptyExports, getExport, isCancelled, renderJob, retryRequest, settleExport, startExport, type ExportJob, type ExportState } from '@/lib/documents/export/jobs'
import type { ExportResources } from '@/lib/documents/export/resources'
import { formatFieldValue } from '@/lib/documents/display'
import { fixedEnv, text } from '@/lib/documents/fixtures/builders'
import { completeInvoice } from '@/lib/documents/fixtures/invoices'
import { SAMPLE_REVIEWER } from '@/lib/documents/fixtures/revisions'
import { evidenceBrief } from '@/lib/documents/fixtures/brief'
import { malformedSessions } from '@/lib/documents/fixtures/sessions'
import { parseSession, serializeSession, SESSION_BACKUP_KEY, SESSION_KEY, startAgain, writeSession, type KeyValueStorage, type WorkbenchSession } from '@/lib/documents/session'
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
  deriveDeckRevision,
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
async function settle(state: ExportState, env: DocumentEnv, job: ExportJob, deps: ExportDeps, files: Map<string, Uint8Array>, forceFailure?: string) {
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
    if (rec.status !== 'succeeded') return { label: 'Export of the selected revision', result: 'fail', detail: rec.status === 'failed' || rec.status === 'unsupported' ? rec.error.message : `Export is ${rec.status}.` }
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
  state = await settle(docx.state, env, docx.job!, deps, files, FORCED_FAILURE_MESSAGE)
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

/** In-memory stand-ins for browser storage: a working one, a full one and a blocked one. */
class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>()
  getItem(k: string) { return this.items.get(k) ?? null }
  setItem(k: string, v: string) { this.items.set(k, v) }
  removeItem(k: string) { this.items.delete(k) }
}
class FullStorage extends MemoryStorage {
  setItem() { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e }
}

/** Fixture 11: renderer vs viewer errors, cancellation with a late result, duplicate filenames, malformed sessions. */
export async function runErrorsAndRecovery(deps: ExportDeps): Promise<ScenarioCheck[]> {
  const { env, store, outputId, v1 } = start()
  const files = new Map<string, Uint8Array>()
  const req = { outputId, revisionId: v1.revisionId, format: 'pdf' as const }
  const checks: ScenarioCheck[] = []

  // Renderer error: the export fails; the document and its revision are untouched; retry offered.
  const forced = forcedRendererFailure(11)
  const bad = startExport(emptyExports(), env, store, req)
  let state = await settle(bad.state, env, bad.job!, deps, files, forced)
  const failed = getExport(state, bad.record.exportId)
  const retry = startExport(state, env, store, retryRequest(state, bad.record.exportId))
  state = await settle(retry.state, env, retry.job!, deps, files)
  const retried = getExport(state, retry.record.exportId)
  checks.push({
    label: 'Renderer error: the revision survives, retry offered',
    result: verdict(failed.status === 'failed' && failed.error.code === 'renderer-failed' && failed.error.message === forced && currentRevision(store, outputId) === v1 && history(store, outputId).length === 1 && retried.status === 'succeeded' && retried.revisionId === v1.revisionId),
    detail: `${failed.status === 'failed' ? failed.error.message : failed.status}; still v1 with ${history(store, outputId).length} revision. Retry ${retried.exportId}: ${retried.status}, ${retried.revisionId}.`,
  })

  // Viewer error: the file exists and stays downloadable; only showing it failed.
  if (retried.status === 'succeeded') {
    const bytes = files.get(retried.artifact.filename)!
    let viewerError = ''
    try { await openForViewer(bytes, deps.pdfPageTexts, FORCED_VIEWER_FAILURE) } catch (e) { viewerError = e instanceof Error ? e.message : String(e) }
    const after = getExport(state, retry.record.exportId)
    const pages = await openForViewer(bytes, deps.pdfPageTexts)
    checks.push({
      label: 'Viewer error: the file is still there and the viewer can try again',
      result: verdict(viewerError === FORCED_VIEWER_FAILURE && after.status === 'succeeded' && after.artifact.byteSize === bytes.byteLength && pages.length > 0),
      detail: `Viewer: “${viewerError}”. The record is still ${after.status} (${bytes.byteLength} bytes, download intact); trying the viewer again opens ${pages.length} page${pages.length === 1 ? '' : 's'}.`,
    })
  } else {
    checks.push({ label: 'Viewer error: the file is still there and the viewer can try again', result: 'fail', detail: 'No PDF to view.' })
  }

  // Cancel: the late result never overwrites anything, even though the document moved on to v2.
  const job = startExport(state, env, store, req)
  const { store: s2, revision: v2 } = saveEdit(store, env, outputId, v1.revisionId, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
  const cancelled = cancelExport(job.state, env, job.record.exportId)
  const outcome = await renderJob(job.job!, { resources: await deps.resources(job.job!.snapshot), title: 'Scenario export', subject: 'late', createdAt: env.now() })
  let lateUrls = 0
  const late = settleExport(cancelled, env, job.job!, outcome, () => { lateUrls++; return 'memory:late' })
  const lateRec = getExport(late, job.record.exportId)
  checks.push({
    label: 'Cancel: the late result is discarded',
    result: verdict(outcome.ok && late === cancelled && isCancelled(lateRec) && lateUrls === 0 && !late.events.slice(cancelled.events.length).length && currentRevision(s2, outputId) === v2 && retryRequest(late, job.record.exportId).revisionId === v1.revisionId),
    detail: `The render finished (${outcome.ok ? `${outcome.bytes.byteLength} bytes` : 'failed'}) after the cancel; the record stays “cancelled — ${CANCEL_MESSAGE.user}”, no file or event was made, v2 is current and untouched, and a retry would export v1.`,
  })
  state = late

  // Duplicate filenames: identity comes from the record, never the name.
  const twice = [startExport(emptyExports(), env, s2, req)]
  let dup = await settle(twice[0].state, env, twice[0].job!, deps, files)
  twice.push(startExport(dup, env, s2, req))
  dup = await settle(twice[1].state, env, twice[1].job!, deps, files)
  const [a, b] = twice.map((t) => getExport(dup, t.record.exportId))
  const sameName = a.status === 'succeeded' && b.status === 'succeeded' && a.artifact.filename === b.artifact.filename
  checks.push({
    label: 'Same revision exported twice: same filename, separate records',
    result: verdict(sameName && a.exportId !== b.exportId && a.revisionId === v1.revisionId && b.revisionId === v1.revisionId),
    detail: a.status === 'succeeded' && b.status === 'succeeded' ? `${a.exportId} and ${b.exportId} are both ${a.artifact.filename}; each record names its own export ID and revision ${a.revisionId}.` : 'An export failed.',
  })
  const briefDoc = createDocument(s2, env, evidenceBrief(), { outputId: 'out-scenario-brief' })
  const deck = deriveDeckRevision(briefDoc.store, env, briefDoc.outputId, briefDoc.revision.revisionId)
  const bx = startExport(emptyExports(), env, deck.store, { outputId: briefDoc.outputId, revisionId: briefDoc.revision.revisionId, format: 'pdf' })
  let pair = await settle(bx.state, env, bx.job!, deps, files)
  const dx = startExport(pair, env, deck.store, { outputId: deck.outputId, revisionId: deck.revision.revisionId, format: 'pdf' })
  pair = await settle(dx.state, env, dx.job!, deps, files)
  const br = getExport(pair, bx.record.exportId), dr = getExport(pair, dx.record.exportId)
  const stem = (r: ExportRecord) => (r.status === 'succeeded' ? r.artifact.filename.replace(/_[0-9a-f]{4}\.pdf$/, '') : '')
  checks.push({
    label: 'Brief and deck share a filename base; records keep them apart',
    result: verdict(stem(br) !== '' && stem(br) === stem(dr) && br.outputId === briefDoc.outputId && dr.outputId === deck.outputId && getRevision(deck.store, dr.revisionId).snapshot.kind === 'deck' && getRevision(deck.store, br.revisionId).snapshot.kind === 'brief'),
    detail: br.status === 'succeeded' && dr.status === 'succeeded' ? `${br.artifact.filename} (brief ${br.revisionId}) and ${dr.artifact.filename} (deck ${dr.revisionId}) differ only in the short ID; the deck's record names its own document and revision.` : 'An export failed.',
  })

  // Sessions: a round trip keeps records without files; each malformed kind is refused with its reason.
  const finished: ExportState = { records: [...state.records, ...pair.records], events: [...state.events, ...pair.events] }
  const pendingJob = startExport(finished, env, deck.store, { outputId: deck.outputId, revisionId: deck.revision.revisionId, format: 'pptx' })
  const session: WorkbenchSession = { store: markApproved(deck.store, env, v1.revisionId, SAMPLE_REVIEWER), exports: pendingJob.state, deckId: deck.outputId }
  const raw = serializeSession(session)
  const loaded = parseSession(raw, env)
  const reloaded = loaded.status === 'loaded' ? loaded.session.exports.records : []
  const expired = reloaded.filter((r) => r.status === 'expired').length
  const interrupted = reloaded.find((r) => r.exportId === pendingJob.record.exportId)
  checks.push({
    label: 'Reload: revisions kept, files not; an unfinished export comes back cancelled',
    result: verdict(loaded.status === 'loaded' && loaded.session.store.revisions.size === deck.store.revisions.size && expired === session.exports.records.filter((r) => r.status === 'succeeded').length && interrupted?.status === 'failed' && interrupted.error.message === CANCEL_MESSAGE.reload && !raw.includes('memory:')),
    detail: loaded.status === 'loaded' ? `${loaded.session.store.revisions.size} revisions back; ${expired} finished exports now “file not kept after reload”; the PowerPoint export that was running is “cancelled — ${CANCEL_MESSAGE.reload}”.` : `Did not load: ${loaded.status === 'malformed' ? loaded.reason : loaded.status}.`,
  })
  for (const m of malformedSessions(raw)) {
    const got = parseSession(m.raw, env)
    checks.push({
      label: `Malformed session — ${m.label}`,
      result: verdict(got.status === 'malformed' && got.reason === m.reason && got.raw === m.raw),
      detail: got.status === 'malformed' ? `“The saved workbench session couldn’t be loaded: ${got.reason}.” The unreadable text is kept for download.` : `Loaded as ${got.status}.`,
    })
  }
  const kept = new MemoryStorage()
  kept.setItem(SESSION_KEY, malformedSessions(raw)[0].raw)
  const again = startAgain(kept, kept.getItem(SESSION_KEY)!)
  checks.push({
    label: 'Start again keeps a backup first',
    result: verdict(again.ok && kept.getItem(SESSION_BACKUP_KEY) === malformedSessions(raw)[0].raw && kept.getItem(SESSION_KEY) === null),
    detail: `The unreadable text is under ${SESSION_BACKUP_KEY}; ${SESSION_KEY} is cleared so the sample fixtures load.`,
  })
  const full = writeSession(new FullStorage(), session)
  checks.push({
    label: 'A save that fails is reported, not ignored',
    result: verdict(!full.ok && full.reason === 'The quota has been exceeded.'),
    detail: full.ok ? 'The save claimed success.' : `“Changes can’t be saved in this browser (${full.reason.replace(/\.$/, '')}). They will be lost on reload.”`,
  })
  return checks
}

