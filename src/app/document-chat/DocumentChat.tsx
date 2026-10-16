'use client'

// The demo chat client (D-50). It is one client of the generation tools: a
// first message generates a document, later messages revise it, and every
// saved revision appears inline as a card that can be downloaded. While the
// model writes, the card drafts progressively from the streaming proposal.
// Confirmation and conversation live here; the pipeline never waits on a person.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpTwoIcon, StopCircleIcon } from '@strange-huge/icons'

import { Button } from '@/components/Button'
import { browserExportResources } from '@/components/documents/exportResources'
import { IconButton } from '@/components/IconButton'
import { MessageBubble } from '@/components/MessageBubble'
import type { ExportResources } from '@/lib/documents/export/resources'
import { draftFromPartial, type Draft } from '@/lib/documents/generation/draft'
import type { GenerationModel } from '@/lib/documents/generation/model'
import { RemoteModel } from '@/lib/documents/generation/remote'
import { blankInvoice, exportDocument, generateDocument, reviseDocument, type DocumentResult, type ToolError } from '@/lib/documents/generation/tools'
import type { DocumentEnv, DocumentSnapshot, ExportFormat, InvoiceSnapshot } from '@/lib/documents/model'
import { getDocument, getRevision, versionNumber } from '@/lib/documents/revisions'
import type { KeyValueStorage } from '@/lib/documents/session'

import { backUpChat, CHAT_KEY, emptyChat, parseChat, writeChat, type ChatMessage, type ChatState } from './chatSession'
import styles from './chat.module.css'
import { DocumentCard, DraftingCard, type DownloadState } from './DocumentCard'

const SUGGESTION = 'Invoice for Acme, $2,400'

/** Real clock; IDs unique to this page load so they never collide with a saved chat's. */
function chatEnv(): DocumentEnv {
  const session = Date.now().toString(36)
  let n = 0
  return { now: () => new Date().toISOString(), nextId: (prefix) => `${prefix}-${session}-${String(++n).padStart(3, '0')}` }
}

interface Pending {
  label: string
  base: InvoiceSnapshot
  draft: Draft
  controller: AbortController
}

function noticeFor(error: ToolError): { tone: 'error' | 'info'; text: string; details: string[] } {
  const details = (error.errors ?? []).map((e) => e.message)
  if (error.errors?.some((e) => e.code === 'unsupported-type')) {
    return { tone: 'info', text: 'I can only draft invoices so far. Briefs, memos and decks are coming next.', details: [] }
  }
  switch (error.code) {
    case 'gate-failed': return { tone: 'error', text: 'I couldn’t make a valid document from that, so nothing was saved. Try saying it another way.', details }
    case 'model-unavailable': return { tone: 'error', text: `The document model isn’t available here. ${error.message}`, details: [] }
    case 'not-current': return { tone: 'error', text: 'That version has changed since this message started, so nothing was saved. Send it again to revise the latest version.', details: [] }
    default: return { tone: 'error', text: `Something went wrong, and nothing was saved. ${error.message}`, details }
  }
}

/** What the assistant says about a saved revision. */
function replyFor(result: DocumentResult, created: boolean, changeSummary: string): string {
  const head = created ? `Drafted v${result.version}.` : `Updated to v${result.version}: ${changeSummary.charAt(0).toLowerCase()}${changeSummary.slice(1)}.`
  return result.followUp ? `${head} ${result.followUp}` : head
}

