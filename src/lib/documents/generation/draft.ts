// The live "drafting" preview (S1 step 5). While a proposal streams in, every
// operation that is already complete is applied to a draft copy of the base
// document with the same checks the gate uses, so the preview fills in as the
// model writes. A draft is display-only: it is never saved, and an operation
// that fails a check is simply not shown. Only the gated result becomes a revision.

import type { InvoiceSnapshot } from '../model'
import { applyOperations, type ApplyContext } from './apply'
import { OperationSchema } from './ops'

export interface Draft {
  snapshot: InvoiceSnapshot
  /** Operations shown so far. */
  applied: number
}

export function draftFromPartial(base: InvoiceSnapshot, partial: unknown, ctx: ApplyContext): Draft {
  const operations = (partial as { operations?: unknown } | null)?.operations
  if (!Array.isArray(operations)) return { snapshot: base, applied: 0 }
  let snapshot = base
  let applied = 0
  for (const raw of operations) {
    const parsed = OperationSchema.safeParse(raw)
    if (!parsed.success) continue
    const result = applyOperations(snapshot, [parsed.data], ctx)
    if (!result.ok) continue
    snapshot = result.snapshot
    applied++
  }
  return { snapshot, applied }
}
