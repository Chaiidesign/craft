// The generation schema (P0 "constrained generation"): every change a model or
// an agent can make to a document is one of these operations. The schema is
// exhaustive and checked at runtime before anything else (gate layer 1); only
// then do the structural checks and craft's own validation run.
//
// Values are written the way people and models write them (decimal strings for
// money and percentages); the host converts them to the engine's integer units,
// so a model never does minor-unit arithmetic.

import { z } from 'zod'

import { COMMERCIAL_KINDS, INVOICE_FIELDS } from '../invoice'

const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'INR', 'JPY'] as const

/** Documents the generator can make now (D-59 widens this slice by slice; the quote, purchase order and receipt share the invoice's fields). */
export const GENERATABLE_KINDS = COMMERCIAL_KINDS
export type GeneratableKind = (typeof GENERATABLE_KINDS)[number]

export const INVOICE_FIELD_IDS = Object.values(INVOICE_FIELDS) as [string, ...string[]]

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'Write a plain decimal such as 2400 or 2400.50, with no symbols or separators.')

/** A quote from what the person wrote. The gate checks it is really there. */
const PromptProvenance = z.object({
  source: z.literal('prompt'),
  evidence: z.string().min(1).max(200).describe('The exact words from the request that state this value, copied verbatim.'),
}).strict()

/** Supplied directly by an agent or script through the tool surface. Models may not use it. */
const CallerProvenance = z.object({ source: z.literal('caller') }).strict()

export const ProvenanceSchema = z.discriminatedUnion('source', [PromptProvenance, CallerProvenance])

export const ValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(300) }).strict(),
  z.object({ type: z.literal('multiline'), lines: z.array(z.string().min(1).max(120)).min(1).max(8) }).strict(),
  z.object({ type: z.literal('date'), iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.') }).strict(),
  z.object({ type: z.literal('money'), amount: decimal, currency: z.enum(CURRENCY_CODES) }).strict(),
  z.object({ type: z.literal('currency'), code: z.enum(CURRENCY_CODES) }).strict(),
  z.object({ type: z.literal('percent'), percent: decimal.describe('Percentage, e.g. 8.25 for 8.25%.') }).strict(),
  z.object({ type: z.literal('choice'), option: z.string().min(1) }).strict(),
])
export type GenerationValue = z.infer<typeof ValueSchema>

const fieldId = z.enum(INVOICE_FIELD_IDS)
const digestRef = z.string().regex(/^[0-9a-f]{8}$/).describe('The digest shown for this target in the current document. Required when revising.')
const unitPrice = z.object({ amount: decimal }).strict().nullable().describe('null when the price was not stated.')

export const OperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('setField'),
    fieldId,
    value: ValueSchema,
    provenance: ProvenanceSchema,
    expectedDigest: digestRef.optional(),
  }).strict(),
  z.object({
    op: z.literal('markUnknown'),
    fieldId,
    expectedDigest: digestRef.optional(),
  }).strict().describe('Leave a field explicitly not supplied. Use it instead of guessing.'),
  z.object({
    op: z.literal('setNotApplicable'),
    fieldId: z.enum([INVOICE_FIELDS.taxRate, INVOICE_FIELDS.discountRate]),
    expectedDigest: digestRef.optional(),
  }).strict().describe('Only for a rate whose applicability says there is none (tax exempt, no discount).'),
  z.object({
    op: z.literal('addLineItem'),
    description: z.string().min(1).max(200).nullable().describe('null when the request does not say what the line is for.'),
    quantity: decimal.describe('1 for a single charge.'),
    unit: z.string().min(1).max(20).optional(),
    unitPrice,
    provenance: ProvenanceSchema,
  }).strict(),
  z.object({
    op: z.literal('updateLineItem'),
    itemId: z.string().min(1),
    expectedDigest: digestRef,
    description: z.string().min(1).max(200).nullable().optional(),
    quantity: decimal.optional(),
    unit: z.string().min(1).max(20).nullable().optional(),
    unitPrice: unitPrice.optional(),
    provenance: ProvenanceSchema,
  }).strict(),
  z.object({
    op: z.literal('removeLineItem'),
    itemId: z.string().min(1),
    expectedDigest: digestRef,
  }).strict(),
])
export type Operation = z.infer<typeof OperationSchema>

/** An amount the request states for the whole invoice; the gate checks the line items add up to it. */
export const StatedAmountSchema = z.object({
  amount: decimal,
  evidence: z.string().min(1).max(200),
}).strict()

/** The intent, compiled from the request (pipeline step 1). Audience and detail are separate choices. */
export const IntentSchema = z.object({
  docType: z.enum([...GENERATABLE_KINDS, 'other']).describe('"other" when the request is for a kind of document this generator cannot make yet; then propose no operations.'),
  audience: z.enum(['recipient', 'internal']),
  summary: z.string().min(1).max(200).describe('One line: what this document is.'),
}).strict()

/** One proposal from a model: the intent, the operations, and at most one follow-up question for the person. */
export const ProposalSchema = z.object({
  intent: IntentSchema,
  statedAmount: StatedAmountSchema.nullable().describe('The total the request states, if it states one.'),
  operations: z.array(OperationSchema).max(60),
  followUp: z.string().min(1).max(240).nullable().describe('One short question about the most important missing fact, or null.'),
}).strict()
export type Proposal = z.infer<typeof ProposalSchema>

/** JSON Schema of a proposal, for model tool definitions and agent tool schemas. */
export const proposalJsonSchema = () => z.toJSONSchema(ProposalSchema, { target: 'draft-7' })
export const operationsJsonSchema = () => z.toJSONSchema(z.array(OperationSchema).max(60), { target: 'draft-7' })
