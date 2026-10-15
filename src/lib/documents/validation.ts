// Snapshot validation.
//
// Produces per-field reports (shown beside each field) plus a flat issue list
// (the navigable summary). Messages name the specific problem; validation
// never supplies a replacement value.
//
// Readiness:
//   invalid    — at least one value is malformed or contradicts another
//   incomplete — values are well-formed, but a required fact is missing
//   ready      — every required fact is supplied and valid

import { BRIEF_FIELDS } from './brief'
import { CURRENCIES } from './defaults'
import { computeInvoiceTotals, INVOICE_FIELDS } from './invoice'
import type {
  BlockId,
  CitationId,
  DocumentSnapshot,
  Field,
  FieldId,
  FieldStatus,
  NotApplicableRule,
} from './model'

export type IssueSeverity = 'error' | 'missing' | 'warning'

export type IssueTarget =
  | { kind: 'field'; fieldId: FieldId }
  | { kind: 'line-item'; blockId: BlockId; itemId: string }
  | { kind: 'block'; blockId: BlockId }
  | { kind: 'citation'; citationId: CitationId }
  | { kind: 'document' }

export interface ValidationIssue {
  /** Stable for a given problem, so UI can key and focus it. */
  id: string
  severity: IssueSeverity
  target: IssueTarget
  message: string
}

export interface FieldReport {
  fieldId: FieldId
  status: FieldStatus
  required: boolean
  /** Specific messages for this field, worst first. Empty when the field is fine. */
  messages: readonly string[]
  severity: IssueSeverity | null
}

export type Readiness = 'ready' | 'incomplete' | 'invalid'

export interface ValidationReport {
  fields: Readonly<Record<FieldId, FieldReport>>
  issues: readonly ValidationIssue[]
  readiness: Readiness
}

/**
 * The only circumstances in which a field may be "not applicable". Each rule
 * names the supplied fact that makes it so; if that fact is absent or says
 * otherwise, the not-applicable status is itself an error.
 */
export const NOT_APPLICABLE_RULES: Readonly<Record<NotApplicableRule, { description: string; holds: (s: DocumentSnapshot) => boolean }>> = {
  'tax-rate-when-exempt': {
    description: 'Tax rate is not applicable when the issuer states the invoice is tax-exempt.',
    holds: (s) => choiceOf(s, INVOICE_FIELDS.taxApplicability) === 'exempt',
  },
  'discount-when-none': {
    description: 'Discount rate is not applicable when the issuer states no discount is offered.',
    holds: (s) => choiceOf(s, INVOICE_FIELDS.discountApplicability) === 'none',
  },
}

function choiceOf(snapshot: DocumentSnapshot, fieldId: FieldId): string | undefined {
  const state = snapshot.fields[fieldId]?.state
  return state?.status === 'provided' && state.value.type === 'choice' ? state.value.option : undefined
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, missing: 1, warning: 2 }

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const date = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso
}

/** Problems with a provided value on its own (type, range, format). */
function valueProblems(field: Field, snapshot: DocumentSnapshot): string[] {
  if (field.state.status !== 'provided') return []
  const value = field.state.value
  if (value.type !== field.valueType) {
    return [`Expected a ${field.valueType} value but got ${value.type}.`]
  }
  switch (value.type) {
    case 'text':
      return value.text.trim() === '' ? ['Marked as provided but empty. Mark it missing instead.'] : []
    case 'multiline':
      return value.lines.every((line) => line.trim() === '') ? ['Marked as provided but empty. Mark it missing instead.'] : []
    case 'date':
      return isRealDate(value.iso) ? [] : [`“${value.iso}” is not a valid calendar date (expected YYYY-MM-DD).`]
    case 'currency':
      return value.code in CURRENCIES ? [] : [`Unsupported currency “${value.code}”.`]
    case 'percent':
      if (!Number.isInteger(value.basisPoints)) return ['Percentage must be a whole number of basis points.']
      return value.basisPoints < 0 || value.basisPoints > 10_000 ? ['Percentage must be between 0% and 100%.'] : []
    case 'choice': {
      const allowed = field.options?.map((o) => o.value) ?? []
      return allowed.includes(value.option) ? [] : [`“${value.option}” is not one of the permitted options.`]
    }
    case 'money': {
      if (!Number.isSafeInteger(value.money.amountMinor)) return ['Amount must be an integer number of minor units.']
      const currency = snapshot.kind === 'invoice' ? choiceCurrency(snapshot) : undefined
      return currency && value.money.currency !== currency ? [`Amount is in ${value.money.currency}; this invoice is in ${currency}.`] : []
    }
  }
}

