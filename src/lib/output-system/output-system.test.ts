import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { coverage, isRight, lastMade, loadPrompt, parseEvalSet, EvalSetError, type EvalRequest } from './evals'
import { ACTIONS, LANES, outcomeOf } from './lanes'
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
    const targets = Object.values(ACTIONS).filter((t) => t !== 'ask' && t !== 'update' && t !== 'export')
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
