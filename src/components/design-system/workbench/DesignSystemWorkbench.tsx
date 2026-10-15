'use client'

// ── Image → design system workbench ───────────────────────────────────────────
// The visible pipeline: pick an image → it's analyzed → every proposed token
// is shown with its confidence and assumption → the person confirms, edits or
// fills tokens → only then is the design system applied to the chat artifact
// block. The page chrome uses the app's own styles; everything inside a
// ThemeScope renders from the extracted tokens only.

import React, { useEffect, useReducer, useRef, useState } from 'react'
import { SOUVENIR_BASELINE } from '@/lib/design-system/baseline'
import { IMAGE_TYPES, runExtraction, type DesignImage } from '@/lib/design-system/extractor'
import { createMockExtractor, SAMPLE_IMAGES } from '@/lib/design-system/mock-extractor'
import {
  contrastWarnings,
  initialPipelineState,
  pipelineReducer,
  resolveTokens,
  unresolved,
  type ImageInfo,
  type PipelineState,
  type ReviewToken,
} from '@/lib/design-system/review'
import { FORMAT_HINT, formatTokenValue, tokenKind } from '@/lib/design-system/token-format'
import { nestTokens, parseDesignTokens, TOKEN_FIELDS, TOKEN_PATHS, type DesignTokens, type TokenGroup, type TokenPath } from '@/lib/design-system/tokens'
import type { TokenProposal } from '@/lib/design-system/proposal'
import { ThemeScope } from '../primitives'
import { PrimitiveGallery } from '../PrimitiveGallery'
import { ThreadPreview } from '../ThreadPreview'

/** Long enough that the "Analyzing" stage is visible; the mock itself is instant. */
const ANALYSIS_LATENCY_MS = 900

const extractor = createMockExtractor({ latencyMs: ANALYSIS_LATENCY_MS })

const GROUP_LABEL: Record<TokenGroup, string> = {
  color: 'Color',
  font: 'Fonts',
  type: 'Text styles',
  space: 'Spacing',
  radius: 'Corner radius',
  shadow: 'Shadows',
  size: 'Sizes',
}

const STAGES = ['Image', 'Analyzed', 'Review tokens', 'Applied'] as const

function stageIndex(state: PipelineState): number {
  switch (state.stage) {
    case 'idle':
      return 0
    case 'analyzing':
    case 'failed':
      return 1
    case 'reviewing':
      return 2
    case 'applied':
      return 3
  }
}

// ── Chrome styles (app tokens, not the extracted system) ─────────────────────

