// ── Review: from a proposal to an applied design system ──────────────────────
// A pure reducer for the pipeline's stages:
//   idle → analyzing → reviewing ⇄ applied     (analyzing → failed on error)
// Nothing is applied automatically. While reviewing, every token shows its
// value, confidence and assumption. A low-confidence token stays "flagged"
// until a person confirms or edits it; a missing one stays "missing" until a
// person supplies a value. Apply is refused while any remain, and the result
// must pass the full token schema. Edits are validated as they're made.

import type { ExtractionError } from './extractor'
import { isFlagged, isMissing, type TokenProposal } from './proposal'
import { parseTokenInput } from './token-format'
import { nestTokens, parseDesignTokens, TOKEN_PATHS, type DesignTokens, type TokenPath } from './tokens'

export type TokenStatus =
  /** High or medium confidence, shown and applied as proposed unless edited. */
  | 'proposed'
  /** Low confidence: must be confirmed or edited before apply. */
  | 'flagged'
  /** No value: must be supplied before apply. */
  | 'missing'
  /** Was flagged; a person confirmed the proposed value. */
  | 'confirmed'
  /** A person changed the value. */
  | 'edited'

export interface ReviewToken {
  value: unknown
  status: TokenStatus
  /** Why the last edit was refused; the value kept is the previous one. */
  error?: string
}

export interface ImageInfo {
  name: string
  /** An object URL or public path, for showing the image next to the review. */
  previewUrl: string
}

export type PipelineState =
  | { stage: 'idle' }
  | { stage: 'analyzing'; image: ImageInfo }
  | { stage: 'failed'; image: ImageInfo; error: ExtractionError }
  | {
      stage: 'reviewing'
      image: ImageInfo
      proposal: TokenProposal
      tokens: Record<TokenPath, ReviewToken>
      /** Why the last apply was refused. */
      applyIssues: string[]
    }
  | {
      stage: 'applied'
      image: ImageInfo
      proposal: TokenProposal
      tokens: Record<TokenPath, ReviewToken>
      applied: DesignTokens
    }

export type PipelineAction =
  | { type: 'analyze'; image: ImageInfo }
  | { type: 'cancel' }
  | { type: 'extracted'; proposal: TokenProposal }
  | { type: 'extractionFailed'; error: ExtractionError }
  | { type: 'edit'; path: TokenPath; input: string }
  | { type: 'clearError'; path: TokenPath }
  | { type: 'confirm'; path: TokenPath }
  | { type: 'revert'; path: TokenPath }
  | { type: 'apply' }
  | { type: 'reopen' }
  | { type: 'reset' }

export const initialPipelineState: PipelineState = { stage: 'idle' }

export function initialStatus(proposal: TokenProposal, path: TokenPath): TokenStatus {
  const token = proposal.tokens[path]
  if (isMissing(token)) return 'missing'
  if (isFlagged(token)) return 'flagged'
  return 'proposed'
}

function startReview(proposal: TokenProposal): Record<TokenPath, ReviewToken> {
  return Object.fromEntries(
    TOKEN_PATHS.map((path) => [path, { value: proposal.tokens[path].value, status: initialStatus(proposal, path) }]),
  ) as Record<TokenPath, ReviewToken>
}

/** Tokens that block apply, in display order. */
export function unresolved(tokens: Record<TokenPath, ReviewToken>): TokenPath[] {
  return TOKEN_PATHS.filter((p) => tokens[p].status === 'flagged' || tokens[p].status === 'missing')
}

/** The complete token set the review currently describes, if it is one. */
export function resolveTokens(tokens: Record<TokenPath, ReviewToken>): { ok: true; value: DesignTokens } | { ok: false; issues: string[] } {
  const blocking = unresolved(tokens)
  if (blocking.length > 0) {
    return {
      ok: false,
      issues: blocking.map((p) =>
        tokens[p].status === 'missing' ? `${p}: needs a value — the image didn’t show it` : `${p}: low confidence — confirm or edit it`,
      ),
    }
  }
  const values = Object.fromEntries(TOKEN_PATHS.map((p) => [p, tokens[p].value])) as Record<TokenPath, unknown>
  return parseDesignTokens(nestTokens(values))
}

