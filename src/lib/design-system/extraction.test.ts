/* eslint-disable @typescript-eslint/no-explicit-any -- these tests build deliberately malformed proposals, which no type describes */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runExtraction, validateImage, type DesignImage, type TokenExtractor } from './extractor'
import { createMockExtractor, SAMPLE_IMAGES, sha256Hex } from './mock-extractor'
import { isFlagged, isMissing, parseProposal, type TokenProposal } from './proposal'
import { nestTokens, parseDesignTokens, parseTokenValue, TOKEN_PATHS, type TokenPath } from './tokens'

function sampleImage(id: string): DesignImage {
  const sample = SAMPLE_IMAGES.find((s) => s.id === id)!
  return { name: `${id}.svg`, type: 'image/svg+xml', bytes: new Uint8Array(readFileSync(sample.file)) }
}

async function proposalFor(id: string): Promise<TokenProposal> {
  const result = await runExtraction(createMockExtractor(), sampleImage(id))
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`)
  return result.proposal
}

const fixedExtractor = (output: unknown): TokenExtractor => ({ id: 'fixed', extract: async () => structuredClone(output) })

describe('sample images', () => {
  it.each(SAMPLE_IMAGES.map((s) => [s.id, s] as const))('%s: committed bytes match the recorded SHA-256', async (_id, sample) => {
    expect(await sha256Hex(new Uint8Array(readFileSync(sample.file)))).toBe(sample.sha256)
  })
})

describe('mock extractor through the boundary', () => {
  it.each(SAMPLE_IMAGES.map((s) => s.id))('%s: returns a proposal with every token', async (id) => {
    const proposal = await proposalFor(id)
    expect(Object.keys(proposal.tokens).sort()).toEqual([...TOKEN_PATHS].sort())
    for (const path of TOKEN_PATHS) expect(proposal.tokens[path].assumption.length).toBeGreaterThan(0)
  })

  it('reports what it could not read instead of filling it in', async () => {
    const proposal = await proposalFor('night-console')
    expect(isMissing(proposal.tokens['shadow.card'])).toBe(true)
    expect(isMissing(proposal.tokens['shadow.raised'])).toBe(true)
    expect(isFlagged(proposal.tokens['font.body'])).toBe(true)
    expect(proposal.tokens['shadow.card'].assumption).toMatch(/could not be read/)
  })

  it('every sample has at least one flagged token, so the review path is always exercised', async () => {
    for (const { id } of SAMPLE_IMAGES) {
      const proposal = await proposalFor(id)
      const needsAttention = TOKEN_PATHS.filter((p) => isFlagged(proposal.tokens[p]) || isMissing(proposal.tokens[p]))
      expect(needsAttention.length, id).toBeGreaterThan(0)
    }
  })

  it('a fully-resolved sample satisfies the applied-token rules', async () => {
    const proposal = await proposalFor('ledger')
    const values = Object.fromEntries(TOKEN_PATHS.map((p) => [p, proposal.tokens[p].value])) as Record<TokenPath, unknown>
    expect(parseDesignTokens(nestTokens(values)).ok).toBe(true)
  })

  it('returns a fresh copy each call', async () => {
    const a = await proposalFor('ledger')
    a.tokens['color.primary'].value = '#000000'
    const b = await proposalFor('ledger')
    expect(b.tokens['color.primary'].value).toBe('#8C3B1F')
  })

  it('reports an image it has no reading for as unrecognized', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
    const result = await runExtraction(createMockExtractor(), { name: 'mine.svg', type: 'image/svg+xml', bytes: svg })
    expect(result).toMatchObject({ ok: false, error: { kind: 'unrecognized-image' } })
  })

  it('can be cancelled while analyzing', async () => {
    const controller = new AbortController()
    const pending = runExtraction(createMockExtractor({ latencyMs: 50 }), sampleImage('ledger'), { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'cancelled' } })
  })
})

describe('image validation', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

  it('accepts a PNG whose bytes are a PNG', () => {
    expect(validateImage({ name: 'a.png', type: 'image/png', bytes: png })).toBeNull()
  })
  it('rejects unsupported types', () => {
    expect(validateImage({ name: 'a.gif', type: 'image/gif', bytes: png })?.kind).toBe('invalid-image')
  })
  it('rejects empty files', () => {
    expect(validateImage({ name: 'a.png', type: 'image/png', bytes: new Uint8Array() })?.message).toMatch(/empty/)
  })
  it('rejects a file whose contents contradict its declared type', () => {
    expect(validateImage({ name: 'a.jpg', type: 'image/jpeg', bytes: png })?.message).toMatch(/don.t match/)
    const text = new TextEncoder().encode('hello')
    expect(validateImage({ name: 'a.svg', type: 'image/svg+xml', bytes: text })?.kind).toBe('invalid-image')
  })
  it('rejects files over 10 MB', () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set(png)
    expect(validateImage({ name: 'a.png', type: 'image/png', bytes: big })?.message).toMatch(/10 MB/)
  })
})

describe('malformed extractor output is rejected at the boundary', () => {
  let good: TokenProposal
  const run = (output: unknown) => runExtraction(fixedExtractor(output), sampleImage('ledger'))
  const mutate = async (change: (p: Record<string, any>) => void) => {
    good ??= await proposalFor('ledger')
    const copy = structuredClone(good) as unknown as Record<string, any>
    change(copy)
    return run(copy)
  }

  it('the unmodified proposal passes (control)', async () => {
    expect((await mutate(() => {})).ok).toBe(true)
  })

  it.each<[string, (p: Record<string, any>) => void]>([
    ['three-digit hex', (p) => (p.tokens['color.primary'].value = '#FFF')],
    ['named color', (p) => (p.tokens['color.primary'].value = 'red')],
    ['non-hex digits', (p) => (p.tokens['color.text'].value = '#GG0000')],
    ['negative spacing', (p) => (p.tokens['space.md'].value = -4)],
    ['NaN spacing', (p) => (p.tokens['space.md'].value = Number.NaN)],
    ['infinite radius', (p) => (p.tokens['radius.lg'].value = Number.POSITIVE_INFINITY)],
    ['spacing as a CSS string', (p) => (p.tokens['space.md'].value = '16px')],
    ['font stack without a generic family', (p) => (p.tokens['font.body'].value = ['Arial'])],
    ['font name that could break out of CSS', (p) => (p.tokens['font.body'].value = ['Arial; } body { display:none', 'sans-serif'])],
    ['empty font stack', (p) => (p.tokens['font.body'].value = [])],
    ['font weight off the 100 grid', (p) => (p.tokens['type.body'].value.weight = 450)],
    ['extra key in a text style', (p) => (p.tokens['type.body'].value.color = '#000000')],
    ['shadow as a CSS string', (p) => (p.tokens['shadow.card'].value = '0 1px 2px black')],
    ['shadow layer with bad color', (p) => (p.tokens['shadow.card'].value[0].color = 'rgba(0,0,0,.1)')],
    ['a token missing entirely', (p) => delete p.tokens['radius.md']],
    ['an unknown token', (p) => (p.tokens['color.accent2'] = { value: '#000000', confidence: 'high', assumption: 'x' })],
    ['unknown confidence', (p) => (p.tokens['color.text'].confidence = 'certain')],
    ['no assumption', (p) => (p.tokens['color.text'].assumption = '  ')],
    ['missing value claimed as high confidence', (p) => (p.tokens['color.text'] = { value: null, confidence: 'high', assumption: 'x' })],
    ['unknown top-level field', (p) => (p.debug = true)],
    ['not an object at all', (p) => { for (const k of Object.keys(p)) delete p[k] }],
  ])('rejects %s', async (_label, change) => {
    const result = await mutate(change)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('malformed-output')
      if (result.error.kind === 'malformed-output') expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })

  it('rejects non-object output', async () => {
    for (const output of [null, undefined, 'tokens', 42, []]) {
      expect(await run(output)).toMatchObject({ ok: false, error: { kind: 'malformed-output' } })
    }
  })

  it('reports an extractor that throws as a failure, not malformed output', async () => {
    const failing: TokenExtractor = { id: 'x', extract: async () => { throw new Error('model timed out') } }
    expect(await runExtraction(failing, sampleImage('ledger'))).toEqual({
      ok: false,
      error: { kind: 'extractor-failed', message: 'model timed out' },
    })
  })
})

describe('applied-token rules', () => {
  async function resolvedLedger() {
    const proposal = await proposalFor('ledger')
    return Object.fromEntries(TOKEN_PATHS.map((p) => [p, proposal.tokens[p].value])) as Record<TokenPath, any>
  }

  it('rejects spacing that does not grow', async () => {
    const values = await resolvedLedger()
    values['space.lg'] = values['space.md']
    const result = parseDesignTokens(nestTokens(values))
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.issues.join()).toMatch(/Spacing must grow/)
  })

  it('rejects radii that shrink', async () => {
    const values = await resolvedLedger()
    values['radius.pill'] = 1
    expect(parseDesignTokens(nestTokens(values)).ok).toBe(false)
  })

  it('rejects a caption larger than the body', async () => {
    const values = await resolvedLedger()
    values['type.caption'] = { ...values['type.caption'], size: 20 }
    expect(parseDesignTokens(nestTokens(values)).ok).toBe(false)
  })

  it('rejects a null left in place of a value', async () => {
    const values = await resolvedLedger()
    values['shadow.card'] = null
    expect(parseDesignTokens(nestTokens(values)).ok).toBe(false)
  })

  it('validates a single edited token against its own schema', () => {
    expect(parseTokenValue('color.primary', '#123456').ok).toBe(true)
    expect(parseTokenValue('color.primary', 'blue').ok).toBe(false)
    expect(parseTokenValue('shadow.card', []).ok).toBe(true)
  })
})

describe('proposal parsing', () => {
  it('parseProposal is the same check runExtraction applies', async () => {
    const proposal = await proposalFor('soft-bloom')
    expect(parseProposal(proposal).ok).toBe(true)
    expect(parseProposal({ ...proposal, tokens: {} }).ok).toBe(false)
  })
})
