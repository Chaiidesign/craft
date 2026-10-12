import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BrowserScreen, toUrl } from '@/components/BrowserPanel/BrowserScreen'
import { browserStepsOf, browserViewOf, type BrowserSession, type BrowserSessionStatus } from '@/components/BrowserPanel/use-browser-session'
import type { UIMessage } from '@/types/chat'

const FRAME = 'blob:http://localhost:3000/3f2a'

function session(status: BrowserSessionStatus, extra: Partial<BrowserSession> = {}): BrowserSession {
  return {
    status,
    frame: status === 'live' ? FRAME : null,
    control: false,
    send: () => {},
    open: async () => {},
    opening: false,
    openError: null,
    steps: [],
    reconnect: () => {},
    ...extra,
  }
}

const render = (value: BrowserSession, expanded = false) =>
  renderToStaticMarkup(<BrowserScreen session={value} expanded={expanded} onExpandedChange={() => {}} />)

describe('browserViewOf', () => {
  it('returns the newest announced tab, from any assistant reply', () => {
    const first = { url: 'wss://api.example.com/browser/access/t1/screencast', pageUrl: 'https://a.example' }
    const second = { url: 'wss://api.example.com/browser/access/t2/screencast', pageUrl: 'https://b.example' }
    const messages: UIMessage[] = [
      { id: 'a1', role: 'assistant', content: '', created_at: '', chat_id: 'c', browserView: first },
      { id: 'u', role: 'user', content: '', created_at: '', chat_id: 'c' },
      { id: 'a2', role: 'assistant', content: '', created_at: '', chat_id: 'c', browserView: second },
      { id: 'a3', role: 'assistant', content: '', created_at: '', chat_id: 'c' },
    ]
    expect(browserViewOf(messages)).toBe(second)
    expect(browserViewOf([])).toBeUndefined()
  })
})

describe('browserStepsOf', () => {
  it('lists browser activity across replies, oldest first, with the most specific label', () => {
    const messages: UIMessage[] = [
      { id: 'a1', role: 'assistant', content: '', created_at: '', chat_id: 'c', activities: [
        { id: 'b1', type: 'browser', status: 'done', label: 'Opened site' },
        { id: 'w1', type: 'web-search', status: 'done', label: 'Not a browser step' },
      ] },
      { id: 'u', role: 'user', content: '', created_at: '', chat_id: 'c' },
      { id: 'a2', role: 'assistant', content: '', created_at: '', chat_id: 'c', activities: [
        { id: 'b2', type: 'browser', status: 'executing', label: 'Clicking', progressMessage: 'Clicking “Search”' },
        { id: 'b3', type: 'browser', status: 'start' },
      ] },
    ]
    expect(browserStepsOf(messages)).toEqual([
      { id: 'b1', label: 'Opened site', status: 'done' },
      { id: 'b2', label: 'Clicking “Search”', status: 'executing' },
      { id: 'b3', label: 'Browsing', status: 'start' },
    ])
  })
})

describe('toUrl', () => {
  it('opens Google with nothing typed, keeps URLs, adds https to hosts, searches the rest', () => {
    expect(toUrl('')).toBe('https://www.google.com/')
    expect(toUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x')
    expect(toUrl('shopify.com/pricing')).toBe('https://shopify.com/pricing')
    expect(toUrl('mazda 6 seat covers')).toBe('https://www.google.com/search?q=mazda%206%20seat%20covers')
    expect(toUrl('seatcovers')).toBe('https://www.google.com/search?q=seatcovers')
  })
})

describe('BrowserScreen — thumbnail', () => {
  it('idle: offers to open a page, no expand', () => {
    const html = render(session('idle'))
    expect(html).toContain('No browser running')
    expect(html).toContain('Search or enter a URL')
    expect(html).toContain('>Open<')
    expect(html).not.toContain('Expand browser to full screen')
  })

  it('idle: shows why the last open failed', () => {
    expect(render(session('idle', { openError: 'could not open https://x: timed out' }))).toContain('could not open https://x: timed out')
  })

  it('connecting: says so, and can already be expanded', () => {
    const html = render(session('connecting'))
    expect(html).toContain('Starting the browser…')
    expect(html).toContain('Connecting')
    expect(html).toContain('Expand browser to full screen')
  })

  it('live: draws the latest frame, inert', () => {
    const html = render(session('live'))
    expect(html).toContain(`src="${FRAME}"`)
    expect(html).toMatch(/<img[^>]*pointer-events:none/)
    expect(html).toMatch(/<img[^>]*draggable="false"/)
    expect(html).toContain('Live')
    expect(html).toContain('Expand browser to full screen')
  })

  it('ended: says the tab closed, offers neither retry nor expand', () => {
    const html = render(session('ended'))
    expect(html).toContain('Browser session ended')
    expect(html).not.toContain('Resume')
    expect(html).not.toContain('Try again')
    expect(html).not.toContain('Expand browser to full screen')
  })

  it('error: offers Try again', () => {
    const html = render(session('error'))
    expect(html).toContain('Couldn’t connect to the browser')
    expect(html).toContain('Try again')
  })
})

describe('BrowserScreen — full screen', () => {
  it('is a modal dialog with a minimize control and the page address', () => {
    const html = render(session('live', { pageUrl: 'https://skyfare.example/flights?from=SFO' }), true)
    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"|aria-modal="true"[^>]*role="dialog"/)
    expect(html).toContain('Minimize browser')
    expect(html).toContain('skyfare.example/flights?from=SFO')
    expect(html).toContain('Showing in full screen')
    expect(html).not.toContain('Expand browser to full screen')
  })

  it('says it is view only when the agent drives', () => {
    const html = render(session('live'), true)
    expect(html).toContain('View only')
    expect(html).not.toContain('Close browser')
  })

  it('a tab of your own: takes input and can be closed, in full screen only', () => {
    const full = render(session('live', { control: true }), true)
    expect(full).toContain('Close browser')
    expect(full).not.toContain('You’re driving this browser')
    expect(full).toContain('Your browser. Click, type, and scroll here.')
    expect(full).toContain('aria-label="Address"')
    expect(full).not.toContain('View only')
    const thumb = render(session('live', { control: true }))
    expect(thumb).not.toContain('Your browser. Click, type, and scroll here.')
  })

  it('narrates the agent’s current step over the page', () => {
    expect(render(session('live', { currentAction: 'Clicking “Search flights”' }), true)).toContain('Clicking “Search flights”')
  })

  it('shows “No page open” before the backend reports a URL', () => {
    expect(render(session('connecting'), true)).toContain('No page open')
  })
})
