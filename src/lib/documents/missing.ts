// The facts a document still lacks, in the words the document uses: shown under
// a document card ("Not provided yet") and in what Souvenir says about it.

import { INVOICE_FIELDS } from './invoice'
import type { DocumentSnapshot } from './model'

/** Rates that only matter once their applicability is known to be "applies". */
const RATE_OF: Readonly<Record<string, { applicability: string; on: string }>> = {
  [INVOICE_FIELDS.taxRate]: { applicability: INVOICE_FIELDS.taxApplicability, on: 'applicable' },
  [INVOICE_FIELDS.discountRate]: { applicability: INVOICE_FIELDS.discountApplicability, on: 'percent' },
}

/**
 * Labels of the facts still missing: required fields, then line items with no description.
 * A rate is left out until its applicability says it applies, so the list asks for one thing at a time.
 */
export function notProvided(snapshot: DocumentSnapshot): string[] {
  const applies = (id: string) => {
    const rate = RATE_OF[id]
    if (!rate) return true
    const state = snapshot.fields[rate.applicability]?.state
    return state?.status === 'provided' && state.value.type === 'choice' && state.value.option === rate.on
  }
  const fields = snapshot.fieldOrder.filter((id) => snapshot.fields[id].required && snapshot.fields[id].state.status === 'missing' && applies(id)).map((id) => snapshot.fields[id].label)
  const items = snapshot.blocks.flatMap((b) => (b.type === 'line-items' ? b.items : []))
  const lines = items.flatMap((item, i) => (item.description === null ? [`Line ${i + 1} description`] : []))
  return [...fields, ...lines]
}
