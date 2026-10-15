// The demo chat's browser storage: the revision store (in the workbench's own
// session format, re-checked on load) plus the chat thread that refers to it.
// Local to this browser only; nothing is sent anywhere.

import { emptyExports } from '@/lib/documents/export/jobs'
import type { DocumentEnv } from '@/lib/documents/model'
import { emptyStore, type RevisionStore } from '@/lib/documents/revisions'
import { parseSession, serializeSession, type KeyValueStorage, type StorageResult } from '@/lib/documents/session'

export const CHAT_KEY = 'souvenir-doc-chat:v1'
export const CHAT_BACKUP_KEY = 'souvenir-doc-chat:v1:backup'

export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  /** A saved revision, shown as a document card. */
  | { id: string; role: 'assistant'; kind: 'document'; outputId: string; revisionId: string; created: boolean; reply: string }
  /** Nothing was saved: why, in words, and the gate's details. */
  | { id: string; role: 'assistant'; kind: 'notice'; tone: 'error' | 'info'; text: string; details: string[] }

export interface ChatState {
  store: RevisionStore
  messages: ChatMessage[]
  /** The document new messages revise; null starts a new one. */
  activeOutputId: string | null
}

export const emptyChat = (): ChatState => ({ store: emptyStore(), messages: [], activeOutputId: null })

export function serializeChat(state: ChatState): string {
  const session = JSON.parse(serializeSession({ store: state.store, exports: emptyExports(), deckId: null })) as unknown
  return JSON.stringify({ chatVersion: 1, session, messages: state.messages, activeOutputId: state.activeOutputId })
}

export type ChatLoad =
  | { status: 'empty' }
  | { status: 'loaded'; state: ChatState }
  | { status: 'malformed'; reason: string; raw: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function messageProblem(m: unknown, store: RevisionStore): string | null {
  if (!isObj(m) || typeof m.id !== 'string') return 'a message has no ID'
  if (m.role === 'user') return typeof m.text === 'string' ? null : `message ${m.id} has no text`
  if (m.role !== 'assistant') return `message ${m.id} has an unknown role`
  if (m.kind === 'document') {
    if (typeof m.revisionId !== 'string' || !store.revisions.has(m.revisionId)) return `message ${m.id} refers to a revision that isn’t saved`
    if (typeof m.outputId !== 'string' || !store.documents.has(m.outputId) || typeof m.reply !== 'string') return `message ${m.id} is incomplete`
    return null
  }
  if (m.kind === 'notice') return typeof m.text === 'string' && Array.isArray(m.details) ? null : `message ${m.id} is incomplete`
  return `message ${m.id} has an unknown kind`
}

export function parseChat(raw: string | null, env: DocumentEnv): ChatLoad {
  if (raw === null) return { status: 'empty' }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { status: 'malformed', reason: 'it isn’t valid JSON', raw }
  }
  if (!isObj(data) || data.chatVersion !== 1) return { status: 'malformed', reason: 'it is from another version', raw }
  const session = parseSession(JSON.stringify(data.session), env)
  if (session.status === 'malformed') return { status: 'malformed', reason: session.reason, raw }
  const store = session.status === 'loaded' ? session.session.store : emptyStore()
  if (!Array.isArray(data.messages)) return { status: 'malformed', reason: 'it has no message list', raw }
  for (const m of data.messages) {
    const problem = messageProblem(m, store)
    if (problem) return { status: 'malformed', reason: problem, raw }
  }
  const active = typeof data.activeOutputId === 'string' && store.documents.has(data.activeOutputId) ? data.activeOutputId : null
  return { status: 'loaded', state: { store, messages: data.messages as ChatMessage[], activeOutputId: active } }
}

export function writeChat(storage: KeyValueStorage, state: ChatState): StorageResult {
  try {
    storage.setItem(CHAT_KEY, serializeChat(state))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message || e.name : String(e) }
  }
}

/** Keeps an unreadable saved chat under the backup key before it is replaced. */
export function backUpChat(storage: KeyValueStorage, raw: string): StorageResult {
  try {
    storage.setItem(CHAT_BACKUP_KEY, raw)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message || e.name : String(e) }
  }
}
