// What Souvenir's earlier turn says when it goes back to the model as history.
// Shared by /output-verify and the evals, so a follow-up in an eval sees the
// conversation exactly as the app would send it.

import { FORMAT_LABEL } from '../documents/export/capabilities'
import { INVOICE_FIELDS } from '../documents/invoice'
import { notProvided } from '../documents/missing'
import type { DocumentSnapshot } from '../documents/model'
import { getRevision, type RevisionStore } from '../documents/revisions'
import { templateFor } from '../documents/templates/invoice'
import type { Made } from './agent/loop'
import { LANE_LABELS } from './lanes'

/** "Quote Q-2041", or just "Quote" while the number is missing. */
export function documentName(snapshot: DocumentSnapshot): string {
  const name = snapshot.kind === 'brief' ? 'Brief' : snapshot.kind === 'deck' ? 'Deck' : templateFor(snapshot.kind).title
  const n = snapshot.fields[INVOICE_FIELDS.number]?.state
  return n?.status === 'provided' && n.value.type === 'text' ? `${name} ${n.value.text}` : name
}

export type MadeFile = { fileName: string; rows: number }

export function madeText(m: Made, revisions: RevisionStore, file?: MadeFile, changeSummary?: string[]): string {
  switch (m.kind) {
    case 'reply':
      return m.text
    case 'file':
      return file ? `I made the file “${file.fileName}” (${file.rows} rows).` : 'I tried to make a file, but it couldn’t be built.'
    case 'upload-change':
      return file ? `I changed the uploaded file and made “${file.fileName}”. ${changeSummary?.join(' ') ?? ''}` : 'I tried to change the uploaded file, but it couldn’t be done.'
    case 'chart':
      return `${m.lead}\n(Chart: ${m.chart.title}: ${m.chart.points.map((p) => `${p.label} ${p.display}`).join(', ')})`
    case 'format-options':
      return m.message
    case 'document': {
      const snapshot = getRevision(revisions, m.revisionId).snapshot
      const missing = notProvided(snapshot)
      return `${m.created ? 'I made' : 'I changed'} the ${documentName(snapshot)} (version ${m.version}${m.created ? '' : `: ${m.changeSummary}`}).${missing.length ? ` Still missing: ${missing.join(', ')}.` : ''}${m.followUp ? ` ${m.followUp}` : ''}`
    }
    case 'export':
      return `Here is version ${m.version} as ${FORMAT_LABEL[m.format]}.`
    case 'coming-later':
      return `That would be a ${m.lane === 'export' ? 'new export' : LANE_LABELS[m.lane].toLowerCase()}: ${m.summary}`
    case 'error':
      return m.message
  }
}