const CHROME_CSS = `
.dsw { font-family: var(--font-body); color: var(--neutral-800); background: var(--neutral-white); min-height: 100vh; padding: 32px 16px 96px; box-sizing: border-box; }
.dsw *:not([data-ds-scope] *) { box-sizing: border-box; }
.dsw-inner { max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
.dsw h1:not([data-ds-scope] *) { font-size: 24px; line-height: 32px; font-weight: 600; margin: 0; }
.dsw h2:not([data-ds-scope] *) { font-size: 16px; line-height: 24px; font-weight: 600; margin: 0; }
.dsw h3:not([data-ds-scope] *) { font-size: 13px; line-height: 20px; font-weight: 600; margin: 0; text-transform: uppercase; letter-spacing: 0.04em; color: var(--neutral-500); }
.dsw p:not([data-ds-scope] *) { margin: 0; font-size: 14px; line-height: 22px; }
.dsw-muted { color: var(--neutral-500); }
.dsw-small { font-size: 12px !important; line-height: 18px !important; }
.dsw-panel { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 0 0 1px var(--neutral-100), 0 1px 2px rgba(0,0,0,.04); display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dsw-rail { display: flex; gap: 8px; list-style: none; padding: 0; margin: 0; flex-wrap: wrap; }
.dsw-rail li { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; padding: 6px 12px; border-radius: 999px; background: #fff; box-shadow: 0 0 0 1px var(--neutral-100); color: var(--neutral-500); }
.dsw-rail li[data-state="done"] { color: var(--neutral-800); }
.dsw-rail li[data-state="current"] { color: #fff; background: var(--neutral-800); box-shadow: none; }
.dsw-rail .num { font-variant-numeric: tabular-nums; font-weight: 600; }
.dsw-samples { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.dsw-sample { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 12px; border: 1px solid var(--neutral-100); background: #fff; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.dsw-sample:hover { border-color: var(--neutral-400); }
.dsw-sample img { width: 100%; height: auto; border-radius: 8px; display: block; aspect-ratio: 640 / 420; }
.dsw-sample span { font-size: 13px; line-height: 20px; font-weight: 500; padding: 0 4px 4px; }
.dsw-btn { font: inherit; font-size: 14px; line-height: 20px; font-weight: 500; padding: 8px 16px; border-radius: 10px; border: 1px solid var(--neutral-100); background: #fff; color: var(--neutral-800); cursor: pointer; white-space: nowrap; }
.dsw-btn:hover:not(:disabled) { border-color: var(--neutral-400); }
.dsw-btn[data-primary] { background: var(--neutral-800); color: #fff; border-color: var(--neutral-800); }
.dsw-btn:disabled { opacity: .45; cursor: not-allowed; }
.dsw-btn-sm { padding: 4px 10px; font-size: 12px; line-height: 18px; border-radius: 8px; }
.dsw :focus-visible:not([data-ds-scope] *) { outline: 2px solid #2563eb; outline-offset: 2px; }
.dsw-review { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
@media (max-width: 959px) { .dsw-review > aside { order: -1; } }
@media (min-width: 960px) { .dsw-review { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); } .dsw-sticky { position: sticky; top: 16px; } }
.dsw-compare { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
@media (min-width: 900px) { .dsw-compare { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.dsw-frame { border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px var(--neutral-100); }
.dsw-tokens { display: flex; flex-direction: column; gap: 4px; }
.dsw-tokens, .dsw-tokens * { scroll-margin-bottom: 140px; }
.dsw-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 12px; border-radius: 12px; border: 1px solid transparent; }
.dsw-row[data-status="flagged"] { background: #FFF8E6; border-color: #F2D48A; }
.dsw-row[data-status="missing"] { background: #FDF0EE; border-color: #EDB4AA; }
.dsw-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsw-row-head label { font-size: 14px; line-height: 20px; font-weight: 500; }
.dsw-path { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--neutral-500); }
.dsw-pill { font-size: 11px; line-height: 16px; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--neutral-100); color: var(--neutral-600); }
.dsw-pill[data-status="flagged"] { background: #F7E2A8; color: #6B4E00; }
.dsw-pill[data-status="missing"] { background: #F5C9C1; color: #7A2414; }
.dsw-pill[data-status="confirmed"], .dsw-pill[data-status="edited"] { background: #D7EFDF; color: #1D5C33; }
.dsw-edit { display: flex; gap: 8px; align-items: center; }
.dsw-edit input[type="text"] { flex: 1 1 auto; min-width: 0; font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 20px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--neutral-100); background: #fff; color: var(--neutral-800); }
.dsw-edit input[aria-invalid="true"] { border-color: #C2412D; }
.dsw-swatch { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.dsw-swatch[data-empty] { background: repeating-linear-gradient(45deg, #fff, #fff 4px, var(--neutral-100) 4px, var(--neutral-100) 8px); }
.dsw-error { color: #A3301F; font-size: 12px; line-height: 18px; }
.dsw-assume { font-size: 12px; line-height: 18px; color: var(--neutral-600); }
.dsw-assume b { font-weight: 500; color: var(--neutral-800); }
.dsw-applybar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; position: sticky; bottom: 0; background: #fff; padding: 12px 0 0; border-top: 1px solid var(--neutral-100); }
.dsw-list { margin: 0; padding-left: 18px; font-size: 13px; line-height: 20px; }
.dsw-banner { padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 20px; }
.dsw-banner[data-tone="warn"] { background: #FFF8E6; color: #5C4300; }
.dsw-banner[data-tone="error"] { background: #FDF0EE; color: #7A2414; }
.dsw pre { margin: 0; font-size: 11px; line-height: 16px; overflow: auto; max-height: 320px; background: var(--neutral-100); padding: 12px; border-radius: 8px; }
.dsw-check { display: flex; gap: 8px; align-items: center; font-size: 13px; line-height: 20px; }
`

// ── Status copy ──────────────────────────────────────────────────────────────

