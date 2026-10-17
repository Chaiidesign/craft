// @vitest-environment jsdom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import { findForbiddenWords } from '@/lib/output-system/words'

import { OutputVerify } from './OutputVerify'

describe('/output-verify shell', () => {
  const html = renderToStaticMarkup(<OutputVerify />)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const text = doc.body.textContent ?? ''

  it('labels the data as sample data and shows both stores', () => {
    expect(text).toContain('Sample data: fictional stores, customers and orders')
    expect(text).toContain('Saffron Loom Textiles')
    expect(text).toContain('Fernhill Goods Co.')
    expect(text).toContain('60 products · 200 customers · 500 orders')
  })

  it('shows the four launch kinds as being built and the rest as coming later', () => {
    const status = (label: string) =>
      [...doc.querySelectorAll('li')].find((li) => li.textContent?.startsWith(label))?.querySelector('[data-status]')?.textContent
    for (const k of ['Chat reply', 'File', 'Strict document', 'Composed document', 'Format not supported']) expect(status(k), k).toBe('Being built')
    for (const k of ['Message card', 'Inline chart', 'Design', 'Dashboard', 'Published page']) expect(status(k), k).toBe('Coming later')
  })

  it('lists what is being built before what comes later', () => {
    const states = [...doc.querySelectorAll('li [data-status]')].map((el) => el.getAttribute('data-status'))
    const firstLater = states.indexOf('coming-later')
    expect(firstLater).toBeGreaterThan(0)
    expect(states.slice(firstLater).every((st) => st === 'coming-later')).toBe(true)
  })

  it('keeps the request box disabled until requests work, and says why', () => {
    const box = doc.querySelector('textarea')
    expect(box?.hasAttribute('disabled')).toBe(true)
    expect(text).toContain('Not ready yet. Making things from a request comes next.')
  })

  it('uses no system words on screen', () => {
    expect(findForbiddenWords(text)).toEqual([])
  })
})
