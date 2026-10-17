// One turn on /output-verify: the model reads the guide, asks the store, and
// ends with one thing to show (D-80). Bounded: at most MAX_CALLS model calls.
// Every structured answer is checked against its schema, and a chat reply is
// checked for store numbers and system words; on a failed check the model gets
// one more try with the error, then the person gets an honest error (build-loop
// §5). The model is injected, so tests run offline.

import type Anthropic from '@anthropic-ai/sdk'

import { capability } from '../../documents/export/capabilities'
import { documentView } from '../../documents/generation/view'
import { isCommercial } from '../../documents/invoice'
import type { CommercialKind, DocumentEnv, ExportFormat } from '../../documents/model'
import { currentRevision, emptyStore, getRevision, history, versionNumber, type RevisionStore } from '../../documents/revisions'
import { buildChart, type Chart, type ChartSpec } from '../chart'
import type { Store } from '../fixtures/stores'
import type { FileSpec } from '../files/datasets'
import type { UploadChange } from '../files/upload'
import type { Lane } from '../lanes'
import { checkNumbers, type Claim } from '../numbers'
import { askStore, StoreQuerySchema } from '../storeTool'
import { kindName, makeStrictDocument, updateStrictDocument, type StrictDocumentInput, type UpdateDocumentInput } from '../strict'
import { findForbiddenWords } from '../words'
import { GuideInputSchema, progressLabel, TERMINAL, toolDefs } from './tools'

export const MAX_CALLS = 6

export type ModelCall = (params: {
  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
}) => Promise<Anthropic.Message>

export type Turn = { role: 'person' | 'souvenir'; text: string }

export type UploadInfo = { fileName: string; format: 'csv' | 'xlsx'; sheet: string; columns: string[]; rowCount: number; sampleRows: unknown[][] }

export type Made =
  | { kind: 'reply'; text: string; usedStore: boolean; claims: Claim[] }
  | { kind: 'file'; spec: FileSpec; note?: string }
  | { kind: 'upload-change'; changes: UploadChange[]; note?: string }
  | { kind: 'chart'; spec: ChartSpec; chart: Chart; lead: string }
  | { kind: 'format-options'; thing: Lane; requestedFormat: string; offered: string[]; message: string }
  | { kind: 'document'; docKind: CommercialKind; outputId: string; revisionId: string; version: number; changeSummary: string; followUp?: string; created: boolean }
  | { kind: 'export'; docKind: CommercialKind; outputId: string; revisionId: string; version: number; format: ExportFormat }
  | { kind: 'coming-later'; lane: Lane | 'export'; summary: string }
  | { kind: 'error'; message: string }

export type LoopEvent = { type: 'progress'; label: string } | { type: 'tool'; name: string }

export type TurnInput = {
  store: Store
  history: Turn[]
  request: string
  upload?: UploadInfo
  prompt: string
  guides: Record<Lane, string>
  /** formats.json, parsed; its `kinds` entry for a kind goes back with that kind's guide. */
  formats: { kinds: Record<string, unknown>; formats?: Record<string, { label: string }> }
  call: ModelCall
  onEvent?: (e: LoopEvent) => void
  today: string
  /** Documents made earlier in this conversation, and which one is current (the one a follow-up changes). */
  documents?: { revisions: RevisionStore; current: string | null }
  /** IDs and clock for new versions; random IDs by default, so versions from different turns never collide. */
  env?: DocumentEnv
}

export type TurnResult = { made: Made; calls: number; toolsUsed: string[]; storeAnswers: unknown[]; revisions?: RevisionStore }

const defaultEnv: DocumentEnv = { now: () => new Date().toISOString(), nextId: (p) => `${p}-${globalThis.crypto.randomUUID().slice(0, 8)}` }

