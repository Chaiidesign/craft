// Revision sample data (fixtures 6, 7, 8 and the two approved proposals).
// Proposals are fictional sample edits — no AI. They are not applied content
// until accepted.

import type { BoundedEdit, Proposal } from '../revisions'
import type { OutputId, RevisionId } from '../model'
import { text } from './builders'

/** Fictional reviewer for the mock approval marker (fixture 7). */
export const SAMPLE_REVIEWER = 'Sample reviewer (fictional)'

export interface ProposalTemplate {
  proposalId: string
  /** Document fixture the proposal is written against. */
  fixtureId: string
  title: string
  edit: BoundedEdit
}

export const PROPOSAL_TEMPLATES: readonly ProposalTemplate[] = [
  {
    proposalId: 'prop-invoice-payment-terms',
    fixtureId: 'invoice-complete',
    title: 'Clearer payment terms',
    edit: { kind: 'field', fieldId: 'payment.terms', value: text('Payment due within 30 days by bank transfer to the account on the remittance slip.') },
  },
  {
    proposalId: 'prop-brief-evidence-sentence',
    fixtureId: 'brief-evidence',
    title: 'Tighter evidence sentence',
    // Same facts (8 of 112, 15 of 109) and the same citation; fewer words.
    edit: { kind: 'text', blockId: 'blk-evidence-2', run: 0, text: 'In a two-arm test, fewer members cancelled in their first month after a welcome email explaining how books are chosen (8 of 112) than without it (15 of 109)' },
  },
]

/** Binds a proposal template to the exact revision it was written against. */
export function proposalFrom(template: ProposalTemplate, outputId: OutputId, baseRevisionId: RevisionId): Proposal {
  return { proposalId: template.proposalId, outputId, baseRevisionId, title: template.title, edit: template.edit, fictional: true }
}

/** Workbench output IDs for document fixtures. */
export const outputIdFor = (fixtureId: string) => `out-${fixtureId}`
