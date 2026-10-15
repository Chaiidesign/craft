import { describe, expect, it } from 'vitest'

import { emptyExports, startExport, settleExport, cancelExport, CANCEL_MESSAGE } from './export/jobs'
import { fixedEnv } from './fixtures/builders'
import { FIXTURES } from './fixtures'
import { outputIdFor } from './fixtures/revisions'
import { malformedSessions, sampleSession } from './fixtures/sessions'
import { createDocument, emptyStore, getRevision } from './revisions'
import {
  clearSession,
  openStorage,
  parseSession,
  readSession,
  serializeSession,
  SESSION_BACKUP_KEY,
  SESSION_KEY,
  startAgain,
  writeSession,
  type KeyValueStorage,
  type WorkbenchSession,
} from './session'

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>()
  getItem(k: string) { return this.items.get(k) ?? null }
  setItem(k: string, v: string) { this.items.set(k, v) }
  removeItem(k: string) { this.items.delete(k) }
}

/** Fails setItem like a full browser storage (a DOMException named QuotaExceededError). */
class FullStorage extends MemoryStorage {
  setItem() { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e }
}

/** Throws on every access, like storage blocked in some private modes. */
class BlockedStorage implements KeyValueStorage {
  getItem(): string | null { throw new Error('Access is denied for this document.') }
  setItem() { throw new Error('Access is denied for this document.') }
  removeItem() { throw new Error('Access is denied for this document.') }
}

function withExports(): WorkbenchSession {
  const env = fixedEnv()
  const s = sampleSession(env)
  const invoice = s.store.documents.get('out-session-invoice')!
  const done = startExport(emptyExports(), env, s.store, { outputId: invoice.outputId, revisionId: invoice.revisionIds[0], format: 'pdf' })
  let exports = settleExport(done.state, env, done.job!, { ok: true, bytes: new Uint8Array([37, 80, 68, 70]), pageCount: 1 }, () => 'blob:http://localhost/abc')
  const pending = startExport(exports, env, s.store, { outputId: invoice.outputId, revisionId: invoice.currentRevisionId, format: 'docx' })
  exports = pending.state
  const cancelled = startExport(exports, env, s.store, { outputId: invoice.outputId, revisionId: invoice.currentRevisionId, format: 'pdf' })
  exports = cancelExport(cancelled.state, env, cancelled.record.exportId)
  return { ...s, exports }
}

describe('session round trip', () => {
  it('keeps documents, revisions, approvals and the deck, frozen; files are not stored', () => {
    const session = withExports()
    const raw = serializeSession(session)
    expect(raw).not.toContain('blob:')
    const loaded = parseSession(raw, fixedEnv('2026-10-14T00:00:00.000Z'))
    if (loaded.status !== 'loaded') throw new Error(loaded.status === 'malformed' ? loaded.reason : loaded.status)
    const { store, exports, deckId } = loaded.session
    expect([...store.documents.keys()]).toEqual([...session.store.documents.keys()])
    expect(store.revisions.size).toBe(session.store.revisions.size)
    expect(store.markers).toEqual(session.store.markers)
    expect(deckId).toBe(session.deckId)
    for (const [id, r] of session.store.revisions) {
      expect(JSON.stringify(getRevision(store, id))).toBe(JSON.stringify(r))
      expect(Object.isFrozen(getRevision(store, id).snapshot)).toBe(true)
    }
    const [done, pending, cancelled] = exports.records
    expect(done).toMatchObject({ status: 'expired', artifact: { byteSize: 4, mimeType: 'application/pdf' } })
    expect('localUrl' in (done as { artifact: object }).artifact).toBe(false)
    expect(pending).toMatchObject({ status: 'failed', error: { code: 'cancelled', message: CANCEL_MESSAGE.reload } })
    expect(cancelled).toMatchObject({ status: 'failed', error: { code: 'cancelled', message: CANCEL_MESSAGE.user } })
    expect(exports.events.at(-1)).toMatchObject({ type: 'exportCancelled', exportId: pending.exportId, reason: 'reload' })
  })

  it('every document fixture — including the empty, incomplete and invalid ones — saves and loads, as a first visit saves them', () => {
    const env = fixedEnv()
    let store = emptyStore()
    for (const f of FIXTURES) if (f.type === 'document') store = createDocument(store, env, f.build(), { outputId: outputIdFor(f.id) }).store
    const raw = serializeSession({ store, exports: emptyExports(), deckId: null })
    const loaded = parseSession(raw, env)
    expect(loaded.status === 'malformed' ? loaded.reason : loaded.status).toBe('loaded')
    if (loaded.status === 'loaded') expect(loaded.session.store.documents.size).toBe(FIXTURES.filter((f) => f.type === 'document').length)
  })

  it('nothing saved loads as empty, not as an error', () => {
    expect(parseSession(null, fixedEnv())).toEqual({ status: 'empty' })
  })
})

