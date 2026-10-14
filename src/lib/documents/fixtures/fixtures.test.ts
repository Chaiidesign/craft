import { describe, expect, it } from 'vitest'

import { FIXTURES, getFixture } from '@/lib/documents/fixtures'
import { validateSnapshot } from '@/lib/documents/validation'

const documents = FIXTURES.filter((f) => f.type === 'document')

describe('fixture registry', () => {
  it('covers every PRD §11 fixture number', () => {
    expect([...new Set(FIXTURES.map((f) => f.prdNumber))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('has unique IDs and scenarios that point at real document fixtures', () => {
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length)
    for (const f of FIXTURES) {
      if (f.type === 'scenario' && f.baseFixtureId) expect(getFixture(f.baseFixtureId)?.type).toBe('document')
    }
  })

  it.each(documents.map((f) => [f.id, f] as const))('%s builds deterministically', (_, fixture) => {
    if (fixture.type !== 'document') return
    expect(JSON.stringify(fixture.build())).toBe(JSON.stringify(fixture.build()))
  })

  it.each(documents.map((f) => [f.id, f] as const))('%s contains no remote URLs', (_, fixture) => {
    if (fixture.type !== 'document') return
    expect(JSON.stringify(fixture.build())).not.toMatch(/https?:\/\//)
  })

  it('marks every citation as fictional', () => {
    for (const fixture of documents) {
      if (fixture.type !== 'document') continue
      expect(fixture.build().citations.every((c) => c.fictional === true)).toBe(true)
    }
  })

  it('validates each document fixture to the readiness it is meant to show', () => {
    const readiness = Object.fromEntries(documents.map((f) => [f.id, f.type === 'document' ? validateSnapshot(f.build()).readiness : null]))
    expect(readiness).toEqual({
      'invoice-complete': 'ready',
      'invoice-missing': 'incomplete',
      'invoice-long': 'ready',
      'brief-evidence': 'ready',
      'brand-no-logo': 'ready',
      'brand-broken-logo': 'ready',
      'brand-long-name': 'ready',
      'empty-document': 'incomplete',
    })
  })
})