function updateToken(
  state: Extract<PipelineState, { stage: 'reviewing' }>,
  path: TokenPath,
  next: ReviewToken,
): PipelineState {
  return { ...state, tokens: { ...state.tokens, [path]: next }, applyIssues: [] }
}

export function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  switch (action.type) {
    case 'analyze':
      return state.stage === 'analyzing' ? state : { stage: 'analyzing', image: action.image }

    case 'cancel':
      return state.stage === 'analyzing' ? { stage: 'idle' } : state

    case 'extracted':
      // A late result after cancel or reset is dropped.
      if (state.stage !== 'analyzing') return state
      return { stage: 'reviewing', image: state.image, proposal: action.proposal, tokens: startReview(action.proposal), applyIssues: [] }

    case 'extractionFailed':
      if (state.stage !== 'analyzing') return state
      return { stage: 'failed', image: state.image, error: action.error }

    case 'edit': {
      if (state.stage !== 'reviewing') return state
      const current = state.tokens[action.path]
      const parsed = parseTokenInput(action.path, action.input)
      if (!parsed.ok) return updateToken(state, action.path, { ...current, error: parsed.issues.join('; ') })
      return updateToken(state, action.path, { value: parsed.value, status: 'edited' })
    }

    case 'clearError': {
      if (state.stage !== 'reviewing' || !state.tokens[action.path].error) return state
      const { value, status } = state.tokens[action.path]
      return updateToken(state, action.path, { value, status })
    }

    case 'confirm': {
      if (state.stage !== 'reviewing') return state
      const current = state.tokens[action.path]
      if (current.status !== 'flagged') return state
      return updateToken(state, action.path, { value: current.value, status: 'confirmed' })
    }

    case 'revert': {
      if (state.stage !== 'reviewing') return state
      const proposed = state.proposal.tokens[action.path]
      return updateToken(state, action.path, { value: proposed.value, status: initialStatus(state.proposal, action.path) })
    }

    case 'apply': {
      if (state.stage !== 'reviewing') return state
      const resolved = resolveTokens(state.tokens)
      if (!resolved.ok) return { ...state, applyIssues: resolved.issues }
      return { stage: 'applied', image: state.image, proposal: state.proposal, tokens: state.tokens, applied: resolved.value }
    }

    case 'reopen':
      if (state.stage !== 'applied') return state
      return { stage: 'reviewing', image: state.image, proposal: state.proposal, tokens: state.tokens, applyIssues: [] }

    case 'reset':
      return initialPipelineState
  }
}

// ── Contrast: warned, never blocking ─────────────────────────────────────────

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const CONTRAST_PAIRS: [TokenPath, TokenPath, string][] = [
  ['color.text', 'color.background', 'Text on the page background'],
  ['color.text', 'color.surface', 'Text on cards'],
  ['color.textMuted', 'color.surface', 'Muted text on cards'],
  ['color.onPrimary', 'color.primary', 'Text on primary buttons'],
]

/** Pairs below WCAG AA for body text (4.5:1). Shown to the person; apply isn't blocked,
 *  because the source design may be deliberately low-contrast. */
export function contrastWarnings(tokens: Record<TokenPath, ReviewToken>): string[] {
  const warnings: string[] = []
  for (const [fg, bg, label] of CONTRAST_PAIRS) {
    const a = tokens[fg].value
    const b = tokens[bg].value
    if (typeof a !== 'string' || typeof b !== 'string') continue
    const ratio = contrastRatio(a, b)
    if (ratio < 4.5) warnings.push(`${label}: ${ratio.toFixed(1)}:1, below the 4.5:1 minimum for body text.`)
  }
  return warnings
}
