'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { openBrowser } from '@/lib/api/browser'
import { useChatContext } from '@/lib/chat-context-store'
import type { ActivityStatus, BrowserView, UIMessage } from '@/types/chat'

// The live browser in the Context panel. Two things can put it there: the agent, which
// announces the tab it is driving with a `browser_view` event, and the person, who opens the
// browser themselves and then drives it. Watching is a screencast of one tab: JPEG frames as
// binary messages, the page URL and `{ ended }` as text. Driving is the whole browser as
// video: H.264 fragments as binary messages, played through a MediaSource, with the person's
// mouse, keyboard, and pasted text going back over the same socket into the display.

// The tab the person opened outlives the panel: closing the Context panel must not close it.
let openedView: BrowserView | null = null
const openedListeners = new Set<() => void>()
export function setOpenedView(view: BrowserView | null) {
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
  | { navigate: string }
  | { close: true }

export interface BrowserSession {
  status:   BrowserSessionStatus
  /** Object URL of the latest frame while watching, or of the video stream while driving. */
  frame:    string | null
  /** True for a tab the person opened, or one the agent handed over: their input drives it. */
  control:  boolean
  /** Send input to a controlled tab. Ignored otherwise. */
  send:     (input: BrowserInput) => void
  /** Open a tab in the person's own Chrome at this URL. */
  open:     (url: string) => Promise<void>
  /** Take the controlled tab to a URL: within its site by navigating, to another site by
   * opening that site's own browser, so a sign-in lands where the agent will look for it. */
  go:       (url: string) => Promise<void>
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

/** Each site has a Chrome of its own, so this decides navigate versus open. */
export function sameSite(a: string | undefined, b: string): boolean {
  try { return a !== undefined && new URL(a).origin === new URL(b).origin } catch { return false }
}

export function useBrowserSession(): BrowserSession {
  const { messages } = useChatContext()

  const steps = useMemo(() => browserStepsOf(messages), [messages])
  const opened = useSyncExternalStore(subscribeOpened, () => openedView, () => null)
  const view = opened ?? browserViewOf(messages)
  const control = view !== undefined && (view === opened || view.control === true)

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
    const driving = view === opened || view.control === true
    stream.binaryType = driving ? 'arraybuffer' : 'blob'
    streamRef.current = stream
    let shown: string | null = null
    let finished = false
    // Driving: the fragments go into a MediaSource the <video> plays, kept near the live edge.
    const media = driving ? new MediaSource() : null
    const queue: ArrayBuffer[] = []
    let buffer: SourceBuffer | null = null
    let video: HTMLVideoElement | null = null
    const feed = () => {
      if (!buffer || buffer.updating || queue.length === 0) return
      buffer.appendBuffer(queue.shift() as ArrayBuffer)
      video ??= document.querySelector(`video[src="${shown}"]`)
      if (!video) return
      // React sets `muted` as a property after mount, too late for the autoplay decision.
      video.muted = true
      if (video.paused) void video.play().catch(() => {})
      const ranges = video.buffered
      if (ranges.length && ranges.end(ranges.length - 1) - video.currentTime > 0.6) {
        video.currentTime = ranges.end(ranges.length - 1) - 0.1
      }
    }
    if (media) {
      shown = URL.createObjectURL(media)
      media.addEventListener('sourceopen', () => {
        // Constrained Baseline at level 4.0: what the machine's encoder emits for 1440×900.
        buffer = media.addSourceBuffer('video/mp4; codecs="avc1.42C028"')
        buffer.mode = 'sequence'
        buffer.addEventListener('updateend', feed)
        feed()
      })
    }
    let playing = false
    stream.onmessage = event => {
      if (media) {
        if (typeof event.data === 'string') return
        queue.push(event.data as ArrayBuffer)
        feed()
        if (!playing) {
          playing = true
          patch({ status: 'live', frame: shown })
        }
        return
      }
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
  }, [view, key, opened])

  const running = steps.findLast(isRunningStep)
  const send = useCallback((input: BrowserInput) => {
    const stream = streamRef.current
    if (control && stream && stream.readyState === WebSocket.OPEN) stream.send(JSON.stringify(input))
  }, [control])
  const open = useCallback(async (url: string) => {
    setOpening(true)
    setOpenError(null)
    try {
      setOpenedView(await openBrowser(url))
    } catch (failure) {
      setOpenError(failure instanceof Error ? failure.message : 'Could not open the browser')
    } finally {
      setOpening(false)
    }
  }, [])

  return {
    status:        opening ? 'connecting' : !view ? 'idle' : current ? current.status : 'connecting',
    frame:         current?.frame ?? null,
    control,
    send,
    open,
    go:            async url => {
      if (sameSite(current ? current.pageUrl : view?.pageUrl, url)) send({ navigate: url })
      else await open(url)
    },
    opening,
    openError,
    currentAction: control ? undefined : running?.label,
    pageUrl:       !view ? undefined : current ? current.pageUrl : view.pageUrl || undefined,
    steps,
    reconnect:     () => setAttempt(count => count + 1),
  }
}
