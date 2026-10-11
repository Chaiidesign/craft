'use client'

import { useEffect, useMemo, useState } from 'react'
import { useChatContext } from '@/lib/chat-context-store'
import type { ActivityStatus, BrowserView, UIMessage } from '@/types/chat'

// The agent's live browser for the open chat. The backend announces the tab it is driving
// with a `browser_view` event carrying a screencast websocket: JPEG frames arrive as binary
// messages, the page URL as text. The socket closes when the agent's tab does.

export type BrowserSessionStatus =
  /** No browser for this chat yet. */
  | 'idle'
  /** Socket opening; waiting for the first frame. */
  | 'connecting'
  /** Frames arriving. */
  | 'live'
  /** The agent's tab closed, or the view expired — can be reopened. */
  | 'ended'
  /** The socket closed before a frame arrived. */
  | 'error'

/** One thing the agent did in the browser, from this chat's `browser` activities. */
export interface BrowserStep {
  id:     string
  label:  string
  status: ActivityStatus
}

export interface BrowserSession {
  status:   BrowserSessionStatus
  /** Object URL of the latest frame. */
  frame:    string | null
  /** What the agent is doing in the browser right now, while a step is running. */
  currentAction?: string
  /** The page the agent is on, for the address bar. */
  pageUrl?: string
  /** Oldest first. */
  steps:    BrowserStep[]
  /** Open the socket again after it ended or failed. */
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
  const view = browserViewOf(messages)

  const [attempt, setAttempt] = useState(0)
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
    let shown: string | null = null
    stream.onmessage = event => {
      if (typeof event.data === 'string') {
        patch({ pageUrl: JSON.parse(event.data).url })
        return
      }
      const next = URL.createObjectURL(event.data as Blob)
      if (shown) URL.revokeObjectURL(shown)
      shown = next
      patch({ status: 'live', frame: next })
    }
    stream.onclose = () => patch({ status: shown ? 'ended' : 'error' })
    return () => {
      stream.onclose = null
      stream.onmessage = null
      stream.close()
      if (shown) URL.revokeObjectURL(shown)
    }
  }, [view, key])

  const running = steps.findLast(isRunningStep)

  return {
    status:        !view ? 'idle' : current ? current.status : 'connecting',
    frame:         current?.frame ?? null,
    currentAction: running?.label,
    pageUrl:       !view ? undefined : current ? current.pageUrl : view.pageUrl || undefined,
    steps,
    reconnect:     () => setAttempt(count => count + 1),
  }
}
