// Revisions (PRD §5, §7, §9; fixtures 6, 7, 8 and deck ancestry for 5).
//
// An in-memory, immutable store. Every operation returns a new store; nothing
// is mutated in place and history is never rewritten. Each revision holds a
// deep-frozen snapshot, so changing saved content throws. Edits are bounded:
// one field value, one line-item property, or the text of one sentence/list
// item. Unchanged blocks, fields and the brand keep their exact object
// identity across revisions, which is how the "only this changed" comparison
// is proven. Approval markers are mock, belong to one exact revision and are
// never carried to another. Every failure is an explicit RevisionError.
//
// Browser storage and broken-session recovery arrive in Step 6.

import { formatFieldValue } from './display'
import { deriveDeck } from './deck'
import type {
  Block,
  BriefSnapshot,
  DocumentEnv,
  DocumentKind,
  DocumentRecord,
  DocumentSnapshot,
  FieldId,
  FieldValue,
  InvoiceLineItem,
  Money,
  OutputId,
  ReviewMarker,
  Revision,
  RevisionAuthor,
  RevisionId,
  RevisionOperation,
  TextRun,
} from './model'
import { BRIEF_FIELDS } from './brief'

// ── Authors (approved display names) ─────────────────────────────────────────

export const SAMPLE_OPERATOR: RevisionAuthor = { id: 'author-sample-operator', name: 'Sample operator (fictional)', kind: 'person' }
export const SYSTEM_AUTHOR: RevisionAuthor = { id: 'author-system', name: 'System', kind: 'system' }

// ── Errors ───────────────────────────────────────────────────────────────────

export type RevisionErrorCode = 'not-found' | 'wrong-document' | 'not-current' | 'invalid-edit' | 'no-change' | 'unsupported'

