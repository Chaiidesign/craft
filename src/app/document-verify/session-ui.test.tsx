// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fixedEnv } from '@/lib/documents/fixtures/builders'
import { malformedSessions, sampleSession } from '@/lib/documents/fixtures/sessions'
import { serializeSession, SESSION_BACKUP_KEY, SESSION_KEY } from '@/lib/documents/session'

import { DocumentWorkbench } from './DocumentWorkbench'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia

/** A plain in-memory Web Storage (this jsdom setup has no usable localStorage of its own). */
class MemoryStorage {
  private items = new Map<string, string>()
  getItem(k: string) { return this.items.get(k) ?? null }
  setItem(k: string, v: string) { this.items.set(k, String(v)) }
  removeItem(k: string) { this.items.delete(k) }
  clear() { this.items.clear() }
}
let localStorage: MemoryStorage

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage = new MemoryStorage()
  Object.defineProperty(window, 'localStorage', { value: localStorage, configurable: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const mount = () => act(async () => { root.render(<DocumentWorkbench />); await new Promise((r) => setTimeout(r, 0)) })
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)

describe('workbench browser session', () => {
  it('a malformed session shows the banner and is not overwritten; Start again keeps a backup and saves fresh fixtures', async () => {
    const bad = malformedSessions(serializeSession(sampleSession(fixedEnv())))[4] // missing parent
    localStorage.setItem(SESSION_KEY, bad.raw)
    await mount()
    expect(host.querySelector('[data-session="malformed"]')?.textContent).toContain(`The saved workbench session couldn’t be loaded: ${bad.reason}. Nothing has been changed yet.`)
    expect(host.querySelector('[data-session="malformed"]')?.textContent).toContain('Changes won’t be saved while this banner is showing.')
    expect(localStorage.getItem(SESSION_KEY)).toBe(bad.raw)
    await act(async () => { button('Start again from the sample fixtures')!.click() })
    expect(host.querySelector('[data-session="malformed"]')).toBeNull()
    expect(localStorage.getItem(SESSION_BACKUP_KEY)).toBe(bad.raw)
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    expect(saved.schemaVersion).toBe(1)
    expect(saved.documents.length).toBeGreaterThan(3)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(document.activeElement?.id).toBe('fixture-title')
  })

  it('a valid saved session is restored; Reset asks first, then clears it', async () => {
    const session = sampleSession(fixedEnv())
    localStorage.setItem(SESSION_KEY, serializeSession(session))
    await mount()
    expect(host.querySelector('[data-session]')).toBeNull()
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).documents.map((d: { outputId: string }) => d.outputId)).toEqual([...session.store.documents.keys()])
    await act(async () => { button('Reset workbench')!.click() })
    expect(host.textContent).toContain('This clears the saved session and reloads the sample fixtures. Exports and revisions you made will be lost.')
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).documents).toHaveLength(session.store.documents.size)
    await act(async () => { button('Reset')!.click() })
    const after = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    expect(after.documents.map((d: { outputId: string }) => d.outputId)).not.toContain('out-session-invoice')
  })

  it('Reset on a malformed session backs it up first, like Start again', async () => {
    localStorage.setItem(SESSION_KEY, '{"documents": [')
    await mount()
    await act(async () => { button('Reset workbench')!.click() })
    await act(async () => { button('Reset')!.click() })
    expect(host.querySelector('[data-session="malformed"]')).toBeNull()
    expect(localStorage.getItem(SESSION_BACKUP_KEY)).toBe('{"documents": [')
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).schemaVersion).toBe(1)
  })

  it('a failing save is reported, and the workbench keeps working', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e })
    await mount()
    expect(host.querySelector('[data-session="save-failed"]')?.textContent).toBe('Changes can’t be saved in this browser (The quota has been exceeded). They will be lost on reload.')
    expect(host.querySelector('#fixture-title')).not.toBeNull()
  })
})