describe('malformed sessions: each kind is refused with its own reason, and the raw text is kept', () => {
  const valid = serializeSession(sampleSession(fixedEnv()))
  const cases = malformedSessions(valid)
  it('covers all eight kinds', () => {
    expect(cases.map((c) => c.kind)).toEqual(['not-json', 'unknown-version', 'wrong-structure', 'current-not-in-history', 'missing-parent', 'missing-deck-source', 'missing-approval-revision', 'fails-validation'])
  })
  it.each(cases.map((c) => [c.label, c] as const))('%s', (_, c) => {
    const result = parseSession(c.raw, fixedEnv())
    expect(result).toEqual({ status: 'malformed', reason: c.reason, raw: c.raw })
  })
  it('the valid session they were made from loads', () => {
    expect(parseSession(valid, fixedEnv()).status).toBe('loaded')
  })
})

describe('storage access', () => {
  it('write then read', () => {
    const storage = new MemoryStorage()
    const session = sampleSession(fixedEnv())
    expect(writeSession(storage, session)).toEqual({ ok: true })
    expect(readSession(storage, fixedEnv()).status).toBe('loaded')
  })

  it('a full storage reports the browser’s reason and leaves the saved session alone', () => {
    const storage = new FullStorage()
    storage.items.set(SESSION_KEY, 'earlier')
    expect(writeSession(storage, sampleSession(fixedEnv()))).toEqual({ ok: false, reason: 'The quota has been exceeded.' })
    expect(storage.items.get(SESSION_KEY)).toBe('earlier')
  })

  it('blocked storage: the accessor, reads and writes each report their reason', () => {
    expect(openStorage(() => { throw new Error('The operation is insecure.') })).toEqual({ ok: false, reason: 'The operation is insecure.' })
    const blocked = new BlockedStorage()
    expect(readSession(blocked, fixedEnv())).toEqual({ status: 'unavailable', reason: 'Access is denied for this document.' })
    expect(writeSession(blocked, sampleSession(fixedEnv()))).toEqual({ ok: false, reason: 'Access is denied for this document.' })
    expect(clearSession(blocked)).toEqual({ ok: false, reason: 'Access is denied for this document.' })
  })

  it('start again keeps the unreadable text under the backup key, then clears the session', () => {
    const storage = new MemoryStorage()
    storage.items.set(SESSION_KEY, '{"documents": [')
    expect(startAgain(storage, '{"documents": [')).toEqual({ ok: true })
    expect(storage.items.get(SESSION_BACKUP_KEY)).toBe('{"documents": [')
    expect(storage.items.has(SESSION_KEY)).toBe(false)
  })

  it('start again clears nothing when the backup can’t be written', () => {
    const storage = new FullStorage()
    storage.items.set(SESSION_KEY, 'unreadable')
    expect(startAgain(storage, 'unreadable')).toEqual({ ok: false, reason: 'The quota has been exceeded.' })
    expect(storage.items.get(SESSION_KEY)).toBe('unreadable')
  })
})
