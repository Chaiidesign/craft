import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { coverage, isRight, lastMade, loadPrompt, parseEvalSet, EvalSetError, type EvalRequest } from './evals'
import { ACTIONS, LANES, outcomeOf } from './lanes'
import { outputFormatsJson } from './formats'
import { cacheKey, versionOf } from './cache'
import { costOf, parseLimits, priceCall, spendStatus, summariseSpend, type SpendEntry } from './spend'
import { outputTokensJson } from './tokens'
import { findForbiddenWords } from './words'

const DOCS = fileURLToPath(new URL('../../../docs/output-system/', import.meta.url))
const read = (path: string) => readFileSync(join(DOCS, path), 'utf8')

describe('eval set', () => {
  const set = parseEvalSet(read('evals/requests.jsonl'))

  it('has 34 requests covering every lane, with at least 5 ambiguous', () => {
    const c = coverage(set)
    expect(c.total).toBe(34)
    expect(c.missingLanes).toEqual([])
    expect(c.ambiguous).toBeGreaterThanOrEqual(5)
  })

  it('gives every ambiguous request a note saying why', () => {
    for (const r of set.filter((r) => r.ambiguous)) expect(r.note, r.id).toBeTruthy()
  })

  it('refuses malformed lines', () => {
    expect(() => parseEvalSet('{"id":"x","request":"hi","expected":["poster"],"ask_ok":false,"ambiguous":false}')).toThrow(EvalSetError)
    expect(() => parseEvalSet('{"id":"x","request":"hi","expected":[],"ask_ok":false,"ambiguous":false}')).toThrow(/at least one/)
    expect(() => parseEvalSet('not json')).toThrow(/line 1/)
    const line = '{"id":"x","request":"hi","expected":["file"],"ask_ok":false,"ambiguous":false}'
    expect(() => parseEvalSet(`${line}\n${line}`)).toThrow(/duplicate/)
  })
})

describe('scoring', () => {
  const base: EvalRequest = { id: 't', request: 'r', expected: ['composed_document', 'design'], ask_ok: false, ambiguous: true }

  it('accepts any expected lane, and a question only where asking is allowed', () => {
    expect(isRight(base, 'design')).toBe(true)
    expect(isRight(base, 'file')).toBe(false)
    expect(isRight(base, 'ask')).toBe(false)
    expect(isRight({ ...base, ask_ok: true }, 'ask')).toBe(true)
    expect(isRight(base, 'unparsed')).toBe(false)
  })

  it('maps an update to the lane of the last thing made', () => {
    const r: EvalRequest = {
      ...base,
      expected: ['update:composed_document'],
      context: [{ role: 'person', text: 'plan' }, { role: 'souvenir', text: 'made it', made: 'composed_document' }],
    }
    expect(outcomeOf('update_existing', lastMade(r))).toBe('update:composed_document')
    expect(outcomeOf('update_existing', undefined)).toBe('update:unknown')
    expect(isRight(r, outcomeOf('update_existing', lastMade(r)))).toBe(true)
  })

  it('scores format-not-supported as its own outcome', () => {
    const r: EvalRequest = { ...base, expected: ['format_not_supported'] }
    expect(outcomeOf('show_format_options', undefined)).toBe('format_not_supported')
    expect(isRight(r, 'format_not_supported')).toBe(true)
    expect(isRight(r, 'ask')).toBe(false)
    expect(isRight(r, 'chat_reply')).toBe(false)
  })

  it('maps an export to the lane of the last thing made, and keeps it apart from an update', () => {
    const r: EvalRequest = {
      ...base,
      expected: ['export:strict_document'],
      context: [{ role: 'person', text: 'invoice' }, { role: 'souvenir', text: 'made it', made: 'strict_document' }],
    }
    expect(outcomeOf('export_version', lastMade(r))).toBe('export:strict_document')
    expect(outcomeOf('export_version', undefined)).toBe('export:unknown')
    expect(isRight(r, 'export:strict_document')).toBe(true)
    expect(isRight(r, 'update:strict_document')).toBe(false)
    expect(isRight(r, 'file')).toBe(false)
  })

  it('has one action per lane', () => {
    const targets = Object.values(ACTIONS).filter((t) => !['ask', 'update', 'export', 'format_not_supported'].includes(t))
    expect([...targets].sort()).toEqual([...LANES].sort())
  })
})

