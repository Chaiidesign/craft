import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runExtraction } from './extractor'
import { createMockExtractor, SAMPLE_IMAGES } from './mock-extractor'
import type { TokenProposal } from './proposal'
import {
  contrastRatio,
  contrastWarnings,
  initialPipelineState,
  pipelineReducer,
  unresolved,
  type PipelineAction,
  type PipelineState,
} from './review'
import { acceptedSampleTokens } from './test-fixtures'
import { formatTokenValue, parseTokenInput } from './token-format'
import { TOKEN_PATHS } from './tokens'

async function proposalFor(id: string): Promise<TokenProposal> {
  const sample = SAMPLE_IMAGES.find((s) => s.id === id)!
  const result = await runExtraction(createMockExtractor(), {
    name: `${id}.svg`,
    type: 'image/svg+xml',
    bytes: new Uint8Array(readFileSync(sample.file)),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.proposal
}

const image = { name: 'sample.svg', previewUrl: '/x.svg' }
const run = (actions: PipelineAction[], from: PipelineState = initialPipelineState) => actions.reduce(pipelineReducer, from)

async function reviewing(id: string) {
  const state = run([{ type: 'analyze', image }, { type: 'extracted', proposal: await proposalFor(id) }])
  if (state.stage !== 'reviewing') throw new Error(state.stage)
  return state
}

describe('stages', () => {
  it('moves idle → analyzing → reviewing, and never skips review', async () => {
    const analyzing = run([{ type: 'analyze', image }])
    expect(analyzing.stage).toBe('analyzing')
    const state = pipelineReducer(analyzing, { type: 'extracted', proposal: await proposalFor('soft-bloom') })
    expect(state.stage).toBe('reviewing')
  })

  it('shows every proposed value exactly as extracted: nulls stay null, nothing is filled in', async () => {
    const proposal = await proposalFor('night-console')
    const state = run([{ type: 'analyze', image }, { type: 'extracted', proposal }])
    if (state.stage !== 'reviewing') throw new Error()
    for (const path of TOKEN_PATHS) expect(state.tokens[path].value, path).toEqual(proposal.tokens[path].value)
    expect(state.tokens['shadow.card']).toEqual({ value: null, status: 'missing' })
  })

  it('marks low confidence as flagged and null as missing', async () => {
    const state = await reviewing('night-console')
    expect(unresolved(state.tokens)).toEqual(['color.focus', 'font.body', 'radius.pill', 'shadow.card', 'shadow.raised'])
    expect(state.tokens['color.primary'].status).toBe('proposed')
  })

  it('a failed extraction goes to failed, keeping the error', () => {
    const state = run([{ type: 'analyze', image }, { type: 'extractionFailed', error: { kind: 'unrecognized-image', message: 'no reading' } }])
    expect(state).toMatchObject({ stage: 'failed', error: { kind: 'unrecognized-image' } })
  })

  it('drops a result that arrives after cancel or reset', async () => {
    const proposal = await proposalFor('ledger')
    expect(run([{ type: 'analyze', image }, { type: 'cancel' }, { type: 'extracted', proposal }]).stage).toBe('idle')
    expect(run([{ type: 'analyze', image }, { type: 'reset' }, { type: 'extracted', proposal }]).stage).toBe('idle')
  })
})

describe('apply is gated on the person', () => {
  it('refuses while a token is flagged, and says which', async () => {
    const state = run([{ type: 'apply' }], await reviewing('ledger'))
    expect(state.stage).toBe('reviewing')
    if (state.stage === 'reviewing') expect(state.applyIssues).toEqual(['shadow.raised: low confidence — confirm or edit it'])
  })

  it('applies once every flagged token is confirmed', async () => {
    const state = run([{ type: 'confirm', path: 'shadow.raised' }, { type: 'apply' }], await reviewing('ledger'))
    expect(state.stage).toBe('applied')
    if (state.stage === 'applied') expect(state.applied).toEqual(await acceptedSampleTokens('ledger'))
  })

  it('refuses a missing token until someone supplies a value; confirming a blank is not possible', async () => {
    const start = await reviewing('night-console')
    const confirmedBlank = run([{ type: 'confirm', path: 'shadow.card' }], start)
    expect(confirmedBlank).toBe(start)

    const done = run(
      [
        { type: 'edit', path: 'shadow.card', input: 'none' },
        { type: 'edit', path: 'shadow.raised', input: '0 8 24 0 #00000066' },
        { type: 'confirm', path: 'color.focus' },
        { type: 'edit', path: 'font.body', input: 'Inter, system-ui, sans-serif' },
        { type: 'confirm', path: 'radius.pill' },
        { type: 'apply' },
      ],
      start,
    )
    expect(done.stage).toBe('applied')
    if (done.stage === 'applied') {
      expect(done.applied.shadow.card).toEqual([])
      expect(done.applied.font.body).toEqual(['Inter', 'system-ui', 'sans-serif'])
      expect(done.tokens['shadow.card'].status).toBe('edited')
      expect(done.tokens['color.focus'].status).toBe('confirmed')
    }
  })

  it('an edit that breaks a cross-token rule is accepted per field but refused at apply', async () => {
    const state = run(
      [{ type: 'confirm', path: 'shadow.raised' }, { type: 'edit', path: 'space.lg', input: '2' }, { type: 'apply' }],
      await reviewing('ledger'),
    )
    expect(state.stage).toBe('reviewing')
    if (state.stage === 'reviewing') expect(state.applyIssues.join()).toMatch(/Spacing must grow/)
  })

  it('a malformed edit is refused with a reason and keeps the previous value and status', async () => {
    const start = await reviewing('ledger')
    const state = run([{ type: 'edit', path: 'color.primary', input: 'reddish' }], start)
    if (state.stage !== 'reviewing') throw new Error()
    expect(state.tokens['color.primary'].value).toBe('#8C3B1F')
    expect(state.tokens['color.primary'].status).toBe('proposed')
    expect(state.tokens['color.primary'].error).toMatch(/hex color/)
  })

  it('clearing an error keeps the value and status', async () => {
    const state = run(
      [{ type: 'edit', path: 'color.primary', input: 'reddish' }, { type: 'clearError', path: 'color.primary' }],
      await reviewing('ledger'),
    )
    if (state.stage !== 'reviewing') throw new Error()
    expect(state.tokens['color.primary']).toEqual({ value: '#8C3B1F', status: 'proposed' })
  })

  it('an empty edit is refused, so a token can never be blanked', async () => {
    const state = run([{ type: 'edit', path: 'space.md', input: '   ' }], await reviewing('ledger'))
    if (state.stage !== 'reviewing') throw new Error()
    expect(state.tokens['space.md']).toMatchObject({ value: 16, error: expect.stringMatching(/can’t be left empty/) })
  })

  it('revert restores the proposed value and its original status', async () => {
    const state = run(
      [{ type: 'edit', path: 'shadow.raised', input: 'none' }, { type: 'revert', path: 'shadow.raised' }],
      await reviewing('ledger'),
    )
    if (state.stage !== 'reviewing') throw new Error()
    expect(state.tokens['shadow.raised'].status).toBe('flagged')
  })

  it('reopening an applied system keeps every edit', async () => {
    const applied = run(
      [{ type: 'edit', path: 'color.primary', input: '#123456' }, { type: 'confirm', path: 'shadow.raised' }, { type: 'apply' }],
      await reviewing('ledger'),
    )
    const reopened = run([{ type: 'reopen' }], applied)
    expect(reopened.stage).toBe('reviewing')
    if (reopened.stage === 'reviewing') expect(reopened.tokens['color.primary']).toEqual({ value: '#123456', status: 'edited' })
  })

  it('edits are ignored outside review', async () => {
    const analyzing = run([{ type: 'analyze', image }])
    expect(run([{ type: 'edit', path: 'color.primary', input: '#000000' }, { type: 'apply' }], analyzing)).toBe(analyzing)
  })
})

describe('editing format', () => {
  it.each(SAMPLE_IMAGES.map((s) => s.id))('%s: every proposed value survives format → parse unchanged', async (id) => {
    const proposal = await proposalFor(id)
    for (const path of TOKEN_PATHS) {
      const value = proposal.tokens[path].value
      if (value === null) {
        expect(formatTokenValue(path, value)).toBe('')
        continue
      }
      expect(parseTokenInput(path, formatTokenValue(path, value)), path).toEqual({ ok: true, value })
    }
  })

  it.each([
    ['color.primary', '#abcdef', '#ABCDEF'],
    ['space.md', '12px', 12],
    ['font.body', '"Helvetica Neue", Arial, sans-serif', ['Helvetica Neue', 'Arial', 'sans-serif']],
    ['type.body', 'heading 18/1.4 600 0.01em', { font: 'heading', size: 18, lineHeight: 1.4, weight: 600, letterSpacing: 0.01 }],
    ['shadow.card', 'NONE', []],
    ['shadow.card', '0 2px 4px 0 #00000020, 0 8 16 0 #00000010', [
      { x: 0, y: 2, blur: 4, spread: 0, color: '#00000020' },
      { x: 0, y: 8, blur: 16, spread: 0, color: '#00000010' },
    ]],
  ] as const)('%s accepts %j', (path, input, value) => {
    expect(parseTokenInput(path, input)).toEqual({ ok: true, value })
  })

  it.each([
    ['color.primary', 'red'],
    ['space.md', '1e3'],
    ['space.md', 'twelve'],
    ['font.body', 'Arial'],
    ['type.body', 'body 15 400'],
    ['type.body', 'body 15/1.5 450 0em'],
    ['shadow.card', '0 1 2 #000000'],
    ['shadow.card', '0 1 2 0 black'],
  ] as const)('%s rejects %j', (path, input) => {
    expect(parseTokenInput(path, input).ok).toBe(false)
  })
})

describe('contrast warnings', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
  })

  it('warns about low-contrast pairs without blocking apply', async () => {
    const start = await reviewing('soft-bloom')
    const lowered = run([{ type: 'edit', path: 'color.text', input: '#F0F0F0' }], start)
    if (lowered.stage !== 'reviewing') throw new Error()
    expect(contrastWarnings(lowered.tokens).join()).toMatch(/Text on cards: 1\.\d:1/)
    const applied = run([{ type: 'confirm', path: 'radius.sm' }, { type: 'confirm', path: 'shadow.raised' }, { type: 'apply' }], lowered)
    expect(applied.stage).toBe('applied')
  })
})