function statusLabel(token: ReviewToken, confidence: string): string {
  switch (token.status) {
    case 'proposed':
      return `Proposed · ${confidence} confidence`
    case 'flagged':
      return 'Low confidence — check this'
    case 'missing':
      return 'Not in the image — needs a value'
    case 'confirmed':
      return 'Confirmed by you'
    case 'edited':
      return 'Edited by you'
  }
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function StageRail({ state }: { state: PipelineState }) {
  const current = stageIndex(state)
  return (
    <ol className="dsw-rail" aria-label="Pipeline stages">
      {STAGES.map((label, i) => {
        const s = i < current ? 'done' : i === current ? 'current' : 'upcoming'
        return (
          <li key={label} data-state={s} aria-current={s === 'current' ? 'step' : undefined}>
            <span className="num">{i < current ? '✓' : i + 1}</span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}

function TokenRow({
  path,
  token,
  proposal,
  onEdit,
  onClearError,
  onConfirm,
  onRevert,
}: {
  path: TokenPath
  token: ReviewToken
  proposal: TokenProposal
  onEdit: (input: string) => void
  onClearError: () => void
  onConfirm: () => void
  onRevert: () => void
}) {
  const field = TOKEN_FIELDS.find((f) => f.path === path)!
  const proposed = proposal.tokens[path]
  const kind = tokenKind(path)
  const formatted = formatTokenValue(path, token.value)
  const [draft, setDraft] = useState(formatted)
  const [lastFormatted, setLastFormatted] = useState(formatted)
  if (formatted !== lastFormatted) {
    // The value changed underneath (revert, accepted edit): show it.
    setLastFormatted(formatted)
    setDraft(formatted)
  }
  const inputId = `tok-${path}`
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const commit = () => {
    if (draft.trim() !== formatted) onEdit(draft)
  }

  return (
    <div className="dsw-row" data-status={token.status}>
      <div className="dsw-row-head">
        <label htmlFor={inputId}>{field.label}</label>
        <span className="dsw-path">{path}</span>
        <span className="dsw-pill" data-status={token.status}>
          {statusLabel(token, proposed.confidence)}
        </span>
      </div>
      <div className="dsw-edit">
        {kind === 'color' && (
          <span
            className="dsw-swatch"
            data-empty={typeof token.value === 'string' ? undefined : ''}
            style={typeof token.value === 'string' ? { background: token.value } : undefined}
            aria-hidden="true"
          />
        )}
        <input
          id={inputId}
          type="text"
          value={draft}
          placeholder={token.status === 'missing' ? 'Enter a value' : undefined}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={token.error ? true : undefined}
          aria-describedby={`${hintId}${token.error ? ` ${errorId}` : ''}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(formatted)
              if (token.error) onClearError()
            }
          }}
        />
        {token.status === 'flagged' && (
          <button type="button" className="dsw-btn dsw-btn-sm" onClick={onConfirm}>
            Confirm
          </button>
        )}
        {(token.status === 'edited' || token.status === 'confirmed') && (
          <button type="button" className="dsw-btn dsw-btn-sm" onClick={onRevert}>
            Undo
          </button>
        )}
      </div>
      <p id={hintId} className="dsw-small dsw-muted">
        {FORMAT_HINT[kind]}
      </p>
      {token.error && (
        <p id={errorId} className="dsw-error" role="alert">
          {token.error}
        </p>
      )}
      <p className="dsw-assume">
        <b>{proposed.value === null ? 'Why there’s no value: ' : 'Assumed: '}</b>
        {proposed.assumption}
      </p>
    </div>
  )
}

/** The design system the review currently describes, if it renders at all
 *  (every token has a value and the rules hold), flagged or not. */
function previewTokens(tokens: Record<TokenPath, ReviewToken>): DesignTokens | null {
  if (TOKEN_PATHS.some((p) => tokens[p].value === null)) return null
  const values = Object.fromEntries(TOKEN_PATHS.map((p) => [p, tokens[p].value])) as Record<TokenPath, unknown>
  const parsed = parseDesignTokens(nestTokens(values))
  return parsed.ok ? parsed.value : null
}

// ── Workbench ────────────────────────────────────────────────────────────────

export function DesignSystemWorkbench() {
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState)
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const releaseObjectUrl = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
  }
  useEffect(() => releaseObjectUrl, [])

  async function analyze(image: DesignImage, info: ImageInfo) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'analyze', image: info })
    setAnnouncement(`Analyzing ${info.name}.`)
    const result = await runExtraction(extractor, image, { signal: controller.signal })
    if (controller.signal.aborted) return
    if (result.ok) {
      dispatch({ type: 'extracted', proposal: result.proposal })
      const pending = TOKEN_PATHS.filter((p) => result.proposal.tokens[p].value === null || result.proposal.tokens[p].confidence === 'low').length
      setAnnouncement(`Analysis done. ${TOKEN_PATHS.length} tokens proposed; ${pending} need your attention.`)
    } else {
      dispatch({ type: 'extractionFailed', error: result.error })
      setAnnouncement(result.error.message)
    }
  }

  async function chooseSample(id: string) {
    const sample = SAMPLE_IMAGES.find((s) => s.id === id)!
    releaseObjectUrl()
    const response = await fetch(sample.src)
    const bytes = new Uint8Array(await response.arrayBuffer())
    await analyze({ name: `${sample.id}.svg`, type: 'image/svg+xml', bytes }, { name: sample.name, previewUrl: sample.src })
  }

  async function chooseFile(file: File) {
    releaseObjectUrl()
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    const bytes = new Uint8Array(await file.arrayBuffer())
    await analyze({ name: file.name, type: file.type, bytes }, { name: file.name, previewUrl: url })
  }

  function cancel() {
    abortRef.current?.abort()
    dispatch({ type: 'cancel' })
    setAnnouncement('Analysis cancelled.')
  }

  function reset() {
    abortRef.current?.abort()
    releaseObjectUrl()
    dispatch({ type: 'reset' })
    setAnnouncement('Started over.')
  }

  function apply() {
    if (state.stage !== 'reviewing') return
    const result = resolveTokens(state.tokens)
    dispatch({ type: 'apply' })
    setAnnouncement(result.ok ? 'Design system applied.' : `Not applied. ${result.issues.length} token${result.issues.length === 1 ? ' still needs' : 's still need'} attention.`)
  }

  return (
    <main className="dsw">
      <style>{CHROME_CSS}</style>
      <div className="dsw-inner">
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1>Image to design system</h1>
          <p className="dsw-muted">
            A design image goes in; proposed tokens come out for you to check; the chat document block is rebuilt from
            what you approve. Offline demo: a mock extractor reads the three sample images. No AI is called.
          </p>
        </header>

        <StageRail state={state} />
        <div role="status" aria-live="polite" className="dsw-small dsw-muted" style={{ minHeight: 18 }}>
          {announcement}
        </div>

        {state.stage === 'idle' && <ImageStep onSample={chooseSample} onFile={chooseFile} />}

        {state.stage === 'analyzing' && (
          <section className="dsw-panel" aria-labelledby="analyzing-h">
            <h2 id="analyzing-h">Analyzing {state.image.name}…</h2>
            <p className="dsw-muted">Reading colors, type, spacing, corners and shadows from the image.</p>
            <div>
              <button type="button" className="dsw-btn" onClick={cancel}>
                Cancel
              </button>
            </div>
          </section>
        )}

        {state.stage === 'failed' && (
          <section className="dsw-panel" aria-labelledby="failed-h">
            <h2 id="failed-h">Couldn’t read a design system from {state.image.name}</h2>
            <div className="dsw-banner" data-tone="error">
              {state.error.message}
            </div>
            {state.error.kind === 'malformed-output' && (
              <ul className="dsw-list">
                {state.error.issues.slice(0, 8).map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            <div>
              <button type="button" className="dsw-btn" data-primary="" onClick={reset}>
                Choose another image
              </button>
            </div>
          </section>
        )}

        {state.stage === 'reviewing' && (
          <ReviewStep
            state={state}
            onlyAttention={onlyAttention}
            setOnlyAttention={setOnlyAttention}
            dispatch={(action) => {
              // A review change makes the last announcement (e.g. "Not applied") stale.
              setAnnouncement('')
              dispatch(action)
            }}
            onApply={apply}
            onReset={reset}
          />
        )}

        {state.stage === 'applied' && (
          <AppliedStep
            state={state}
            onReopen={() => {
              dispatch({ type: 'reopen' })
              setAnnouncement('Back to token review. The applied system stays until you apply again.')
            }}
            onReset={reset}
          />
        )}
      </div>
    </main>
  )
}

function ImageStep({ onSample, onFile }: { onSample: (id: string) => void; onFile: (file: File) => void }) {
  return (
    <section className="dsw-panel" aria-labelledby="image-h">
      <h2 id="image-h">1. Choose a design image</h2>
      <p className="dsw-muted">Pick a sample screenshot. Each one reads differently, including tokens the image can’t show.</p>
      <div className="dsw-samples">
        {SAMPLE_IMAGES.map((s) => (
          <button key={s.id} type="button" className="dsw-sample" onClick={() => onSample(s.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static sample SVGs; next/image adds nothing here */}
            <img src={s.src} alt="" width={640} height={420} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="dsw-upload" style={{ fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>
          Or upload your own
        </label>
        <input
          id="dsw-upload"
          type="file"
          accept={IMAGE_TYPES.join(',')}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
        <p className="dsw-small dsw-muted">
          PNG, JPEG, WebP or SVG, up to 10 MB. The offline extractor only recognizes the samples; any other image is
          refused rather than guessed at.
        </p>
      </div>
    </section>
  )
}

function ReviewStep({
  state,
  onlyAttention,
  setOnlyAttention,
  dispatch,
  onApply,
  onReset,
}: {
  state: Extract<PipelineState, { stage: 'reviewing' }>
  onlyAttention: boolean
  setOnlyAttention: (v: boolean) => void
  dispatch: React.Dispatch<Parameters<typeof pipelineReducer>[1]>
  onApply: () => void
  onReset: () => void
}) {
  const blocking = unresolved(state.tokens)
  const warnings = contrastWarnings(state.tokens)
  const preview = previewTokens(state.tokens)
  const groups = [...new Set(TOKEN_FIELDS.map((f) => f.group))]
  const flaggedCount = blocking.filter((p) => state.tokens[p].status === 'flagged').length
  const missingCount = blocking.length - flaggedCount

  return (
    <div className="dsw-review">
      <section className="dsw-panel" aria-labelledby="review-h">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="review-h">3. Review the proposed tokens</h2>
          <p>{state.proposal.summary}</p>
          <p className="dsw-small dsw-muted">
            Nothing is applied until you press Apply. Edit any value; low-confidence tokens need your confirmation and
            missing ones need a value.
          </p>
        </div>

        <div>
          <h3>Applies to the whole image</h3>
          <ul className="dsw-list">
            {state.proposal.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>

        {blocking.length > 0 ? (
          <div className="dsw-banner" data-tone="warn">
            {flaggedCount > 0 && `${flaggedCount} low-confidence token${flaggedCount === 1 ? '' : 's'} to check`}
            {flaggedCount > 0 && missingCount > 0 && ' and '}
            {missingCount > 0 && `${missingCount} token${missingCount === 1 ? '' : 's'} the image didn’t show`}
            {' — highlighted below.'}
          </div>
        ) : (
          <div className="dsw-banner" data-tone="warn" style={{ background: '#EEF7F1', color: '#1D5C33' }}>
            Every token has a value you’ve seen. Ready to apply.
          </div>
        )}

        <label className="dsw-check">
          <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
          Show only tokens that need attention
        </label>

        {groups.map((group) => {
          const paths = TOKEN_FIELDS.filter((f) => f.group === group)
            .map((f) => f.path)
            .filter((p) => !onlyAttention || blocking.includes(p))
          if (paths.length === 0) return null
          return (
            <div key={group} className="dsw-tokens" role="group" aria-label={GROUP_LABEL[group]}>
              <h3>{GROUP_LABEL[group]}</h3>
              {paths.map((path) => (
                <TokenRow
                  key={path}
                  path={path}
                  token={state.tokens[path]}
                  proposal={state.proposal}
                  onEdit={(input) => dispatch({ type: 'edit', path, input })}
                  onClearError={() => dispatch({ type: 'clearError', path })}
                  onConfirm={() => dispatch({ type: 'confirm', path })}
                  onRevert={() => dispatch({ type: 'revert', path })}
                />
              ))}
            </div>
          )
        })}

        {warnings.length > 0 && (
          <div className="dsw-banner" data-tone="warn">
            <b>Contrast</b> (a warning; it won’t stop you applying):
            <ul className="dsw-list">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="dsw-applybar">
          <button type="button" className="dsw-btn" data-primary="" onClick={onApply} aria-describedby="apply-why">
            Apply design system
          </button>
          <button type="button" className="dsw-btn" onClick={onReset}>
            Start over
          </button>
          <p id="apply-why" className="dsw-small dsw-muted">
            {blocking.length > 0
              ? `${blocking.length} token${blocking.length === 1 ? '' : 's'} still need${blocking.length === 1 ? 's' : ''} you.`
              : 'Applies to the chat document block.'}
          </p>
          {state.applyIssues.length > 0 && (
            <div className="dsw-banner" data-tone="error" role="alert" style={{ flexBasis: '100%' }}>
              Not applied:
              <ul className="dsw-list">
                {state.applyIssues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <aside className="dsw-panel dsw-sticky" aria-label="Source image and preview">
        <h3>Source image</h3>
        <div className="dsw-frame">
          {/* eslint-disable-next-line @next/next/no-img-element -- object URL or static sample */}
          <img src={state.image.previewUrl} alt={`The design image: ${state.image.name}`} style={{ width: '100%', height: 'auto', display: 'block' }} />
        </div>
        <h3>Preview — not applied</h3>
        {preview ? (
          <div className="dsw-frame">
            <ThemeScope tokens={preview} label="Preview of the proposed design system">
              <ThreadPreview />
            </ThemeScope>
          </div>
        ) : (
          <p className="dsw-small dsw-muted">
            The preview appears once every token has a value and the values fit together (for example, spacing grows
            from XS to XL).
          </p>
        )}
      </aside>
    </div>
  )
}

function AppliedStep({
  state,
  onReopen,
  onReset,
}: {
  state: Extract<PipelineState, { stage: 'applied' }>
  onReopen: () => void
  onReset: () => void
}) {
  const [opened, setOpened] = useState<string | null>(null)
  const edited = TOKEN_PATHS.filter((p) => state.tokens[p].status === 'edited').length
  const confirmed = TOKEN_PATHS.filter((p) => state.tokens[p].status === 'confirmed').length
  return (
    <section className="dsw-panel" aria-labelledby="applied-h">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 id="applied-h">4. Applied: the chat document block, reskinned</h2>
        <p className="dsw-muted">
          From {state.image.name}. You edited {edited} and confirmed {confirmed} of {TOKEN_PATHS.length} tokens; the rest
          were applied as proposed.
        </p>
      </div>
      <div className="dsw-compare">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <h3>Before · today’s card (approximation)</h3>
          <div className="dsw-frame">
            <ThemeScope tokens={SOUVENIR_BASELINE} label="Before: today’s card">
              <ThreadPreview onOpen={() => setOpened('Opened the document (before).')} onViewHistory={() => setOpened('Opened history (before).')} />
            </ThemeScope>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <h3>After · extracted design system</h3>
          <div className="dsw-frame">
            <ThemeScope tokens={state.applied} label="After: extracted design system">
              <ThreadPreview onOpen={() => setOpened('Opened the document (after).')} onViewHistory={() => setOpened('Opened history (after).')} />
            </ThemeScope>
          </div>
        </div>
      </div>
      <p role="status" className="dsw-small dsw-muted" style={{ minHeight: 18 }}>
        {opened}
      </p>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 14 }}>Every primitive in this system</summary>
        <div className="dsw-frame" style={{ marginTop: 12 }}>
          <ThemeScope tokens={state.applied} label="Primitive gallery">
            <PrimitiveGallery />
          </ThemeScope>
        </div>
      </details>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 14 }}>Token JSON</summary>
        <pre style={{ marginTop: 12 }}>{JSON.stringify(state.applied, null, 2)}</pre>
      </details>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="dsw-btn" data-primary="" onClick={onReopen}>
          Edit tokens
        </button>
        <button type="button" className="dsw-btn" onClick={onReset}>
          Start over
        </button>
      </div>
    </section>
  )
}
