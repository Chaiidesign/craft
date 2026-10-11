import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { PERSONAS_QUERY_KEY } from '@/lib/api/persona-cache'
import type { Persona } from '@/lib/api/personas'
import { optimisticDelete, optimisticTogglePause, withTogglePause } from './personas'

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: 'a', name: 'A', handle: 'a', description: '', imageUrl: null, modelId: null, tags: [],
    temperature: null, isActive: true, isPaused: false, status: 'active', activeVersionId: 'v1',
    workingVersionId: 'v1', publishedAt: null, versionCount: 1, visibility: 'private',
    connectorSlugs: [], blockedConnectorSlugs: [], hasSystemInstructions: true, sourceShareId: null,
    createdAt: '', updatedAt: '', ...over,
  }
}

let qc: QueryClient
const read = () => qc.getQueryData<Persona[]>(PERSONAS_QUERY_KEY)!

beforeEach(() => {
  qc = new QueryClient()
  qc.setQueryData(PERSONAS_QUERY_KEY, [persona({ id: 'a' }), persona({ id: 'b' }), persona({ id: 'c' })])
})

describe('withTogglePause', () => {
  it('pauses a live agent', () => {
    expect(withTogglePause(persona())).toMatchObject({ isActive: false, isPaused: true, status: 'paused' })
  })
  it('resumes to live when a version is published, draft otherwise', () => {
    const paused = persona({ isActive: false, isPaused: true, status: 'paused' })
    expect(withTogglePause(paused)).toMatchObject({ isActive: true, isPaused: false, status: 'active' })
    expect(withTogglePause({ ...paused, activeVersionId: null })).toMatchObject({ status: 'draft' })
  })
})

describe('optimisticTogglePause', () => {
  it('flips the agent immediately and rollback restores only that agent', async () => {
    const rollback = await optimisticTogglePause(qc, 'b')
    expect(read().find(p => p.id === 'b')!.isPaused).toBe(true)
    expect(read().find(p => p.id === 'a')!.isPaused).toBe(false)
    // an unrelated optimistic edit made meanwhile must survive the rollback
    qc.setQueryData<Persona[]>(PERSONAS_QUERY_KEY, l => l!.map(p => (p.id === 'c' ? { ...p, name: 'C2' } : p)))
    rollback()
    expect(read().find(p => p.id === 'b')!.isPaused).toBe(false)
    expect(read().find(p => p.id === 'c')!.name).toBe('C2')
  })
  it('is a no-op when the list is not cached', async () => {
    qc.removeQueries({ queryKey: PERSONAS_QUERY_KEY })
    const rollback = await optimisticTogglePause(qc, 'b')
    expect(qc.getQueryData(PERSONAS_QUERY_KEY)).toBeUndefined()
    expect(() => rollback()).not.toThrow()
  })
})

describe('optimisticDelete', () => {
  it('removes the agent and rollback reinserts it at its old position', async () => {
    const rollback = await optimisticDelete(qc, 'b')
    expect(read().map(p => p.id)).toEqual(['a', 'c'])
    rollback()
    expect(read().map(p => p.id)).toEqual(['a', 'b', 'c'])
  })
  it('rollback does not duplicate an agent a refetch already brought back', async () => {
    const rollback = await optimisticDelete(qc, 'b')
    qc.setQueryData(PERSONAS_QUERY_KEY, [persona({ id: 'a' }), persona({ id: 'b' }), persona({ id: 'c' })])
    rollback()
    expect(read().map(p => p.id)).toEqual(['a', 'b', 'c'])
  })
  it('deleting an unknown id changes nothing and rollback is safe', async () => {
    const rollback = await optimisticDelete(qc, 'zzz')
    expect(read()).toHaveLength(3)
    rollback()
    expect(read()).toHaveLength(3)
  })
})