export function DocumentChat({ model: modelProp, storage: storageProp, resources = browserExportResources }: {
  model?: GenerationModel
  storage?: () => KeyValueStorage
  resources?: (snapshot: DocumentSnapshot) => ExportResources | Promise<ExportResources>
}) {
  const model = useMemo(() => modelProp ?? new RemoteModel(), [modelProp])
  const env = useMemo(() => chatEnv(), [])
  const [chat, setChat] = useState<ChatState>(emptyChat)
  const [loaded, setLoaded] = useState(false)
  const [storageNote, setStorageNote] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [input, setInput] = useState('')
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({})
  const threadEnd = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  const storage = useCallback((): KeyValueStorage | null => {
    try {
      return storageProp ? storageProp() : window.localStorage
    } catch {
      return null
    }
  }, [storageProp])

  // Load the saved chat once, on mount (browser storage only exists in the browser).
  useEffect(() => {
    const s = storage()
    if (s) {
      let raw: string | null = null
      try { raw = s.getItem(CHAT_KEY) } catch { /* unreadable storage: start empty, say so below */ }
      const result = parseChat(raw, env)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage after hydration (as the workbench does)
      if (result.status === 'loaded') setChat(result.state)
      if (result.status === 'malformed') {
        const backup = backUpChat(s, result.raw)
        setStorageNote(backup.ok
          ? `The saved chat couldn’t be read (${result.reason}), so this is a new one. The old copy was kept.`
          : `The saved chat couldn’t be read (${result.reason}), and a backup couldn’t be written (${backup.reason}). This is a new chat.`)
      }
    } else setStorageNote('This browser isn’t letting the page save, so the chat will be lost on reload.')
    setLoaded(true)
  }, [env, storage])

  const save = useCallback((next: ChatState) => {
    setChat(next)
    const s = storage()
    if (!s) return
    const written = writeChat(s, next)
    if (!written.ok) setStorageNote(`The chat couldn’t be saved in this browser (${written.reason}). It will be lost on reload.`)
  }, [storage])

  useEffect(() => {
    threadEnd.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' })
  }, [chat.messages.length, pending?.draft.applied])

  /**
   * What the person has said about the current document: their messages since the last
   * "New document". Only these go to the model and only these can be quoted, so a value from
   * an earlier document can never be carried into a new one (D-49).
   */
  const userHistory = (messages: readonly ChatMessage[]) => {
    const start = messages.map((m) => m.role).lastIndexOf('divider') + 1
    return messages.slice(start).flatMap((m) => (m.role === 'user' ? [m.text] : [])).slice(-40)
  }

  async function send(text: string) {
    const prompt = text.trim()
    if (!prompt || pending || !loaded) return
    const userMessage: ChatMessage = { id: env.nextId('msg'), role: 'user', text: prompt }
    const history = userHistory(chat.messages)
    const withUser: ChatState = { ...chat, messages: [...chat.messages, userMessage] }
    save(withUser)
    setInput('')

    const active = chat.activeOutputId ? getDocument(chat.store, chat.activeOutputId) : null
    const base = active ? (getRevision(chat.store, active.currentRevisionId).snapshot as InvoiceSnapshot) : blankInvoice()
    const controller = new AbortController()
    const sourceText = [...history, prompt].join('\n')
    const label = active ? `Revising v${versionNumber(chat.store, active.currentRevisionId)}…` : 'Drafting your invoice…'
    setPending({ label, base, draft: { snapshot: base, applied: 0 }, controller })
    const onPartial = (partial: unknown) => {
      const draft = draftFromPartial(base, partial, { env: chatEnv(), caller: 'model', sourceText, revising: Boolean(active) })
      setPending((p) => (p && p.controller === controller ? { ...p, draft } : p))
    }
    const ctx = { store: withUser.store, env, model, propose: { signal: controller.signal, onPartial } }
    const out = active
      ? await reviseDocument({ revisionId: active.currentRevisionId, instruction: prompt, conversation: history }, ctx)
      : await generateDocument({ prompt, conversation: history }, ctx)
    setPending(null)

    if (!out.ok) {
      const notice = controller.signal.aborted ? { tone: 'info' as const, text: 'Stopped. Nothing was saved.', details: [] } : noticeFor(out.error)
      save({ ...withUser, messages: [...withUser.messages, { id: env.nextId('msg'), role: 'assistant', kind: 'notice', ...notice }] })
    } else {
      const created = !active
      const revision = getRevision(out.store, out.result.revisionId)
      const reply: ChatMessage = { id: env.nextId('msg'), role: 'assistant', kind: 'document', outputId: out.result.outputId, revisionId: out.result.revisionId, created, reply: replyFor(out.result, created, revision.changeSummary) }
      save({ store: out.store, messages: [...withUser.messages, reply], activeOutputId: out.result.outputId })
    }
    textarea.current?.focus()
  }

  async function download(revisionId: string, format: ExportFormat) {
    const key = `${revisionId}:${format}`
    setDownloads((d) => ({ ...d, [revisionId]: { format, status: 'working' } }))
    const out = await exportDocument({ revisionId, format }, { store: chat.store, env, resources })
    if (!out.ok) {
      setDownloads((d) => ({ ...d, [revisionId]: { format, status: 'failed', message: out.error.message } }))
      return
    }
    const url = URL.createObjectURL(new Blob([out.result.bytes.slice()], { type: out.result.mimeType }))
    const a = document.createElement('a')
    a.href = url
    a.download = out.result.filename
    a.dataset.download = key
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    setDownloads((d) => ({ ...d, [revisionId]: null }))
  }

  function startNew() {
    if (pending) return
    save({ ...chat, messages: [...chat.messages, { id: env.nextId('msg'), role: 'divider' }], activeOutputId: null })
    textarea.current?.focus()
  }

  const latestByOutput = new Map<string, string>()
  for (const m of chat.messages) if (m.role === 'assistant' && m.kind === 'document') latestByOutput.set(m.outputId, m.id)
  const empty = chat.messages.length === 0 && !pending
  const placeholder = chat.activeOutputId ? 'Ask for a change…' : 'Describe the document you need…'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Draft a document</h1>
          <p className={styles.subtitle}>Prototype · invoices for now · saved in this browser only</p>
        </div>
        {chat.activeOutputId && (
          <Button variant="secondary" size="sm" onClick={startNew} disabled={Boolean(pending)}>New document</Button>
        )}
      </header>

      {storageNote && <p className={styles.storageNote} role="status">{storageNote}</p>}

      <main className={styles.thread} aria-live="polite" aria-busy={Boolean(pending)}>
        {empty && (
          <section className={styles.empty}>
            <h2 className={styles.emptyTitle}>What should we draft?</h2>
            <p className={styles.emptyText}>Describe it in a sentence. You’ll see it take shape, refine it in conversation, and download it.</p>
            <button type="button" className={styles.suggestion} onClick={() => void send(SUGGESTION)} disabled={!loaded}>{SUGGESTION}</button>
          </section>
        )}

        {chat.messages.map((m) => {
          if (m.role === 'divider') {
            return <div key={m.id} className={styles.divider} role="separator"><span>New document</span></div>
          }
          if (m.role === 'user') {
            return <div key={m.id} className={styles.userRow}><MessageBubble role="user" content={m.text} hideActions maxWidth={520} /></div>
          }
          if (m.kind === 'notice') {
            return (
              <div key={m.id} className={styles.assistantRow}>
                <p className={m.tone === 'error' ? styles.noticeError : styles.noticeInfo}>{m.text}</p>
                {m.details.length > 0 && (
                  <details className={styles.details}>
                    <summary>What was wrong</summary>
                    <ul>{m.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </details>
                )}
              </div>
            )
          }
          const revision = getRevision(chat.store, m.revisionId)
          return (
            <div key={m.id} className={styles.assistantRow}>
              <p className={styles.reply}>{m.reply}</p>
              <DocumentCard
                snapshot={revision.snapshot}
                title={getDocument(chat.store, m.outputId).title}
                version={versionNumber(chat.store, m.revisionId)}
                current={latestByOutput.get(m.outputId) === m.id}
                onDownload={(format) => void download(m.revisionId, format)}
                download={downloads[m.revisionId] ?? null}
              />
            </div>
          )
        })}

        {pending && (
          <div className={styles.assistantRow}>
            <DraftingCard snapshot={pending.draft.snapshot} label={pending.label} applied={pending.draft.applied} />
          </div>
        )}
        <div ref={threadEnd} className={styles.threadEnd} />
      </main>

      <form className={styles.composerWrap} onSubmit={(e) => { e.preventDefault(); void send(input) }}>
        <div className={styles.composer}>
          <textarea
            ref={textarea}
            className={`kaya-chat-textarea ${styles.textarea}`}
            rows={1}
            value={input}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(input)
              }
            }}
          />
          {pending ? (
            <IconButton type="button" variant="default" size="md" aria-label="Stop" icon={<StopCircleIcon size={20} />} onClick={() => pending.controller.abort()} />
          ) : (
            <IconButton type="submit" variant="default" size="md" aria-label="Send" icon={<ArrowUpTwoIcon size={20} />} disabled={!input.trim() || !loaded} />
          )}
        </div>
      </form>
    </div>
  )
}