/** Sample-mode facts the prompt can't know: which store, its currency and "today" (D-81). */
export function contextBlock(store: Store, today: string, upload?: UploadInfo, documents?: TurnInput['documents']): string {
  const lines = [
    `Connected store: ${store.name} (${store.country}), currency ${store.currency}. This is sample data from a fictional store.`,
    `Today is ${today}. The store's data is complete up to and including today, so a period that ends today is final. Use ask_store for any store figure; quote its numbers as given and never calculate your own.`,
  ]
  if (upload) lines.push(`The person uploaded a file. Here is what it holds (header, a few sample rows and the row count): ${JSON.stringify(upload)}`)
  const doc = documents?.current ? currentRevision(documents.revisions, documents.current) : null
  if (doc && isCommercial(doc.snapshot)) {
    const version = versionNumber(documents!.revisions, doc.revisionId)
    lines.push(`Made earlier in this conversation: a ${kindName(doc.snapshot.kind)}, now at version ${version}. A change to it is a new version (update_document); “make it a PDF” exports it (export_version). Here is the current version, with the digest of every field and line:\n${JSON.stringify(documentView(doc.snapshot))}`)
  }
  return lines.join('\n')
}

const text = (m: Anthropic.Message) => m.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n').trim()

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const tools = toolDefs() as Anthropic.Tool[]
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: input.prompt },
    { type: 'text', text: contextBlock(input.store, input.today, input.upload, input.documents) },
    // A chat reply is the fallback for every request, so its guide always applies:
    // it is sent with every turn rather than left to a read_guide call (D-85).
    { type: 'text', text: `The guide for chat replies, which applies whenever you answer in chat:\n\n${input.guides.chat_reply}` },
  ]
  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((t) => ({ role: t.role === 'person' ? ('user' as const) : ('assistant' as const), content: t.text })),
    { role: 'user', content: input.request },
  ]
  const toolsUsed: string[] = []
  const storeAnswers: unknown[] = []
  /** Kinds whose guide has been read this turn; nothing is made before its guide is read (D-85). */
  const guidesRead = new Set<string>(['chat_reply'])
  let retried = false
  let calls = 0
  const docs = input.documents ?? { revisions: emptyStore(), current: null }
  const currentDoc = docs.current ? currentRevision(docs.revisions, docs.current) : null
  const currentNoun = currentDoc && isCommercial(currentDoc.snapshot) ? kindName(currentDoc.snapshot.kind) : undefined
  const sourceText = [...input.history.filter((h) => h.role === 'person').map((h) => h.text), input.request].join('\n')

  while (calls < MAX_CALLS) {
    calls++
    const reply = await input.call({ system, messages, tools })
    const uses = reply.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')

    if (uses.length === 0) {
      // A chat reply. Check it before it is shown.
      const body = text(reply)
      if (!body) return { made: { kind: 'error', message: 'Souvenir didn’t answer. Try asking again.' }, calls, toolsUsed, storeAnswers }
      const numbers = checkNumbers(body, [...storeAnswers, input.request, ...input.history.map((h) => h.text)])
      const words = findForbiddenWords(body)
      if (numbers.ok && words.length === 0) return { made: { kind: 'reply', text: body, usedStore: toolsUsed.includes('ask_store'), claims: numbers.claims }, calls, toolsUsed, storeAnswers }
      if (retried) {
        return { made: { kind: 'error', message: numbers.ok ? 'Souvenir’s answer used words meant for its own workings, so it wasn’t shown. Try asking again.' : 'Souvenir’s answer had numbers that don’t match your store data, so it wasn’t shown. Try asking again.' }, calls, toolsUsed, storeAnswers }
      }
      retried = true
      const problems = [
        ...(numbers.ok ? [] : [`These figures don't match any store answer: ${numbers.unmatched.map((c) => c.text).join(', ')}. Use ask_store and quote its numbers exactly, or leave the figure out.`]),
        ...(words.length ? [`Don't mention ${[...new Set(words.map((w) => w.word))].join(', ')} to the person.`] : []),
      ]
      messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: `Your reply wasn't shown. ${problems.join(' ')} Answer again.` })
      continue
    }

    messages.push({ role: 'assistant', content: reply.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of uses) {
      toolsUsed.push(use.name)
      input.onEvent?.({ type: 'tool', name: use.name })
      input.onEvent?.({ type: 'progress', label: progressLabel(use.name, use.input, currentNoun) })

      if (use.name === 'read_guide') {
        const g = GuideInputSchema.safeParse(use.input)
        if (g.success) guidesRead.add(g.data.type)
        results.push(
          g.success
            ? { type: 'tool_result', tool_use_id: use.id, content: `${input.guides[g.data.type]}\n\nFormats for this kind (formats.json):\n${JSON.stringify(input.formats.kinds[g.data.type], null, 1)}` }
            : { type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Unknown guide type. Use one of: ${Object.keys(input.guides).join(', ')}.` },
        )
        continue
      }
      if (use.name === 'ask_store') {
        const q = StoreQuerySchema.safeParse(use.input)
        if (!q.success) {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `That isn't a question the store can answer: ${q.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` })
          continue
        }
        const answer = askStore(input.store, q.data, input.today)
        storeAnswers.push(answer)
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(answer) })
        continue
      }
      const terminal = TERMINAL[use.name]
      if (!terminal) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `There is no action called ${use.name}.` })
        continue
      }
      const needsGuide = terminal.lane === 'format_not_supported' || terminal.lane === 'export' || terminal.lane === 'update' ? null : terminal.lane
      if (needsGuide && !guidesRead.has(needsGuide)) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Read the guide for ${needsGuide} with read_guide before you make it, then call ${use.name} again.` })
        continue
      }
      const parsed = terminal.schema.safeParse(use.input)
      if (!parsed.success) {
        if (retried) return { made: { kind: 'error', message: 'Souvenir couldn’t put this together correctly. Nothing was changed. Try asking again.' }, calls, toolsUsed, storeAnswers }
        retried = true
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Not accepted: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}. Fix every problem and call ${use.name} again.` })
        continue
      }
      if (use.name === 'create_strict_document' || use.name === 'update_document' || use.name === 'export_version') {
        const outcome = documentAction(use.name, parsed.data, { ...input, documents: docs }, sourceText)
        if ('retry' in outcome) {
          if (retried) return { made: { kind: 'error', message: 'Souvenir couldn’t put this together correctly. Nothing was changed. Try asking again.' }, calls, toolsUsed, storeAnswers }
          retried = true
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Not accepted, nothing was saved: ${outcome.retry.join(' ')} Fix every problem and call ${use.name} again, or answer in chat if it can’t be made.` })
          continue
        }
        return { made: outcome.made, calls, toolsUsed, storeAnswers, ...(outcome.revisions ? { revisions: outcome.revisions } : {}) }
      }
      let made = toMade(use.name, parsed.data, input.upload, input.formats.formats ?? {})
      if (use.name === 'show_chart') {
        const spec = parsed.data as ChartSpec
        const chart = buildChart(input.store, spec, input.today)
        storeAnswers.push(chart.answer)
        const numbers = checkNumbers(spec.lead, [chart.answer, ...storeAnswers, input.request])
        made = numbers.ok && findForbiddenWords(spec.lead).length === 0
          ? { kind: 'chart', spec, chart, lead: spec.lead }
          : { kind: 'error', message: numbers.ok ? `Don't mention ${findForbiddenWords(spec.lead).map((w) => w.word).join(', ')} to the person. Call show_chart again.` : `These figures in the lead don't match the chart: ${numbers.unmatched.map((c) => c.text).join(', ')}. Use ask_store first if you need a figure, quote it exactly, and call show_chart again.` }
        if (made.kind === 'error' && retried) made = { kind: 'error', message: 'Souvenir’s chart came with numbers that don’t match your store data, so it wasn’t shown. Try asking again.' }
      }
      if (made.kind === 'error' && !retried) {
        retried = true
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: made.message })
        continue
      }
      return { made, calls, toolsUsed, storeAnswers }
    }
    messages.push({ role: 'user', content: results })
  }
  return { made: { kind: 'error', message: 'This took too many steps, so Souvenir stopped. Try asking in a simpler way.' }, calls, toolsUsed, storeAnswers }
}

/** Makes, changes or exports a strict document. Problems go back to the model once (`retry`). */
function documentAction(name: string, data: unknown, input: TurnInput & { documents: NonNullable<TurnInput['documents']> }, sourceText: string): { made: Made; revisions?: RevisionStore } | { retry: string[] } {
  const ctx = { store: input.store, today: input.today, env: input.env ?? defaultEnv, sourceText, revisions: input.documents.revisions }
  const followUpOf = (f: string | undefined) => (f && findForbiddenWords(f).length === 0 ? { followUp: f } : {})
  if (name === 'create_strict_document') {
    const d = data as StrictDocumentInput
    if (d.type === 'other') return { made: { kind: 'coming-later', lane: 'strict_document', summary: d.summary ?? 'A document with exact terms.' } }
    const r = makeStrictDocument({ ...d, type: d.type }, ctx)
    if (!r.ok) return { retry: r.errors }
    return { revisions: r.revisions, made: { kind: 'document', docKind: d.type, outputId: r.outputId, revisionId: r.revisionId, version: r.version, changeSummary: r.changeSummary, created: true, ...followUpOf(d.followUp) } }
  }
  const outputId = input.documents.current
  if (!outputId) return { retry: ['Nothing has been made in this conversation that can be changed or exported. Make it first.'] }
  const current = currentRevision(input.documents.revisions, outputId)
  if (!isCommercial(current.snapshot)) return { retry: ['The last thing made isn’t a document that has versions.'] }
  const docKind = current.snapshot.kind
  if (name === 'update_document') {
    const d = data as UpdateDocumentInput
    const r = updateStrictDocument(d, outputId, ctx)
    if (!r.ok) return { retry: r.errors }
    return { revisions: r.revisions, made: { kind: 'document', docKind, outputId, revisionId: r.revisionId, version: r.version, changeSummary: r.changeSummary, created: false, ...followUpOf(d.followUp) } }
  }
  const d = data as { format: string; version?: number }
  const versions = history(input.documents.revisions, outputId)
  const revision = d.version === undefined ? current : versions[d.version - 1]
  if (!revision) return { retry: [`There is no version ${d.version}; this ${kindName(docKind)} has ${versions.length}.`] }
  const format = exportFormatOf(d.format)
  const cap = format ? capability(docKind, format) : null
  if (!format || !cap?.supported) return { retry: [`A ${kindName(docKind)} can’t be exported as ${d.format}. Offer the closest formats with show_format_options instead.`] }
  return { made: { kind: 'export', docKind, outputId, revisionId: getRevision(input.documents.revisions, revision.revisionId).revisionId, version: versionNumber(input.documents.revisions, revision.revisionId), format } }
}

/** "PDF", "pdf", "Word", ".docx" → the engine's export format; anything else is not one. */
function exportFormatOf(value: string): ExportFormat | null {
  const v = value.trim().toLowerCase().replace(/^\./, '')
  if (v === 'pdf') return 'pdf'
  if (v === 'docx' || v === 'word' || v === 'doc' || v === 'word document') return 'docx'
  if (v === 'pptx' || v === 'powerpoint' || v === 'slides') return 'pptx'
  return null
}

/** "xlsx" or "excel" → "Excel": formats are shown by their names from formats.json. */
function formatName(value: string, table: Record<string, { label: string }>): string {
  const v = value.trim().toLowerCase().replace(/^\./, '')
  const hit = Object.entries(table).find(([key, f]) => key === v || f.label.toLowerCase() === v)
  return hit ? hit[1].label : value.trim()
}

function toMade(name: string, data: unknown, upload: UploadInfo | undefined, table: Record<string, { label: string }>): Made {
  if (name === 'build_file') {
    const d = data as Partial<FileSpec> & { source: 'store' | 'upload'; changes?: UploadChange[]; note?: string }
    if (d.source === 'upload') {
      if (!upload) return { kind: 'error', message: 'No file was uploaded in this conversation, so there is nothing to change. Make the file from store data, or ask the person to upload theirs.' }
      return { kind: 'upload-change', changes: d.changes ?? [], ...(d.note ? { note: d.note } : {}) }
    }
    const spec: FileSpec = { dataset: d.dataset!, format: d.format!, ...(d.period ? { period: d.period } : {}), ...(d.status ? { status: d.status } : {}), ...(d.lowStockOnly !== undefined ? { lowStockOnly: d.lowStockOnly } : {}), ...(d.category ? { category: d.category } : {}) }
    return { kind: 'file', spec, ...(d.note ? { note: d.note } : {}) }
  }
  if (name === 'show_format_options') {
    const d = data as { thing: Lane; requestedFormat: string; offered: string[]; message: string }
    return { kind: 'format-options', ...d, requestedFormat: formatName(d.requestedFormat, table), offered: [...new Set(d.offered.map((o) => formatName(o, table)))] }
  }
  const lane = TERMINAL[name].lane as Lane | 'export'
  return { kind: 'coming-later', lane, summary: (data as { summary: string }).summary }
}
