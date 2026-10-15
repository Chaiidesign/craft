// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fixedEnv } from '@/lib/documents/fixtures/builders'
import { INVOICE_FIELDS as F } from '@/lib/documents/invoice'
import { ModelError, ScriptedModel, type GenerationRequest } from '@/lib/documents/generation/model'
import type { ExportResources } from '@/lib/documents/export/resources'

import { CHAT_BACKUP_KEY, CHAT_KEY, parseChat } from './chatSession'
import { DocumentChat } from './DocumentChat'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia

class MemoryStorage {
  items = new Map<string, string>()
  getItem(k: string) { return this.items.get(k) ?? null }
  setItem(k: string, v: string) { this.items.set(k, String(v)) }
  removeItem(k: string) { this.items.delete(k) }
}

const generate = {
  intent: { docType: 'invoice', audience: 'recipient', summary: 'Invoice to Acme' },
  statedAmount: { amount: '2400', evidence: '$2,400' },
  operations: [
    { op: 'setField', fieldId: F.buyerName, value: { type: 'text', text: 'Acme' }, provenance: { source: 'prompt', evidence: 'Acme' } },
    { op: 'setField', fieldId: F.currency, value: { type: 'currency', code: 'USD' }, provenance: { source: 'prompt', evidence: '$2,400' } },
    { op: 'addLineItem', description: null, quantity: '1', unitPrice: { amount: '2400' }, provenance: { source: 'prompt', evidence: '$2,400' } },
  ],
  followUp: 'What does the $2,400 cover?',
}
const addLine = { intent: generate.intent, statedAmount: null, followUp: null, operations: [{ op: 'addLineItem', description: 'Design review', quantity: '1', unitPrice: { amount: '600' }, provenance: { source: 'prompt', evidence: 'design review, $600' } }] }
const dueIn30 = (r: GenerationRequest) => ({
  intent: generate.intent, statedAmount: null, followUp: 'What is the invoice date?',
  operations: [{ op: 'setField', fieldId: F.paymentTerms, expectedDigest: r.document.fields.find((f) => f.id === F.paymentTerms)!.digest, value: { type: 'text', text: 'Due within 30 days of the invoice date.' }, provenance: { source: 'prompt', evidence: 'due in 30 days' } }],
})

let storage: MemoryStorage
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  storage = new MemoryStorage()
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

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
async function mount(model: ScriptedModel, resources?: (s: never) => ExportResources) {
  await act(async () => { root.render(<DocumentChat model={model} storage={() => storage} resources={resources} />) })
  await settle()
}
async function send(text: string) {
  const textarea = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click() })
  await settle()
}
const text = () => host.textContent ?? ''
const cards = () => [...host.querySelectorAll('article')]

