// The tool surface (D-51): generate, revise and export, callable the same way
// by the chat page, the CLI and any agent. Every call takes the revision store
// and returns the next one — there is no other store — and every result is
// plain JSON an LLM can read: IDs, versions, what is still missing, and on
// failure a code plus the gate's structured errors.

import { z } from 'zod'

import { ADAPTERS } from '../export/adapters'
import { capability, FORMAT_FILE } from '../export/capabilities'
import { exportFilename } from '../export/filename'
import type { ExportResources } from '../export/resources'
import type { DocumentEnv, DocumentSnapshot, ExportFormat, InvoiceSnapshot, RevisionAuthor, RevisionId } from '../model'
import { createDocument, getDocument, getRevision, RevisionError, saveGenerated, versionNumber, type RevisionStore } from '../revisions'
import { UNBRANDED } from '../templates/brand'
import { blankInvoiceFields, invoiceSnapshot } from '../templates/invoice'
import type { Caller } from './apply'
import { gateOperations, gateProposal, type GateResult } from './gate'
import type { GateError } from './errors'
import { proposeUntilValid } from './loop'
import type { GenerationModel, ModelErrorCode, ProposeOptions } from './model'
import { GENERATABLE_KINDS, operationsJsonSchema } from './ops'
import { documentView, type DocumentView } from './view'

// ── Inputs ───────────────────────────────────────────────────────────────────

const conversation = z.array(z.string().max(4000)).max(40).optional().describe('Earlier messages from the person, oldest first, verbatim.')
const operations = z.array(z.unknown()).max(60).describe('Operations in the generation schema; see the operations schema.')

export const GenerateInputSchema = z.union([
  z.object({ prompt: z.string().min(1).max(4000), conversation }).strict(),
  z.object({ docType: z.enum(GENERATABLE_KINDS), operations }).strict(),
])
export const ReviseInputSchema = z.union([
  z.object({ revisionId: z.string().min(1), instruction: z.string().min(1).max(4000), conversation }).strict(),
  z.object({ revisionId: z.string().min(1), operations }).strict(),
])
export const ExportInputSchema = z.object({ revisionId: z.string().min(1), format: z.enum(['pdf', 'docx', 'pptx']) }).strict()

export type GenerateInput = z.infer<typeof GenerateInputSchema>
export type ReviseInput = z.infer<typeof ReviseInputSchema>
export type ExportInput = z.infer<typeof ExportInputSchema>

// ── Results ──────────────────────────────────────────────────────────────────

export type ToolErrorCode = 'invalid-input' | 'gate-failed' | 'not-found' | 'not-current' | 'unsupported' | 'export-failed' | 'model-required' | ModelErrorCode

export interface ToolError {
  code: ToolErrorCode
  message: string
  retryable: boolean
  /** The gate's errors, for `gate-failed` and `invalid-input`. */
  errors?: GateError[]
}

export interface DocumentResult {
  outputId: string
  revisionId: RevisionId
  version: number
  title: string
  readiness: DocumentView['readiness']
  /** The saved document, with IDs and digests for the next revise. */
  document: DocumentView
  /** Keys of the values this call set or removed (`field:<id>`, `line:<id>`). */
  changed: string[]
  /** The model's one follow-up question about a missing fact, if it asked one. */
  followUp: string | null
  /** Model attempts the gate saw (0 for direct operations). */
  attempts: number
}

export interface ExportResult {
  revisionId: RevisionId
  version: number
  format: ExportFormat
  filename: string
  mimeType: string
  pageCount: number
  /** Exported with the "draft" marking because facts are still missing. */
  draft: boolean
  bytes: Uint8Array
}

export type ToolOutcome<R> = { ok: true; result: R; store: RevisionStore } | { ok: false; error: ToolError; store: RevisionStore }

export interface ToolContext {
  store: RevisionStore
  env: DocumentEnv
  /** Needed for prompt and instruction inputs; direct operations don't use a model. */
  model?: GenerationModel
  propose?: ProposeOptions
}

