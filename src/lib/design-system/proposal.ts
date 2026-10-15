// ── Token proposal: what an extractor claims it saw ───────────────────────────
// Every token carries its value (or null when the image didn't show it), how
// sure the extractor is, and what it assumed. Nothing here is applied: a
// proposal becomes a design system only after a person resolves every flagged
// or missing token (see review.ts).

import { z } from 'zod'
import { TOKEN_FIELDS, formatIssues, type ParseResult, type TokenPath } from './tokens'

export const CONFIDENCE = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCE)[number]

const assumption = z.string().trim().min(1).max(280)

function proposedToken(valueSchema: z.ZodType) {
  return z
    .strictObject({
      /** null = the image didn't show this token. Never a guessed default. */
      value: z.union([valueSchema, z.null()]),
      confidence: z.enum(CONFIDENCE),
      /** What the extractor assumed to arrive at the value, or why it has none. */
      assumption,
    })
    .refine((t) => t.value !== null || t.confidence === 'low', {
      message: 'A token with no value must be marked low confidence',
    })
}

const tokensShape = Object.fromEntries(TOKEN_FIELDS.map((f) => [f.path, proposedToken(f.schema)]))

export const proposalSchema = z.strictObject({
  /** Which extractor produced this, e.g. "mock-v1". */
  extractor: z.string().min(1).max(64),
  image: z.strictObject({
    name: z.string().min(1).max(200),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /** One-line description of what the extractor took the image to be. */
  summary: z.string().trim().min(1).max(280),
  /** Assumptions that apply to the whole image, e.g. the pixel density. */
  assumptions: z.array(assumption).max(10),
  /** Every token path must be present; a missing key is malformed output. */
  tokens: z.strictObject(tokensShape),
})

export interface ProposedToken {
  value: unknown
  confidence: Confidence
  assumption: string
}

export interface TokenProposal {
  extractor: string
  image: { name: string; width: number; height: number }
  summary: string
  assumptions: string[]
  tokens: Record<TokenPath, ProposedToken>
}

export function parseProposal(input: unknown): ParseResult<TokenProposal> {
  const result = proposalSchema.safeParse(input)
  return result.success
    ? { ok: true, value: result.data as unknown as TokenProposal }
    : { ok: false, issues: formatIssues(result.error) }
}

/** Low confidence with a value: shown to the person to confirm or correct. */
export function isFlagged(token: ProposedToken): boolean {
  return token.value !== null && token.confidence === 'low'
}

/** No value: the person must supply one before anything is applied. */
export function isMissing(token: ProposedToken): boolean {
  return token.value === null
}