describe('system prompt', () => {
  const prompt = loadPrompt(read('system-prompt.md'))

  it('sends no editor comment to the model', () => {
    expect(prompt.startsWith('You are Souvenir')).toBe(true)
    expect(prompt).not.toContain('<!--')
  })

  it('names an action for every lane', () => {
    for (const action of Object.keys(ACTIONS).filter((a) => !['reply_in_chat', 'ask_question', 'update_existing'].includes(a))) {
      expect(prompt, action).toContain(action)
    }
  })
})

describe('tokens.json', () => {
  it('matches what the document engine renders (regenerate with scripts/output-system/build-tokens.ts)', () => {
    expect(read('tokens.json')).toBe(outputTokensJson())
  })
})

describe('formats.json', () => {
  it('matches the engine\'s export capabilities (regenerate with scripts/output-system/build-formats.ts)', () => {
    expect(read('formats.json')).toBe(outputFormatsJson())
  })

  it('lists every kind, and marks kinds without code as planned', () => {
    const formats = JSON.parse(read('formats.json'))
    expect(Object.keys(formats.kinds).sort()).toEqual([...LANES].sort())
    expect(formats.kinds.strict_document.status).toBe('built')
    expect(formats.kinds.dashboard.status).toBe('planned')
    const invoice = formats.kinds.strict_document.built.exports
    expect(invoice.find((e: { format: string }) => e.format === 'pptx').supported).toBe(false)
  })
})

describe('words on screen', () => {
  it('flags system words and rejected names, but not store terms', () => {
    expect(findForbiddenWords('I used a skill in the sandbox').map((h) => h.word)).toEqual(['skill', 'sandbox'])
    expect(findForbiddenWords('Here is your generated file and the revision')).toHaveLength(2)
    expect(findForbiddenWords('Use discount code SUMMER20 at checkout')).toEqual([])
    expect(findForbiddenWords('Export orders as JSON or CSV')).toEqual([])
    expect(findForbiddenWords('Slide 6: Business model')).toEqual([])
    expect(findForbiddenWords('Rank higher in search engines')).toEqual([])
    expect(findForbiddenWords('The engine lays it out').map((h) => h.word)).toEqual(['engine'])
    expect(findForbiddenWords('The model picked this').map((h) => h.word)).toEqual(['model'])
    expect(findForbiddenWords('I updated the draft').map((h) => h.word)).toEqual(['draft (noun)'])
    expect(findForbiddenWords('Draft it as an email; it shows Draft status')).toEqual([])
  })

  const guides = readdirSync(join(DOCS, 'guides')).filter((f) => f.endsWith('.md') && f !== 'README.md')

  it('has one guide per lane', () => {
    expect(guides.map((g) => g.replace(/\.md$/, '')).sort()).toEqual([...LANES].map((l) => l.replace(/_/g, '-')).sort())
  })

  it.each(guides)('%s uses only the concept map’s words', (guide) => {
    expect(findForbiddenWords(read(`guides/${guide}`))).toEqual([])
  })

  it.each(guides)('%s has every section a designer edits', (guide) => {
    const text = read(`guides/${guide}`)
    for (const heading of ['## Purpose', '## When it applies', '## Layout rules', '## Tone', '## Example 1', '## Example 2', '## Common mistakes']) {
      expect(text, heading).toContain(heading)
    }
  })
})

