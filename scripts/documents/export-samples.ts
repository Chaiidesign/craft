// Writes real sample exports of the fixture documents to docs/documents/samples/,
// through the same job controller and renderers the workbench uses.
//
//   npx vite-node scripts/documents/export-samples.ts
//
// Fictional sample data only. Files carry the time they were made (PDF
// creation date, Office core properties), so reruns are not byte-identical.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { emptyExports, renderJob, settleExport, startExport, type ExportState } from '../../src/lib/documents/export/jobs'
import { evidenceBrief } from '../../src/lib/documents/fixtures/brief'
import { fixedEnv } from '../../src/lib/documents/fixtures/builders'
import { completeInvoice, incompleteInvoice, longInvoice } from '../../src/lib/documents/fixtures/invoices'
import type { DocumentSnapshot, ExportFormat } from '../../src/lib/documents/model'
import { createDocument, deriveDeckRevision, emptyStore } from '../../src/lib/documents/revisions'
import { nodeResources } from '../../src/lib/documents/testing/nodeResources'

const OUT = fileURLToPath(new URL('../../docs/documents/samples/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const env = fixedEnv()
let store = emptyStore()
const docs: { outputId: string; revisionId: string; formats: ExportFormat[] }[] = []
const add = (id: string, snapshot: DocumentSnapshot, formats: ExportFormat[]) => {
  const created = createDocument(store, env, snapshot, { outputId: `out-${id}` })
  store = created.store
  docs.push({ outputId: created.outputId, revisionId: created.revision.revisionId, formats })
  return created
}
add('invoice-complete', completeInvoice(), ['pdf', 'docx'])
add('invoice-long', longInvoice(), ['pdf', 'docx'])
add('invoice-missing', incompleteInvoice(), ['pdf', 'docx'])
const brief = add('brief-evidence', evidenceBrief(), ['pdf', 'docx'])
const deck = deriveDeckRevision(store, env, brief.outputId, brief.revision.revisionId)
store = deck.store
docs.push({ outputId: deck.outputId, revisionId: deck.revision.revisionId, formats: ['pptx', 'pdf'] })

let state: ExportState = emptyExports()
for (const d of docs) {
  for (const format of d.formats) {
    // Draft documents are exported deliberately, as the workbench's "Export draft" does.
    const started = startExport(state, env, store, { outputId: d.outputId, revisionId: d.revisionId, format, confirmDraft: true })
    state = started.state
    if (!started.job) throw new Error(`${d.outputId} ${format}: ${started.record.status}`)
    const job = started.job
    const outcome = await renderJob(job, { resources: nodeResources(job.snapshot), title: job.filename, subject: `Revision ${job.revisionId} (v${job.versionNumber}) — sample export, fictional data`, createdAt: new Date().toISOString() })
    state = settleExport(state, env, job, outcome, (bytes, _m, filename) => { writeFileSync(join(OUT, filename), bytes); return join('docs/documents/samples', filename) })
    const rec = state.records.find((r) => r.exportId === job.exportId)!
    console.log(rec.status === 'succeeded' ? `${rec.artifact.filename}  ${rec.artifact.byteSize} bytes${rec.draft ? '  (draft)' : ''}` : `${job.filename}  ${rec.status}: ${rec.status === 'failed' ? rec.error.message : ''}`)
    if (rec.status !== 'succeeded') process.exitCode = 1
  }
}