function choiceCurrency(snapshot: DocumentSnapshot): string | undefined {
  const state = snapshot.fields[INVOICE_FIELDS.currency]?.state
  return state?.status === 'provided' && state.value.type === 'currency' ? state.value.code : undefined
}

/** Fields a template cannot do without. A fixture may add more required fields, never fewer. */
export const TEMPLATE_CORE_FIELDS: Readonly<Record<DocumentSnapshot['kind'], readonly FieldId[]>> = {
  invoice: [INVOICE_FIELDS.issuerName, INVOICE_FIELDS.buyerName, INVOICE_FIELDS.number, INVOICE_FIELDS.issueDate, INVOICE_FIELDS.currency, INVOICE_FIELDS.taxApplicability],
  brief: [BRIEF_FIELDS.title, BRIEF_FIELDS.audience],
  deck: [],
}

/** “Design review” or, when the description is unknown, “line 2”. */
const lineName = (item: { description: string | null }, index: number) => (item.description !== null ? `“${item.description}”` : `line ${index + 1}`)

export function validateSnapshot(snapshot: DocumentSnapshot): ValidationReport {
  const issues: ValidationIssue[] = []

  // ── Template shape ──
  if (snapshot.blocks.length === 0) {
    issues.push({ id: 'document:empty', severity: 'missing', target: { kind: 'document' }, message: 'This document has no content yet: no sections, line items or text have been supplied.' })
  }
  const absentCore = TEMPLATE_CORE_FIELDS[snapshot.kind].filter((id) => !snapshot.fields[id])
  if (absentCore.length > 0) {
    issues.push({ id: 'document:core-fields', severity: 'missing', target: { kind: 'document' }, message: `The ${snapshot.templateId} template needs these fields, which are not defined: ${absentCore.join(', ')}.` })
  }
  for (const id of TEMPLATE_CORE_FIELDS[snapshot.kind]) {
    const field = snapshot.fields[id]
    if (field && !field.required) {
      issues.push({ id: `field:${id}:core-optional`, severity: 'error', target: { kind: 'field', fieldId: id }, message: `${field.label} is core to the ${snapshot.templateId} template and cannot be optional.` })
    }
  }

  const fieldMessages = new Map<FieldId, { severity: IssueSeverity; message: string }[]>()

  const addFieldIssue = (fieldId: FieldId, severity: IssueSeverity, message: string, key: string) => {
    issues.push({ id: `field:${fieldId}:${key}`, severity, target: { kind: 'field', fieldId }, message })
    const list = fieldMessages.get(fieldId) ?? []
    list.push({ severity, message })
    fieldMessages.set(fieldId, list)
  }

  // ── Fields ──
  for (const fieldId of snapshot.fieldOrder) {
    const field = snapshot.fields[fieldId]
    if (!field) {
      issues.push({ id: `field:${fieldId}:undeclared`, severity: 'error', target: { kind: 'field', fieldId }, message: `Field order lists “${fieldId}”, which is not defined.` })
      continue
    }
    if (field.id !== fieldId) {
      addFieldIssue(fieldId, 'error', `Field is stored under “${fieldId}” but declares ID “${field.id}”.`, 'id-mismatch')
    }

    const { state } = field
    if (state.status === 'missing') {
      if (field.required) addFieldIssue(fieldId, 'missing', `${field.label} is required and has not been supplied.`, 'missing')
    } else if (state.status === 'not-applicable') {
      const rule = NOT_APPLICABLE_RULES[state.rule]
      if (!rule) {
        addFieldIssue(fieldId, 'error', `Marked not applicable under an unknown rule “${state.rule}”.`, 'na-unknown')
      } else if (!rule.holds(snapshot)) {
        addFieldIssue(fieldId, 'error', `Marked not applicable, but the condition does not hold: ${rule.description}`, 'na-violated')
      }
    } else {
      valueProblems(field, snapshot).forEach((message, i) => addFieldIssue(fieldId, 'error', message, `value-${i}`))
    }
  }

  // Applicability fields say a rate is needed; a rate marked N/A then contradicts them (caught above).
  // Here: a rate supplied while applicability says it doesn't apply is a contradiction too.
  if (snapshot.kind === 'invoice') {
    const pairs: [FieldId, FieldId, string, string][] = [
      [INVOICE_FIELDS.taxApplicability, INVOICE_FIELDS.taxRate, 'exempt', 'A tax rate is supplied, but the invoice is marked tax-exempt.'],
      [INVOICE_FIELDS.discountApplicability, INVOICE_FIELDS.discountRate, 'none', 'A discount rate is supplied, but the invoice is marked as having no discount.'],
    ]
    for (const [applicabilityId, rateId, offOption, message] of pairs) {
      if (choiceOf(snapshot, applicabilityId) === offOption && snapshot.fields[rateId]?.state.status === 'provided') {
        addFieldIssue(rateId, 'error', message, 'contradiction')
      }
    }

    const issue = snapshot.fields[INVOICE_FIELDS.issueDate]?.state
    const due = snapshot.fields[INVOICE_FIELDS.dueDate]?.state
    if (issue?.status === 'provided' && due?.status === 'provided' && issue.value.type === 'date' && due.value.type === 'date'
      && isRealDate(issue.value.iso) && isRealDate(due.value.iso) && due.value.iso < issue.value.iso) {
      addFieldIssue(INVOICE_FIELDS.dueDate, 'warning', 'Due date is before the invoice date.', 'due-before-issue')
    }
  }

  // ── Blocks ──
  const citationIds = new Set(snapshot.citations.map((c) => c.id))
  const checkCitations = (blockId: BlockId, ids: readonly CitationId[] | undefined) => {
    for (const id of ids ?? []) {
      if (!citationIds.has(id)) {
        issues.push({ id: `block:${blockId}:cite:${id}`, severity: 'error', target: { kind: 'block', blockId }, message: `Cites “${id}”, which is not in the source list. Sources are never invented to fill a gap.` })
      }
    }
  }

  const seenBlockIds = new Set<BlockId>()
  let hasSourceList = false
  for (const block of snapshot.blocks) {
    if (seenBlockIds.has(block.id)) {
      issues.push({ id: `block:${block.id}:duplicate`, severity: 'error', target: { kind: 'block', blockId: block.id }, message: `Block ID “${block.id}” is used more than once.` })
    }
    seenBlockIds.add(block.id)

    switch (block.type) {
      case 'paragraph':
      case 'callout':
        block.runs.forEach((run) => checkCitations(block.id, run.citationIds))
        break
      case 'list':
        block.items.forEach((item) => item.forEach((run) => checkCitations(block.id, run.citationIds)))
        break
      case 'table':
        checkCitations(block.id, block.citationIds)
        break
      case 'image':
        checkCitations(block.id, block.citationIds)
        if (/^https?:/i.test(block.asset.src)) {
          issues.push({ id: `block:${block.id}:remote`, severity: 'error', target: { kind: 'block', blockId: block.id }, message: 'Image points at a remote URL. Fixture assets must be local.' })
        }
        if (block.asset.alt.trim() === '') {
          issues.push({ id: `block:${block.id}:alt`, severity: 'error', target: { kind: 'block', blockId: block.id }, message: 'Image has no alternative text.' })
        }
        break
      case 'chart':
        checkCitations(block.id, block.citationIds)
        if (!block.unit.trim()) issues.push({ id: `block:${block.id}:unit`, severity: 'error', target: { kind: 'block', blockId: block.id }, message: 'Chart has no unit.' })
        if (!block.dataSummary.trim()) issues.push({ id: `block:${block.id}:summary`, severity: 'error', target: { kind: 'block', blockId: block.id }, message: 'Chart has no data summary; colour alone cannot carry the data.' })
        break
      case 'line-items':
        for (const [index, item] of block.items.entries()) {
          const target = { kind: 'line-item' as const, blockId: block.id, itemId: item.id }
          // D-60: an unstated description is an unknown (missing); a supplied but blank one is malformed (error).
          if (item.description === null) issues.push({ id: `line:${item.id}:description`, severity: 'missing', target, message: `Description for line ${index + 1} has not been supplied.` })
          else if (!item.description.trim()) issues.push({ id: `line:${item.id}:description`, severity: 'error', target, message: 'Line item has no description.' })
          if (!Number.isSafeInteger(item.quantityMilli) || item.quantityMilli <= 0) issues.push({ id: `line:${item.id}:quantity`, severity: 'error', target, message: 'Quantity must be greater than zero.' })
          if (item.unitPrice === null) issues.push({ id: `line:${item.id}:price`, severity: 'missing', target, message: `Unit price for ${lineName(item, index)} has not been supplied.` })
          else if (snapshot.kind === 'invoice' && choiceCurrency(snapshot) && item.unitPrice.currency !== choiceCurrency(snapshot)) {
            issues.push({ id: `line:${item.id}:currency`, severity: 'error', target, message: `Priced in ${item.unitPrice.currency}; this invoice is in ${choiceCurrency(snapshot)}.` })
          }
        }
        break
      case 'source-list':
        hasSourceList = true
        break
    }
  }

  if (snapshot.citations.length > 0 && !hasSourceList) {
    issues.push({ id: 'document:no-source-list', severity: 'warning', target: { kind: 'document' }, message: 'The document cites sources but has no source list.' })
  }
  for (const citation of snapshot.citations) {
    if (!citation.fictional) {
      issues.push({ id: `citation:${citation.id}:real`, severity: 'error', target: { kind: 'citation', citationId: citation.id }, message: 'Fixture citations must be marked fictional.' })
    }
  }

  // ── Derived totals ──
  if (snapshot.kind === 'invoice') {
    const totalsBlock = snapshot.blocks.find((b) => b.type === 'totals')
    const totals = computeInvoiceTotals(snapshot)
    if (totalsBlock && !totals.total.known) {
      const why = totals.total.reasons.map((r) => r.message).join(' ')
      issues.push({ id: 'totals:incomplete', severity: 'missing', target: { kind: 'block', blockId: totalsBlock.id }, message: `Total is incomplete and cannot be final. ${why}` })
    }
  }

  // ── Reports ──
  const fields: Record<FieldId, FieldReport> = {}
  for (const fieldId of snapshot.fieldOrder) {
    const field = snapshot.fields[fieldId]
    if (!field) continue
    const found = (fieldMessages.get(fieldId) ?? []).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    fields[fieldId] = {
      fieldId,
      status: field.state.status,
      required: field.required,
      messages: found.map((m) => m.message),
      severity: found[0]?.severity ?? null,
    }
  }

  const readiness: Readiness = issues.some((i) => i.severity === 'error')
    ? 'invalid'
    : issues.some((i) => i.severity === 'missing') ? 'incomplete' : 'ready'

  return { fields, issues, readiness }
}