describe('spend', () => {
  const entry = (session: string, lane: string, costUsd: number | null): SpendEntry => ({
    at: '2026-10-17T00:00:00Z', session, lane, purpose: 'p', promptVersion: 'v', model: 'm', inputTokens: 1, outputTokens: 1, costUsd, cached: false,
  })

  it('reads the limits from build-loop.md', () => {
    expect(parseLimits(read('build-loop.md'))).toEqual({ perSessionUsd: 20, totalUsd: 75 })
    expect(parseLimits('nothing here')).toEqual({ perSessionUsd: 20, totalUsd: 75 })
    expect(parseLimits('**Per-session limit: US$5.** **Whole build limit: US$1,000.**')).toEqual({ perSessionUsd: 5, totalUsd: 1000 })
  })

  it('takes cost from usage.cost, and counts unpriced calls apart', () => {
    expect(costOf({ cost: 0.0123 })).toBe(0.0123)
    expect(costOf({ input_tokens: 3 })).toBeNull()
    const s = summariseSpend([entry('0', 'routing', 1.5), entry('1', 'file', 2), entry('1', 'file', null)])
    expect(s.totalUsd).toBe(3.5)
    expect(s.bySession).toEqual({ '0': 1.5, '1': 2 })
    expect(s.unpricedCalls).toBe(1)
    expect(spendStatus(s, '1', { perSessionUsd: 20, totalUsd: 75 }).level).toBe('warn')
  })

  it('estimates a call from tokens when the provider reports no cost, and says so', () => {
    expect(priceCall({ cost: 0.5 }, 10, 10)).toEqual({ costUsd: 0.5, estimated: false })
    expect(priceCall({}, 1_000_000, 0)).toEqual({ costUsd: 4, estimated: true })
    const s = summariseSpend([{ ...entry('0', 'routing', 2), estimated: true }])
    expect(s.estimatedCalls).toBe(1)
    expect(s.totalUsd).toBe(2)
    expect(spendStatus(s, '0', { perSessionUsd: 20, totalUsd: 75 }).message).toContain('estimated')
  })

  it('warns at 80% and stops at 100% of either limit', () => {
    const limits = { perSessionUsd: 20, totalUsd: 75 }
    expect(spendStatus(summariseSpend([entry('0', 'x', 10)]), '0', limits).level).toBe('ok')
    expect(spendStatus(summariseSpend([entry('0', 'x', 16)]), '0', limits).level).toBe('warn')
    expect(spendStatus(summariseSpend([entry('0', 'x', 20)]), '0', limits).level).toBe('stop')
    expect(spendStatus(summariseSpend([entry('0', 'x', 19), entry('1', 'x', 19), entry('2', 'x', 19), entry('3', 'x', 19)]), '4', limits).level).toBe('stop')
  })
})

describe('cache keys', () => {
  it('ignore key order but change with the request, prompt or guide', () => {
    const base = { request: { a: 1, b: [1, { c: 2 }] }, promptVersion: 'p1', guideVersion: 'g1' }
    expect(cacheKey(base)).toBe(cacheKey({ guideVersion: 'g1', promptVersion: 'p1', request: { b: [1, { c: 2 }], a: 1 } }))
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, promptVersion: 'p2' }))
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, guideVersion: 'g2' }))
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, request: { a: 2, b: [1, { c: 2 }] } }))
    expect(versionOf('x')).toHaveLength(12)
  })
})

describe('lane registry', () => {
  it('names eval sets and guides that exist', async () => {
    const { existsSync } = await import('node:fs')
    const { REGISTRY, laneEntry } = await import('./registry')
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    for (const entry of REGISTRY) {
      expect(existsSync(join(root, entry.guide)), entry.guide).toBe(true)
      if (entry.evalSet) expect(existsSync(join(root, entry.evalSet)), entry.evalSet).toBe(true)
    }
    expect(laneEntry('strict_document').templates.filter((t) => t.status === 'exists').map((t) => t.id)).toEqual(['invoice', 'quote', 'purchase-order', 'receipt'])
  })
})