export const GENERATOR_AUTHOR: RevisionAuthor = { id: 'author-generator', name: 'Document generator', kind: 'system' }
export const DIRECT_AUTHOR: RevisionAuthor = { id: 'author-tool-caller', name: 'Tool caller', kind: 'system' }

const fail = <R>(store: RevisionStore, error: ToolError): ToolOutcome<R> => ({ ok: false, error, store })

function inputError<R>(store: RevisionStore, error: z.ZodError): ToolOutcome<R> {
  const errors: GateError[] = error.issues.map((i) => ({ code: 'schema', path: i.path.join('.') || '(root)', message: i.message, retryable: true }))
  return fail(store, { code: 'invalid-input', message: 'The input does not match the tool schema.', retryable: true, errors })
}

function revisionError<R>(store: RevisionStore, e: unknown): ToolOutcome<R> {
  if (e instanceof RevisionError) {
    const code: ToolErrorCode = e.code === 'not-found' ? 'not-found' : e.code === 'not-current' ? 'not-current' : 'unsupported'
    return fail(store, { code, message: e.message, retryable: code === 'not-current' })
  }
  throw e
}

/** "Added line 2 and set Payment terms": what a revision did, from its target keys. */
export function describeChanges(snapshot: DocumentSnapshot, before: DocumentSnapshot, targets: readonly string[]): string {
  const items = (s: DocumentSnapshot) => s.blocks.flatMap((b) => (b.type === 'line-items' ? b.items : []))
  const phrases = targets.map((t) => {
    if (t.startsWith('field:')) {
      const id = t.slice(6)
      const label = snapshot.fields[id]?.label ?? id
      const was = before.fields[id]?.state.status
      const now = snapshot.fields[id]?.state.status
      if (now === 'missing') return `cleared ${label}`
      if (now === 'not-applicable') return `marked ${label} not applicable`
      return was === 'provided' ? `changed ${label}` : `set ${label}`
    }
    const id = t.slice(5)
    const index = items(snapshot).findIndex((i) => i.id === id)
    const was = items(before).findIndex((i) => i.id === id)
    if (index < 0) return `removed line ${was + 1}`
    return was < 0 ? `added line ${index + 1}` : `changed line ${index + 1}`
  })
  if (phrases.length === 0) return 'No values changed'
  const text = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function documentResult(store: RevisionStore, outputId: string, revisionId: RevisionId, changed: string[], followUp: string | null, attempts: number): DocumentResult {
  const revision = getRevision(store, revisionId)
  const view = documentView(revision.snapshot)
  return { outputId, revisionId, version: versionNumber(store, revisionId), title: getDocument(store, outputId).title, readiness: view.readiness, document: view, changed, followUp, attempts }
}

const today = (env: DocumentEnv) => env.now().slice(0, 10)

/** A blank, unbranded invoice (D-61): the base every generated invoice starts from. */
export function blankInvoice(locale = 'en-US'): InvoiceSnapshot {
  return invoiceSnapshot({ brand: UNBRANDED, locale, fields: blankInvoiceFields(), items: [] })
}

// ── generate ─────────────────────────────────────────────────────────────────

export async function generateDocument(raw: unknown, ctx: ToolContext): Promise<ToolOutcome<DocumentResult>> {
  const parsed = GenerateInputSchema.safeParse(raw)
  if (!parsed.success) return inputError(ctx.store, parsed.error)
  const input = parsed.data
  const base = blankInvoice()

  let gated: Extract<GateResult, { ok: true }>
  let followUp: string | null = null
  let attempts = 0
  let caller: Caller
  if ('prompt' in input) {
    if (!ctx.model) return fail(ctx.store, { code: 'model-required', message: 'Generating from a prompt needs a model; pass operations to generate without one.', retryable: false })
    const history = input.conversation ?? []
    caller = 'model'
    const sourceText = [...history, input.prompt].join('\n')
    const loop = await proposeUntilValid(ctx.model, {
      task: 'generate', docType: 'invoice', request: input.prompt, conversation: history, document: documentView(base), today: today(ctx.env),
    }, (proposal) => gateProposal(base, proposal, { env: ctx.env, caller, sourceText, revising: false }), ctx.propose)
    if (!loop.ok) return fail(ctx.store, loop.code === 'gate-failed'
      ? { code: 'gate-failed', message: loop.errors.every((e) => !e.retryable) ? `${loop.errors[0]?.message ?? 'The request cannot be generated.'} Nothing was saved.` : `No valid document after ${loop.attempts} attempts; nothing was saved.`, retryable: loop.errors.some((e) => e.retryable), errors: loop.errors }
      : { code: loop.code, message: loop.message, retryable: loop.retryable })
    gated = loop.gated
    followUp = loop.proposal.followUp
    attempts = loop.attempts
  } else {
    caller = 'direct'
    const result = gateOperations(base, input.operations, { env: ctx.env, caller, sourceText: '', revising: false })
    if (!result.ok) return fail(ctx.store, { code: 'gate-failed', message: 'The operations were refused; nothing was saved.', retryable: true, errors: result.errors })
    gated = result
  }

  const created = createDocument(ctx.store, ctx.env, gated.snapshot, { author: caller === 'model' ? GENERATOR_AUTHOR : DIRECT_AUTHOR })
  return { ok: true, store: created.store, result: documentResult(created.store, created.outputId, created.revision.revisionId, gated.targets, followUp, attempts) }
}

// ── revise ───────────────────────────────────────────────────────────────────

export async function reviseDocument(raw: unknown, ctx: ToolContext): Promise<ToolOutcome<DocumentResult>> {
  const parsed = ReviseInputSchema.safeParse(raw)
  if (!parsed.success) return inputError(ctx.store, parsed.error)
  const input = parsed.data
  let base: DocumentSnapshot
  let outputId: string
  try {
    const revision = getRevision(ctx.store, input.revisionId)
    base = revision.snapshot
    outputId = revision.outputId
    const current = getDocument(ctx.store, outputId).currentRevisionId
    if (current !== input.revisionId) {
      return fail(ctx.store, { code: 'not-current', message: `${input.revisionId} is not the current revision of ${outputId} (${current} is). Revise the current revision.`, retryable: true })
    }
  } catch (e) {
    return revisionError(ctx.store, e)
  }
  if (base.kind !== 'invoice') return fail(ctx.store, { code: 'unsupported', message: `Revising a ${base.kind} through the generation tools is not supported yet.`, retryable: false })
  const invoice = base

  let gated: Extract<GateResult, { ok: true }>
  let followUp: string | null = null
  let attempts = 0
  let caller: Caller
  if ('instruction' in input) {
    if (!ctx.model) return fail(ctx.store, { code: 'model-required', message: 'Revising from an instruction needs a model; pass operations to revise without one.', retryable: false })
    const history = input.conversation ?? []
    caller = 'model'
    const sourceText = [...history, input.instruction].join('\n')
    const loop = await proposeUntilValid(ctx.model, {
      task: 'revise', docType: 'invoice', request: input.instruction, conversation: history, document: documentView(invoice), today: today(ctx.env),
    }, (proposal) => gateProposal(invoice, proposal, { env: ctx.env, caller, sourceText, revising: true }), ctx.propose)
    if (!loop.ok) return fail(ctx.store, loop.code === 'gate-failed'
      ? { code: 'gate-failed', message: `No valid revision after ${loop.attempts} attempts; nothing was saved.`, retryable: true, errors: loop.errors }
      : { code: loop.code, message: loop.message, retryable: loop.retryable })
    gated = loop.gated
    followUp = loop.proposal.followUp
    attempts = loop.attempts
  } else {
    caller = 'direct'
    const result = gateOperations(invoice, input.operations, { env: ctx.env, caller, sourceText: '', revising: true })
    if (!result.ok) return fail(ctx.store, { code: 'gate-failed', message: 'The operations were refused; nothing was saved.', retryable: true, errors: result.errors })
    gated = result
  }

  try {
    const saved = saveGenerated(ctx.store, ctx.env, outputId, input.revisionId, gated.snapshot, {
      changeSummary: describeChanges(gated.snapshot, invoice, gated.targets),
      operation: { type: 'generate', caller, targets: gated.targets },
      author: caller === 'model' ? GENERATOR_AUTHOR : DIRECT_AUTHOR,
    })
    return { ok: true, store: saved.store, result: documentResult(saved.store, outputId, saved.revision.revisionId, gated.targets, followUp, attempts) }
  } catch (e) {
    return revisionError(ctx.store, e)
  }
}

// ── export ───────────────────────────────────────────────────────────────────

/**
 * Renders one pinned revision with the existing adapters. Deterministic: the file's creation
 * time is the revision's own, nothing is regenerated or summarised, so the same revision and
 * format always give the same bytes.
 */
export async function exportDocument(raw: unknown, ctx: ToolContext & { resources: (snapshot: DocumentSnapshot) => ExportResources | Promise<ExportResources> }): Promise<ToolOutcome<ExportResult>> {
  const parsed = ExportInputSchema.safeParse(raw)
  if (!parsed.success) return inputError(ctx.store, parsed.error)
  const { revisionId, format } = parsed.data
  let revision
  try {
    revision = getRevision(ctx.store, revisionId)
  } catch (e) {
    return revisionError(ctx.store, e)
  }
  const { snapshot } = revision
  const cap = capability(snapshot.kind, format)
  if (!cap.supported) return fail(ctx.store, { code: 'unsupported', message: cap.reason, retryable: false })
  const version = versionNumber(ctx.store, revisionId)
  const adapter = ADAPTERS[format]
  const checked = adapter.validate(snapshot)
  let resources: ExportResources
  try {
    resources = await ctx.resources(snapshot)
  } catch (e) {
    return fail(ctx.store, { code: 'export-failed', message: e instanceof Error ? e.message : String(e), retryable: true })
  }
  const outcome = await adapter.render(snapshot, {
    resources,
    title: getDocument(ctx.store, revision.outputId).title,
    subject: `Revision ${revisionId} (v${version})`,
    createdAt: revision.createdAt,
  })
  if (!outcome.ok) return fail(ctx.store, { code: 'export-failed', message: outcome.error.message, retryable: outcome.error.code === 'renderer-failed' })
  return {
    ok: true,
    store: ctx.store,
    result: {
      revisionId, version, format,
      filename: exportFilename(snapshot, format, version, revisionId),
      mimeType: FORMAT_FILE[format].mimeType,
      pageCount: outcome.pageCount,
      draft: checked.ok && checked.draft,
      bytes: outcome.bytes,
    },
  }
}

// ── Schemas for agents ───────────────────────────────────────────────────────

const OPERATIONS_NOTE = 'Operations follow the generation schema (operations_schema). Values set directly must use provenance {"source":"caller"}. Revising an existing field or line item requires its expectedDigest from the document view.'

/** Tool definitions in the shape LLM tool APIs take: name, description, JSON Schema input. */
export function toolSchemas() {
  return {
    tools: [
      { name: 'generate_document', description: `Create a new document (invoice) from a prompt, or from operations. Missing facts are saved as explicit unknowns; an invalid document is refused with structured errors. ${OPERATIONS_NOTE}`, input_schema: z.toJSONSchema(GenerateInputSchema, { target: 'draft-7' }) },
      { name: 'revise_document', description: `Create the next revision of a document from an instruction or operations. Only the current revision can be revised. ${OPERATIONS_NOTE}`, input_schema: z.toJSONSchema(ReviseInputSchema, { target: 'draft-7' }) },
      { name: 'export_document', description: 'Render one revision to PDF, Word (docx) or PowerPoint (pptx, decks only) with the deterministic adapters. Incomplete documents export marked as drafts; invalid ones are refused.', input_schema: z.toJSONSchema(ExportInputSchema, { target: 'draft-7' }) },
    ],
    operations_schema: operationsJsonSchema(),
  }
}
