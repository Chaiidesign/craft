'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { openBrowser } from '@/lib/api/browser'
import { useChatContext } from '@/lib/chat-context-store'
import type { ActivityStatus, BrowserView, UIMessage } from '@/types/chat'

// The live browser in the Context panel. Two things can put a tab there: the agent, which
// announces the tab it is driving with a `browser_view` event, and the person, who opens
// one themselves and then drives it. Both are a screencast websocket: JPEG frames arrive as
// binary messages, the page URL and `{ ended }` as text; a tab the person opened also takes
// their mouse, keyboard, and pasted text back over the socket. The socket closes with the tab.

// The tab the person opened outlives the panel: closing the Context panel must not close it.
let openedView: BrowserView | null = null
const openedListeners = new Set<() => void>()
function setOpenedView(view: BrowserView | null) {
  openedView = view
  for (const listener of openedListeners) listener()
}
function subscribeOpened(listener: () => void) {
  openedListeners.add(listener)
  return () => { openedListeners.delete(listener) }
}

export type BrowserSessionStatus =
  /** No browser for this chat yet. */
  | 'idle'
  /** Socket opening; waiting for the first frame. */
  | 'connecting'
  /** Frames arriving. */
  | 'live'
  /** The agent's tab closed with its turn, or the view expired. */
  | 'ended'
  /** The socket closed before a frame arrived. */
  | 'error'

/** One thing the agent did in the browser, from this chat's `browser` activities. */
export interface BrowserStep {
  id:     string
  label:  string
  status: ActivityStatus
}

/** What a controlling viewer sends down the socket: one CDP Input event, inserted text, or close. */
export type BrowserInput =
  | { mouse: Record<string, unknown> }
  | { key: Record<string, unknown> }
  | { text: string }
  | { close: true }

export interface BrowserSession {
  status:   BrowserSessionStatus
  /** Object URL of the latest frame. */
  frame:    string | null
  /** True for a tab the person opened: their input drives it. */
  control:  boolean
  /** Send input to a controlled tab. Ignored otherwise. */
  send:     (input: BrowserInput) => void
  /** Open a tab in the person's own Chrome at this URL. */
  open:     (url: string) => Promise<void>
  /** The open request is in flight. */
  opening:  boolean
  /** Why the last open failed, until the next attempt. */
  openError: string | null
  /** What the agent is doing in the browser right now, while a step is running. */
  currentAction?: string
  /** The page the agent is on, for the address bar. */
  pageUrl?: string
  /** Oldest first. */
  steps:    BrowserStep[]
  /** Open the socket again after a failed connection. */
  reconnect: () => void
}

const RUNNING: ReadonlySet<ActivityStatus> = new Set(['start', 'executing', 'reading'])
export const isRunningStep = (step: BrowserStep) => RUNNING.has(step.status)

/** The chat's browser activity as steps, oldest first. */
export function browserStepsOf(messages: UIMessage[]): BrowserStep[] {
  return messages
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.activities ?? [])
    .filter(activity => activity.type === 'browser')
    .map((activity): BrowserStep => ({
      id:     activity.id,
      label:  activity.progressMessage || activity.label || activity.detail || 'Browsing',
      status: activity.status,
    }))
}

/** The newest tab the backend announced for this chat. */
export function browserViewOf(messages: UIMessage[]): BrowserView | undefined {
  return messages.findLast(message => message.role === 'assistant' && message.browserView)?.browserView
}

interface SocketState {
  /** Which announced tab (and attempt) this state belongs to. */
  key:     string
  status:  'connecting' | 'live' | 'ended' | 'error'
  frame:   string | null
  pageUrl: string | undefined
}

export function useBrowserSession(): BrowserSession {
  const { messages } = useChatContext()

  const steps = useMemo(() => browserStepsOf(messages), [messages])
  const opened = useSyncExternalStore(subscribeOpened, () => openedView, () => null)
  const view = opened ?? browserViewOf(messages)
  const control = opened !== null && view === opened

  const [attempt, setAttempt] = useState(0)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const streamRef = useRef<WebSocket | null>(null)
  const key = view ? `${view.url}#${attempt}` : ''
  const [socket, setSocket] = useState<SocketState>({ key: '', status: 'connecting', frame: null, pageUrl: undefined })
  const current = socket.key === key ? socket : null

  useEffect(() => {
    if (!view) return
    const patch = (change: Partial<SocketState>) => setSocket(prev => (
      prev.key === key
        ? { ...prev, ...change }
        : { key, status: 'connecting', frame: null, pageUrl: view.pageUrl || undefined, ...change }
    ))
    const stream = new WebSocket(view.url)
    stream.binaryType = 'blob'
    streamRef.current = stream
    let shown: string | null = null
    let finished = false
    stream.onmessage = event => {
      if (typeof event.data === 'string') {
        const note = JSON.parse(event.data)
        if (note.ended) {
          finished = true
          // A tab the person closed, or that timed out, leaves the panel free again.
          if (openedView === view) setOpenedView(null)
          patch({ status: 'ended' })
          return
        }
        patch({ pageUrl: note.url })
        return
      }
      const next = URL.createObjectURL(event.data as Blob)
      if (shown) URL.revokeObjectURL(shown)
      shown = next
      patch({ status: 'live', frame: next })
    }
    stream.onclose = () => patch({ status: finished || shown ? 'ended' : 'error' })
    return () => {
      stream.onclose = null
      stream.onmessage = null
      stream.close()
      if (streamRef.current === stream) streamRef.current = null
      if (shown) URL.revokeObjectURL(shown)
    }
  }, [view, key])

  const running = steps.findLast(isRunningStep)
  const send = useCallback((input: BrowserInput) => {
    const stream = streamRef.current
    if (control && stream && stream.readyState === WebSocket.OPEN) stream.send(JSON.stringify(input))
  }, [control])

  return {
    status:        opening ? 'connecting' : !view ? 'idle' : current ? current.status : 'connecting',
    frame:         current?.frame ?? null,
    control,
    send,
    open:          async url => {
      setOpening(true)
      setOpenError(null)
      try {
        setOpenedView(await openBrowser(url))
      } catch (failure) {
        setOpenError(failure instanceof Error ? failure.message : 'Could not open the browser')
      } finally {
        setOpening(false)
      }
    },
    opening,
    openError,
    currentAction: control ? undefined : running?.label,
    pageUrl:       !view ? undefined : current ? current.pageUrl : view.pageUrl || undefined,
    steps,
    reconnect:     () => setAttempt(count => count + 1),
  }
}