describe('document chat', () => {
  it('drafts the done-condition invoice, then refines it twice, saving each version', async () => {
    const model = new ScriptedModel([generate, addLine, dueIn30])
    await mount(model)
    expect(text()).toContain('What should we draft?')

    await send('invoice for Acme, $2,400')
    expect(text()).toContain('Drafted v1. What does the $2,400 cover?')
    expect(cards()).toHaveLength(1)
    expect(cards()[0].getAttribute('aria-label')).toBe('Invoice, version 1')
    expect(cards()[0].textContent).toContain('Draft · 10 missing')
    expect(cards()[0].textContent).toContain('Line 1 description')
    expect([...cards()[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Download PDF', 'Download Word'])

    await send('add a line item: design review, $600')
    await send('due in 30 days')
    expect(text()).toContain('Updated to v2: added line 2.')
    expect(text()).toContain('Updated to v3: set Payment terms. What is the invoice date?')
    expect(cards().map((c) => c.dataset.current)).toEqual(['false', 'false', 'true'])
    // Older versions collapse; the latest is open.
    expect(cards()[0].querySelector('[class*="paper"]')).toBeNull()
    expect(cards()[2].querySelector('[class*="paper"]')).not.toBeNull()

    // Revisions went to the current version each time, with the conversation so far.
    expect(model.requests.map((r) => r.task)).toEqual(['generate', 'revise', 'revise'])
    expect(model.requests[2].conversation).toEqual(['invoice for Acme, $2,400', 'add a line item: design review, $600'])

    // Everything is in browser storage and reloads.
    const saved = parseChat(storage.getItem(CHAT_KEY), fixedEnv())
    expect(saved.status).toBe('loaded')
    if (saved.status !== 'loaded') throw new Error('unreachable')
    expect(saved.state.store.revisions.size).toBe(3)
    expect(saved.state.messages).toHaveLength(6)
  })

  it('reloads a saved chat and keeps revising the same document', async () => {
    await mount(new ScriptedModel([generate]))
    await send('invoice for Acme, $2,400')
    act(() => root.unmount())
    root = createRoot(host)
    const model = new ScriptedModel([addLine])
    await mount(model)
    expect(cards()).toHaveLength(1)
    expect(host.querySelector('textarea')!.getAttribute('placeholder')).toBe('Ask for a change…')
    await send('add a line item: design review, $600')
    expect(text()).toContain('Updated to v2: added line 2.')
  })

  it('starts a new document from scratch: nothing said before "New document" is sent or quotable', async () => {
    const quotesOldAmount = { ...generate, operations: [generate.operations[1], generate.operations[2]] }
    const model = new ScriptedModel([generate, quotesOldAmount, quotesOldAmount, quotesOldAmount])
    await mount(model)
    await send('invoice for Acme, $2,400')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'New document')!.click() })
    expect(host.querySelector('[role="separator"]')?.textContent).toBe('New document')
    expect(host.querySelector('textarea')!.getAttribute('placeholder')).toBe('Describe the document you need…')
    await send('an invoice for Initech')
    expect(model.requests[1]).toMatchObject({ task: 'generate', request: 'an invoice for Initech', conversation: [] })
    // "$2,400" is only in the earlier document's conversation, so quoting it is refused.
    expect(host.querySelector('details')?.textContent).toContain('“$2,400” is not in the request.')
    expect(cards()).toHaveLength(1)
  })

  it('says what went wrong when the gate refuses, and saves nothing', async () => {
    const bad = { ...generate, operations: [{ ...generate.operations[0], provenance: { source: 'prompt', evidence: 'Globex' } }] }
    await mount(new ScriptedModel([bad, bad, bad]))
    await send('invoice for Acme, $2,400')
    expect(text()).toContain('I couldn’t make a valid document from that, so nothing was saved.')
    expect(host.querySelector('details')?.textContent).toContain('“Globex” is not in the request.')
    expect(cards()).toHaveLength(0)
  })

  it('answers a request for another document type plainly, without a document', async () => {
    const memo = { intent: { docType: 'other', audience: 'internal', summary: 'A memo' }, statedAmount: null, operations: [], followUp: null }
    await mount(new ScriptedModel([memo]))
    await send('memo for the team')
    expect(text()).toContain('I can only draft invoices so far. Briefs, memos and decks are coming next.')
  })

  it('reports an unavailable model instead of substituting anything', async () => {
    await mount(new ScriptedModel([new ModelError('model-unavailable', 'ANTHROPIC_API_KEY is not set.')]))
    await send('invoice for Acme, $2,400')
    expect(text()).toContain('The document model isn’t available here. ANTHROPIC_API_KEY is not set.')
  })

  it('keeps an unreadable saved chat as a backup and starts a new one', async () => {
    storage.setItem(CHAT_KEY, '{"chatVersion":1,"session":{},"messages":"nope"}')
    await mount(new ScriptedModel([]))
    expect(text()).toContain('The saved chat couldn’t be read')
    expect(storage.getItem(CHAT_BACKUP_KEY)).toBe('{"chatVersion":1,"session":{},"messages":"nope"}')
  })

  it('reports a failed download on its card, without losing the document', async () => {
    const failing = () => { throw new Error('fonts unavailable') }
    await mount(new ScriptedModel([generate]), failing as never)
    await send('invoice for Acme, $2,400')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Download PDF')!.click() })
    await settle()
    expect([...host.querySelectorAll('[role="alert"]')].map((a) => a.textContent)).toContain('PDF download failed: fonts unavailable')
    expect(cards()).toHaveLength(1)
  })
})
