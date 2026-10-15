// The validation gate (D-49). Three layers, in order, the same for every caller:
//   1. the generation schema (ops.ts) — shape and types, nothing else runs on a malformed proposal;
//   2. structural checks while applying (apply.ts) — targets, digests, values, quotes;
//   3. craft's own validation (validation.ts) plus the stated-amount check.
// Only an invalid document is refused. Missing facts pass as explicit unknowns.

import type { z } from 'zod'

import { computeInvoiceTotals } from '../invoice'
import type { InvoiceSnapshot } from '../model'
import { parseMoneyInput } from '../money'
import { validateSnapshot, type ValidationReport } from '../validation'
import { applyOperations, normaliseQuote, type ApplyContext } from './apply'
import { digest } from './digest'
import { gateError, type GateError } from './errors'
import { GENERATABLE_KINDS, OperationSchema, ProposalSchema, type Operation, type Proposal } from './ops'
import { moneyToDecimal } from './view'

export type GateResult =
  | { ok: true; snapshot: InvoiceSnapshot; targets: string[]; report: ValidationReport }
  | { ok: false; errors: GateError[] }

function schemaErrors(error: z.ZodError, prefix = ''): GateError[] {
  return error.issues.map((issue) => {
    const path = [prefix, ...issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`))].join('').replace(/^\./, '')
    return gateError('schema', path || '(root)', issue.message)
  })
}

/** Layers 2 and 3 for operations that already passed the schema. */
function check(base: InvoiceSnapshot, operations: readonly Operation[], ctx: ApplyContext, statedAmount: Proposal['statedAmount'], pathPrefix: string): GateResult {
  const applied = applyOperations(base, operations, ctx, pathPrefix)
  if (!applied.ok) return applied
  const { snapshot } = applied
  // Provenance alone is not a change: the same value quoted differently leaves the document as it was.
  if (ctx.revising && digest({ ...snapshot, provenance: undefined }) === digest({ ...base, provenance: undefined })) {
    return { ok: false, errors: [gateError('no-change', pathPrefix, 'These operations leave the document exactly as it was; nothing was saved.')] }
  }

  const errors: GateError[] = []
  const report = validateSnapshot(snapshot)
  for (const issue of report.issues) {
    if (issue.severity !== 'error') continue
    const target = issue.target.kind === 'field' ? `field:${issue.target.fieldId}` : issue.target.kind === 'line-item' ? `line:${issue.target.itemId}` : undefined
    errors.push(gateError('semantic', issue.id, issue.message, target))
  }

  // The line items must add up to an amount the request states. When tax or discount is still
  // unknown, the total is unknown too, so the only checkable claim is the subtotal.
  if (statedAmount) {
    const totals = computeInvoiceTotals(snapshot)
    const compared = totals.total.known ? totals.total : totals.subtotal
    const label = totals.total.known ? 'total' : 'line items'
    if (!normaliseQuote(ctx.sourceText).includes(normaliseQuote(statedAmount.evidence))) {
      errors.push(gateError('evidence-not-found', 'statedAmount.evidence', `“${statedAmount.evidence}” is not in the request.`))
    } else if (!compared.known) {
      errors.push(gateError('sum-mismatch', 'statedAmount', `The request states ${statedAmount.amount}, but the line items have no known sum (a price or the currency is missing).`))
    } else {
      const stated = parseMoneyInput(statedAmount.amount, compared.money.currency)
      if (!stated.ok) errors.push(gateError('invalid-value', 'statedAmount.amount', stated.message))
      else if (stated.money.amountMinor !== compared.money.amountMinor) {
        errors.push(gateError('sum-mismatch', 'statedAmount', `The request states ${statedAmount.amount}, but the ${label} come to ${moneyToDecimal(compared.money)}.`))
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, snapshot, targets: applied.targets, report }
}

/** Gate a model's proposal. `raw` is whatever the model returned; nothing is trusted until layer 1 passes. */
export function gateProposal(base: InvoiceSnapshot, raw: unknown, ctx: ApplyContext): GateResult & { proposal?: Proposal } {
  const parsed = ProposalSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: schemaErrors(parsed.error) }
  const proposal = parsed.data
  if (proposal.intent.docType === 'other') {
    return { ok: false, errors: [gateError('unsupported-type', 'intent.docType', `This generator makes ${GENERATABLE_KINDS.join(', ')}s only so far; “${proposal.intent.summary}” is not one.`, undefined, false)], proposal }
  }
  if (proposal.intent.docType !== base.kind) {
    return { ok: false, errors: [gateError('wrong-kind', 'intent.docType', `This is a ${base.kind}; the proposal is for a ${proposal.intent.docType}.`)] }
  }
  return { ...check(base, proposal.operations, ctx, proposal.statedAmount, 'operations'), proposal }
}

/** Gate operations a caller supplies directly (agents, scripts): the same layers, without a model. */
export function gateOperations(base: InvoiceSnapshot, raw: unknown, ctx: ApplyContext): GateResult {
  const parsed = OperationSchema.array().max(60).safeParse(raw)
  if (!parsed.success) return { ok: false, errors: schemaErrors(parsed.error, 'operations') }
  return check(base, parsed.data, ctx, null, 'operations')
}
