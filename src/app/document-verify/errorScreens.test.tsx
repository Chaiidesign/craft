// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PdfFilePreview } from '@/components/documents/PdfFilePreview'
import { FORCED_VIEWER_FAILURE } from '@/components/documents/viewerOpen'

import { SectionBoundary } from './SectionBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no ResizeObserver; the Button's squircle only needs it to exist.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)

describe('section error screen', () => {
  it('a crashing section shows its error and recovers with Try again; siblings keep rendering', async () => {
    let crash = true
    function Fragile() {
      if (crash) throw new Error('Layout exploded.')
      return <section><h2>Restored section</h2><p>Section content</p></section>
    }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => root.render(<><SectionBoundary label="HTML preview (not the PDF)"><Fragile /></SectionBoundary><p>Sibling still here</p></>))
    quiet.mockRestore()
    expect(host.textContent).toContain('This section hit an error: Layout exploded. Your revisions are unchanged.')
    expect(host.textContent).toContain('Sibling still here')
    expect(host.querySelector('[role="alert"]')?.getAttribute('aria-label')).toBe('HTML preview (not the PDF)')
    crash = false
    act(() => button('Try again')!.click())
    expect(host.textContent).toContain('Section content')
    expect(host.textContent).not.toContain('hit an error')
    expect(document.activeElement?.textContent).toBe('Restored section')
  })
})

describe('PDF viewer error', () => {
  it('a viewer failure keeps the download, names the size and offers both ways forward', async () => {
    const showHtml = vi.fn()
    act(() => root.render(<PdfFilePreview bytes={new Uint8Array([37, 80, 68, 70])} url="blob:x" filename="a_v1_beef.pdf" size="73 KB" label="PDF preview (generated file, v1)" forceFailure={FORCED_VIEWER_FAILURE} onShowHtml={showHtml} />))
    await flush()
    expect(host.textContent).toContain('The PDF was generated (73 KB) but the viewer couldn’t show it: Forced viewer failure (scenario 11 only). The download still works.')
    // One message only: the old status line is gone and nothing else announces.
    expect(host.textContent).not.toContain('The PDF could not be shown.')
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(0)
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
    const link = host.querySelector('a[download]')!
    expect(link.getAttribute('href')).toBe('blob:x')
    expect(link.textContent).toBe('Download a_v1_beef.pdf')
    act(() => button('Show the HTML preview')!.click())
    expect(showHtml).toHaveBeenCalledOnce()
    act(() => button('Try the viewer again')!.click())
    expect(document.activeElement?.textContent).toBe('PDF preview (generated file, v1)')
  })

  it('bytes missing from memory is a viewer error too, not an export error', async () => {
    act(() => root.render(<PdfFilePreview bytes={null} url="blob:x" filename="a.pdf" size="1 KB" label="PDF preview (generated file, v1)" />))
    await flush()
    expect(host.textContent).toContain('the viewer couldn’t show it: The generated file is no longer in memory (reloading clears exports). The download still works.')
    expect(button('Show the HTML preview')).toBeUndefined()
  })
})