export class RevisionError extends Error {
  constructor(readonly code: RevisionErrorCode, message: string) {
    super(message)
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface RevisionStore {
  readonly documents: ReadonlyMap<OutputId, DocumentRecord>
  readonly revisions: ReadonlyMap<RevisionId, Revision>
  readonly markers: readonly ReviewMarker[]
}

export function emptyStore(): RevisionStore {
  return { documents: new Map(), revisions: new Map(), markers: [] }
}

/** Freeze an object graph in place. Already-frozen (shared) subtrees are skipped. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key])
  return value
}

export function getDocument(store: RevisionStore, outputId: OutputId): DocumentRecord {
  const doc = store.documents.get(outputId)
  if (!doc) throw new RevisionError('not-found', `No document ${outputId}.`)
  return doc
}

export function getRevision(store: RevisionStore, revisionId: RevisionId): Revision {
  const rev = store.revisions.get(revisionId)
  if (!rev) throw new RevisionError('not-found', `No revision ${revisionId}.`)
  return rev
}

export function currentRevision(store: RevisionStore, outputId: OutputId): Revision {
  return getRevision(store, getDocument(store, outputId).currentRevisionId)
}

export function history(store: RevisionStore, outputId: OutputId): Revision[] {
  return getDocument(store, outputId).revisionIds.map((id) => getRevision(store, id))
}

/** Display label "v{n}": position in creation order. The revision ID remains the identity. */
export function versionNumber(store: RevisionStore, revisionId: RevisionId): number {
  const rev = getRevision(store, revisionId)
  return getDocument(store, rev.outputId).revisionIds.indexOf(revisionId) + 1
}

export const versionLabel = (store: RevisionStore, revisionId: RevisionId) => `v${versionNumber(store, revisionId)}`

function titleOf(snapshot: DocumentSnapshot): string {
  if (snapshot.kind === 'invoice') {
    const n = snapshot.fields['invoice.number']
    return n?.state.status === 'provided' ? `Invoice ${formatFieldValue(n.state.value, snapshot.locale)}` : 'Invoice'
  }
  const t = snapshot.fields[BRIEF_FIELDS.title]
  return t?.state.status === 'provided' ? formatFieldValue(t.state.value, snapshot.locale) : snapshot.kind === 'deck' ? 'Deck' : 'Brief'
}

function addRevision(
  store: RevisionStore,
  env: DocumentEnv,
  outputId: OutputId,
  input: { parent: RevisionId | null; author: RevisionAuthor; changeSummary: string; operation: RevisionOperation; snapshot: DocumentSnapshot },
  record?: Partial<DocumentRecord>,
): { store: RevisionStore; revision: Revision } {
  const revision: Revision = deepFreeze({
    revisionId: env.nextId('rev'),
    outputId,
    parentRevisionId: input.parent,
    createdAt: env.now(),
    author: input.author,
    changeSummary: input.changeSummary,
    operation: input.operation,
    snapshot: deepFreeze(input.snapshot),
  })
  const existing = store.documents.get(outputId)
  const doc: DocumentRecord = deepFreeze({
    outputId,
    kind: (existing?.kind ?? input.snapshot.kind) as DocumentKind,
    title: existing?.title ?? titleOf(input.snapshot),
    ...existing,
    ...record,
    currentRevisionId: revision.revisionId,
    revisionIds: [...(existing?.revisionIds ?? []), revision.revisionId],
  })
  const documents = new Map(store.documents)
  documents.set(outputId, doc)
  const revisions = new Map(store.revisions)
  revisions.set(revision.revisionId, revision)
  return { store: { ...store, documents, revisions }, revision }
}

export function createDocument(store: RevisionStore, env: DocumentEnv, snapshot: DocumentSnapshot, options: { outputId?: OutputId; title?: string; author?: RevisionAuthor } = {}): { store: RevisionStore; outputId: OutputId; revision: Revision } {
  const outputId = options.outputId ?? env.nextId('out')
  if (store.documents.has(outputId)) throw new RevisionError('invalid-edit', `Document ${outputId} already exists.`)
  const { store: next, revision } = addRevision(store, env, outputId, {
    parent: null, author: options.author ?? SYSTEM_AUTHOR, changeSummary: 'Created', operation: { type: 'create' }, snapshot,
  }, options.title ? { title: options.title } : undefined)
  return { store: next, outputId, revision }
}

// ── Bounded edits ────────────────────────────────────────────────────────────

export type BoundedEdit =
  | { kind: 'field'; fieldId: FieldId; value: FieldValue }
  | { kind: 'line-item'; blockId: string; itemId: string; change: { property: 'description'; value: string } | { property: 'quantity'; quantityMilli: number } | { property: 'unitPrice'; value: Money } }
  /** The text of one sentence (a paragraph run) or one list item (`item`), citations kept. */
  | { kind: 'text'; blockId: string; item?: number; run: number; text: string }

/**
 * Fields whose value is owned by the issuer's brand profile. Editing them alone would put two
 * issuer names in one document (letterhead/footer vs. parties), so the edit is refused.
 */
export const BRAND_OWNED_FIELDS: Readonly<Record<FieldId, string>> = {
  'issuer.name': 'The issuer name comes from the issuer’s brand profile, so it can’t be edited here. Brand editing is outside this step.',
}

const PROPERTY_LABEL = { description: 'description', quantity: 'quantity', unitPrice: 'unit price' } as const

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Nearest heading above a block, for "Edited text in {section heading}". */
function sectionHeading(snapshot: DocumentSnapshot, blockId: string): string | null {
  let heading: string | null = null
  for (const b of snapshot.blocks) {
    if (b.type === 'heading') heading = b.text
    if (b.id === blockId) return heading
  }
  return null
}

function replaceBlock(snapshot: DocumentSnapshot, blockId: string, next: Block): DocumentSnapshot {
  return { ...snapshot, blocks: snapshot.blocks.map((b) => (b.id === blockId ? next : b)) }
}

/** Applies one bounded edit, returning the new snapshot and its approved change summary. Pure. */
export function applyBoundedEdit(snapshot: DocumentSnapshot, edit: BoundedEdit): { snapshot: DocumentSnapshot; changeSummary: string; target: Extract<RevisionOperation, { type: 'edit' }>['target'] } {
  if (edit.kind === 'field') {
    const field = snapshot.fields[edit.fieldId]
    if (!field) throw new RevisionError('invalid-edit', `This document has no field ${edit.fieldId}.`)
    if (BRAND_OWNED_FIELDS[edit.fieldId]) throw new RevisionError('unsupported', BRAND_OWNED_FIELDS[edit.fieldId])
    if (edit.value.type !== field.valueType) throw new RevisionError('invalid-edit', `${field.label} takes a ${field.valueType} value, not ${edit.value.type}.`)
    if (edit.value.type === 'choice' && !field.options?.some((o) => o.value === (edit.value as { option: string }).option)) {
      throw new RevisionError('invalid-edit', `“${edit.value.option}” is not an option for ${field.label}.`)
    }
    if ((edit.value.type === 'text' && !edit.value.text.trim()) || (edit.value.type === 'multiline' && !edit.value.lines.some((l) => l.trim()))) {
      throw new RevisionError('invalid-edit', `${field.label} cannot be blank. Leave it missing instead of saving an empty value.`)
    }
    if (field.state.status === 'provided' && sameValue(field.state.value, edit.value)) throw new RevisionError('no-change', `${field.label} already has that value; no revision was created.`)
    const fields = { ...snapshot.fields, [edit.fieldId]: { ...field, state: { status: 'provided' as const, value: edit.value } } }
    return { snapshot: { ...snapshot, fields }, changeSummary: `Edited ${field.label}`, target: { kind: 'field', fieldId: edit.fieldId } }
  }

  const block = snapshot.blocks.find((b) => b.id === edit.blockId)
  if (!block) throw new RevisionError('invalid-edit', `This document has no block ${edit.blockId}.`)

  if (edit.kind === 'line-item') {
    if (block.type !== 'line-items') throw new RevisionError('invalid-edit', `${edit.blockId} is not a line-item block.`)
    const index = block.items.findIndex((i) => i.id === edit.itemId)
    if (index < 0) throw new RevisionError('invalid-edit', `No line item ${edit.itemId}.`)
    const item = block.items[index]
    let next: InvoiceLineItem
    const c = edit.change
    if (c.property === 'description') {
      if (!c.value.trim()) throw new RevisionError('invalid-edit', 'A line item needs a description.')
      if (c.value === item.description) throw new RevisionError('no-change', 'The description is unchanged; no revision was created.')
      next = { ...item, description: c.value }
    } else if (c.property === 'quantity') {
      if (!Number.isInteger(c.quantityMilli) || c.quantityMilli <= 0) throw new RevisionError('invalid-edit', 'Quantity must be greater than zero, in thousandths.')
      if (c.quantityMilli === item.quantityMilli) throw new RevisionError('no-change', 'The quantity is unchanged; no revision was created.')
      next = { ...item, quantityMilli: c.quantityMilli }
    } else {
      if (!Number.isInteger(c.value.amountMinor) || c.value.amountMinor < 0) throw new RevisionError('invalid-edit', 'Unit price must be a whole number of minor units, not negative.')
      if (item.unitPrice && sameValue(item.unitPrice, c.value)) throw new RevisionError('no-change', 'The unit price is unchanged; no revision was created.')
      next = { ...item, unitPrice: c.value }
    }
    const items = block.items.map((i, k) => (k === index ? next : i))
    return {
      snapshot: replaceBlock(snapshot, block.id, { ...block, items }),
      changeSummary: `Edited line ${index + 1}: ${PROPERTY_LABEL[c.property]}`,
      target: { kind: 'block', blockId: block.id },
    }
  }

  // Text of one sentence or list item.
  let runs: readonly TextRun[]
  if (block.type === 'paragraph' || block.type === 'callout') runs = block.runs
  else if (block.type === 'list') {
    if (edit.item === undefined || !block.items[edit.item]) throw new RevisionError('invalid-edit', `List ${block.id} has no item ${edit.item}.`)
    runs = block.items[edit.item]
  } else throw new RevisionError('invalid-edit', `${block.id} has no editable text.`)
  const run = runs[edit.run]
  if (!run) throw new RevisionError('invalid-edit', `${block.id} has no sentence ${edit.run}.`)
  if (!edit.text.trim()) throw new RevisionError('invalid-edit', 'Text cannot be blank.')
  if (edit.text === run.text) throw new RevisionError('no-change', 'The text is unchanged; no revision was created.')
  const heading = sectionHeading(snapshot, block.id)
  if (!heading) throw new RevisionError('unsupported', `Text in ${block.id} is not under a section heading; only sectioned text can be edited.`)
  const nextRuns = runs.map((r, k) => (k === edit.run ? { ...r, text: edit.text } : r))
  const nextBlock: Block = block.type === 'list'
    ? { ...block, items: block.items.map((it, k) => (k === edit.item ? nextRuns : it)) }
    : { ...block, runs: nextRuns } as Block
  return { snapshot: replaceBlock(snapshot, block.id, nextBlock), changeSummary: `Edited text in ${heading}`, target: { kind: 'block', blockId: block.id } }
}

function requireCurrent(store: RevisionStore, outputId: OutputId, baseRevisionId: RevisionId): Revision {
  const doc = getDocument(store, outputId)
  const base = getRevision(store, baseRevisionId)
  if (base.outputId !== outputId) throw new RevisionError('wrong-document', `${baseRevisionId} belongs to ${base.outputId}, not ${outputId}.`)
  if (doc.currentRevisionId !== baseRevisionId) {
    throw new RevisionError('not-current', `${versionLabel(store, baseRevisionId)} is not the current revision (${versionLabel(store, doc.currentRevisionId)} is). Edit the current revision, or restore ${versionLabel(store, baseRevisionId)} first.`)
  }
  return base
}

/** Save a bounded edit as a new revision. The edit must be based on the current revision. */
export function saveEdit(store: RevisionStore, env: DocumentEnv, outputId: OutputId, baseRevisionId: RevisionId, edit: BoundedEdit, author: RevisionAuthor = SAMPLE_OPERATOR) {
  const base = requireCurrent(store, outputId, baseRevisionId)
  if (base.snapshot.kind === 'deck') throw new RevisionError('unsupported', 'Decks are not edited directly; edit the brief and derive again.')
  const result = applyBoundedEdit(base.snapshot, edit)
  return addRevision(store, env, outputId, { parent: base.revisionId, author, changeSummary: result.changeSummary, operation: { type: 'edit', target: result.target }, snapshot: result.snapshot })
}

// ── Proposals ────────────────────────────────────────────────────────────────

/** A proposed edit. Sample data only — never applied content until accepted. */
export interface Proposal {
  proposalId: string
  outputId: OutputId
  baseRevisionId: RevisionId
  title: string
  edit: BoundedEdit
  fictional: true
}

export function previewProposal(store: RevisionStore, proposal: Proposal): { before: DocumentSnapshot; after: DocumentSnapshot; changeSummary: string } {
  const base = getRevision(store, proposal.baseRevisionId)
  const { snapshot, changeSummary } = applyBoundedEdit(base.snapshot, proposal.edit)
  return { before: base.snapshot, after: snapshot, changeSummary }
}

export function acceptProposal(store: RevisionStore, env: DocumentEnv, proposal: Proposal, author: RevisionAuthor = SAMPLE_OPERATOR) {
  const base = requireCurrent(store, proposal.outputId, proposal.baseRevisionId)
  const { snapshot } = applyBoundedEdit(base.snapshot, proposal.edit)
  return addRevision(store, env, proposal.outputId, {
    parent: base.revisionId, author, changeSummary: `Accepted proposal: ${proposal.title}`, operation: { type: 'accept-proposal', proposalId: proposal.proposalId }, snapshot,
  })
}

/** Rejecting changes nothing: the same store is returned. */
export function rejectProposal(store: RevisionStore, proposal: Proposal): RevisionStore {
  getRevision(store, proposal.baseRevisionId)
  return store
}

// ── Restore ──────────────────────────────────────────────────────────────────

/** Creates a new current revision with an earlier revision's content. Later history is kept; approval is not inherited. */
export function restoreRevision(store: RevisionStore, env: DocumentEnv, outputId: OutputId, fromRevisionId: RevisionId, author: RevisionAuthor = SYSTEM_AUTHOR) {
  const doc = getDocument(store, outputId)
  const from = getRevision(store, fromRevisionId)
  if (from.outputId !== outputId) throw new RevisionError('wrong-document', `${fromRevisionId} belongs to ${from.outputId}, not ${outputId}.`)
  if (doc.currentRevisionId === fromRevisionId) throw new RevisionError('no-change', `${versionLabel(store, fromRevisionId)} is already the current revision.`)
  // A restored deck's record points at the source of the content it now carries.
  const source = doc.kind === 'deck' ? deriveSourceOf(store, fromRevisionId) : null
  return addRevision(store, env, outputId, {
    parent: doc.currentRevisionId, author, changeSummary: `Restored from ${versionLabel(store, fromRevisionId)}`, operation: { type: 'restore', fromRevisionId }, snapshot: from.snapshot,
  }, source ? { derivedFrom: source } : undefined)
}

// ── Mock approval ────────────────────────────────────────────────────────────

export function markApproved(store: RevisionStore, env: DocumentEnv, revisionId: RevisionId, reviewer: string): RevisionStore {
  getRevision(store, revisionId)
  if (store.markers.some((m) => m.revisionId === revisionId && m.decision === 'approved')) throw new RevisionError('no-change', `${versionLabel(store, revisionId)} is already approved.`)
  const marker: ReviewMarker = deepFreeze({ reviewer, decision: 'approved', timestamp: env.now(), revisionId, mock: true })
  return { ...store, markers: [...store.markers, marker] }
}

/** The approval for this exact revision, or null. Never inherited from another revision. */
export function approvalOf(store: RevisionStore, revisionId: RevisionId): ReviewMarker | null {
  return store.markers.find((m) => m.revisionId === revisionId && m.decision === 'approved') ?? null
}

export function approvalLabel(store: RevisionStore, revisionId: RevisionId, formatDate: (iso: string) => string): string {
  const marker = approvalOf(store, revisionId)
  return marker ? `Approved (sample) by ${marker.reviewer} on ${formatDate(marker.timestamp)} — applies to ${versionLabel(store, revisionId)} only` : 'Not approved'
}

// ── Decks: derivation and ancestry ───────────────────────────────────────────

/**
 * Derive a deck from one exact brief revision. With `deckOutputId`, adds a new revision to that
 * deck (deriving again); otherwise creates a new deck document.
 */
export function deriveDeckRevision(store: RevisionStore, env: DocumentEnv, briefOutputId: OutputId, briefRevisionId: RevisionId, deckOutputId?: OutputId) {
  const source = getRevision(store, briefRevisionId)
  if (source.outputId !== briefOutputId) throw new RevisionError('wrong-document', `${briefRevisionId} belongs to ${source.outputId}, not ${briefOutputId}.`)
  if (source.snapshot.kind !== 'brief') throw new RevisionError('unsupported', `Decks are derived from briefs; ${briefOutputId} is a ${source.snapshot.kind}.`)
  const derived = deriveDeck(source.snapshot as BriefSnapshot, { outputId: briefOutputId, revisionId: briefRevisionId })
  const brief = getDocument(store, briefOutputId)
  const from = { outputId: briefOutputId, revisionId: briefRevisionId }
  const changeSummary = `Derived from ${brief.title} ${versionLabel(store, briefRevisionId)}`
  if (deckOutputId) {
    const deck = getDocument(store, deckOutputId)
    if (deck.kind !== 'deck') throw new RevisionError('wrong-document', `${deckOutputId} is not a deck.`)
    const { store: next, revision } = addRevision(store, env, deckOutputId, { parent: deck.currentRevisionId, author: SYSTEM_AUTHOR, changeSummary, operation: { type: 'derive', from }, snapshot: derived.snapshot }, { derivedFrom: from })
    return { store: next, outputId: deckOutputId, revision }
  }
  const outputId = env.nextId('out')
  const { store: next, revision } = addRevision(store, env, outputId, { parent: null, author: SYSTEM_AUTHOR, changeSummary, operation: { type: 'derive', from }, snapshot: derived.snapshot }, { kind: 'deck', title: brief.title, derivedFrom: from })
  return { store: next, outputId, revision }
}

export type AncestryCheck =
  | { status: 'current'; label: string; sourceVersion: number }
  | { status: 'stale'; label: string; sourceVersion: number; latestVersion: number }
  | { status: 'invalid'; label: string; reason: string }

/** Checks that a deck revision's recorded source is a real brief revision and that the deck was made from it. */
export function checkAncestry(store: RevisionStore, deckRevisionId: RevisionId): AncestryCheck {
  const invalid = (reason: string): AncestryCheck => ({ status: 'invalid', label: `Ancestry check failed: ${reason}`, reason })
  const deckRev = store.revisions.get(deckRevisionId)
  if (!deckRev) return invalid(`deck revision ${deckRevisionId} does not exist.`)
  if (deckRev.snapshot.kind !== 'deck') return invalid(`${deckRevisionId} is not a deck revision.`)
  const op = deckRev.operation
  const from = op.type === 'derive' ? op.from : op.type === 'restore' ? deriveSourceOf(store, op.fromRevisionId) : null
  if (!from) return invalid('the deck revision records no source brief revision.')
  const source = store.revisions.get(from.revisionId)
  if (!source) return invalid(`source revision ${from.revisionId} does not exist.`)
  if (source.outputId !== from.outputId) return invalid(`source revision ${from.revisionId} belongs to ${source.outputId}, not ${from.outputId}.`)
  if (source.snapshot.kind !== 'brief') return invalid(`source ${from.outputId} is a ${source.snapshot.kind}, not a brief.`)
  const expected = deriveDeck(source.snapshot as BriefSnapshot, from).snapshot
  if (JSON.stringify(expected) !== JSON.stringify(deckRev.snapshot)) return invalid(`the deck's content does not match ${from.revisionId}.`)
  const sourceVersion = versionNumber(store, from.revisionId)
  const brief = getDocument(store, from.outputId)
  const latestVersion = brief.revisionIds.length
  if (brief.currentRevisionId === from.revisionId) return { status: 'current', label: `Derived from brief v${sourceVersion} — current`, sourceVersion }
  return { status: 'stale', label: `Derived from brief v${sourceVersion} — the brief now has v${latestVersion}. This deck does not update by itself; derive again to update.`, sourceVersion, latestVersion }
}

function deriveSourceOf(store: RevisionStore, revisionId: RevisionId): { outputId: OutputId; revisionId: RevisionId } | null {
  const rev = store.revisions.get(revisionId)
  if (!rev) return null
  if (rev.operation.type === 'derive') return rev.operation.from
  if (rev.operation.type === 'restore') return deriveSourceOf(store, rev.operation.fromRevisionId)
  return null
}

// ── Comparison ───────────────────────────────────────────────────────────────

export interface RevisionComparison {
  changedBlocks: string[]
  unchangedBlocks: string[]
  changedFields: string[]
  unchangedFields: string[]
  brandUnchanged: boolean
  localeUnchanged: boolean
  layoutUnchanged: boolean
}

/** Block-by-block and field-by-field comparison. "Unchanged" means the same frozen object, not just equal text. */
export function compareSnapshots(a: DocumentSnapshot, b: DocumentSnapshot): RevisionComparison {
  const bBlocks = new Map(b.blocks.map((x) => [x.id, x]))
  const ids = [...new Set([...a.blocks.map((x) => x.id), ...b.blocks.map((x) => x.id)])]
  const changedBlocks = ids.filter((id) => a.blocks.find((x) => x.id === id) !== bBlocks.get(id))
  const fieldIds = [...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])]
  const changedFields = fieldIds.filter((id) => a.fields[id] !== b.fields[id])
  return {
    changedBlocks,
    unchangedBlocks: ids.filter((id) => !changedBlocks.includes(id)),
    changedFields,
    unchangedFields: fieldIds.filter((id) => !changedFields.includes(id)),
    brandUnchanged: a.brand === b.brand,
    localeUnchanged: a.locale === b.locale,
    layoutUnchanged: a.layoutPreset === b.layoutPreset,
  }
}
