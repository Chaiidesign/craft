import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { fixedEnv, text } from '@/lib/documents/fixtures/builders'
import { completeInvoice } from '@/lib/documents/fixtures/invoices'
import { SAMPLE_REVIEWER } from '@/lib/documents/fixtures/revisions'
import { createDocument, emptyStore, markApproved, saveEdit } from '@/lib/documents/revisions'

import { DocumentWorkbench } from './DocumentWorkbench'
import { parsePercentInput, parseQuantity, textTargets } from './Editors'
import { HistoryPanel, RevisionBar } from './RevisionPanels'
import { nodeResources } from '@/lib/documents/testing/nodeResources'
import { readPdf } from '@/lib/documents/testing/pdfText'

import { runApprovedThenEdited, runBoundedEdit, runErrorsAndRecovery, runPartialExport, runRestore, type ExportDeps } from './scenarios'

const NODE_DEPS: ExportDeps = { resources: async (s) => nodeResources(s), pdfPageTexts: async (b) => (await readPdf(b)).pages.map((p) => p.text) }

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('scenario runners (fixtures 6, 7, 8, 9, 11)', () => {
  it.each([
    ['bounded edit', runBoundedEdit],
    ['approved then edited', () => runApprovedThenEdited(NODE_DEPS)],
    ['restore', runRestore],
    ['partial export', () => runPartialExport(NODE_DEPS)],
    ['errors and recovery', () => runErrorsAndRecovery(NODE_DEPS)],
  ])('%s: every check passes, none deferred', async (_, run) => {
    const checks = await run()
    expect(checks.length).toBeGreaterThan(2)
    for (const c of checks) expect(c.result, `${c.label}: ${c.detail}`).toBe('pass')
  })
})

describe('strict input parsing', () => {
  it('parses quantities in thousandths and refuses anything else', () => {
    expect(parseQuantity('12.5')).toEqual({ ok: true, value: 12_500 })
    expect(parseQuantity('3')).toEqual({ ok: true, value: 3_000 })
    for (const bad of ['0', '-1', '1.2345', '1,5', 'ten', '']) expect(parseQuantity(bad).ok, bad).toBe(false)
  })
  it('parses percentages in basis points', () => {
    expect(parsePercentInput('8.25')).toEqual({ ok: true, value: 825 })
    expect(parsePercentInput('5')).toEqual({ ok: true, value: 500 })
    for (const bad of ['8.255', '-1', 'x', '']) expect(parsePercentInput(bad).ok, bad).toBe(false)
  })
})

describe('brand-owned fields', () => {
  it('the rendered workbench offers no Edit control for the issuer name, and says why', () => {
    const html = renderToStaticMarkup(<DocumentWorkbench />)
    const rows = html.split('role="listitem"').slice(1)
    const issuer = rows.find((r) => r.includes('aria-label="Issuer:'))!
    const address = rows.find((r) => r.includes('aria-label="Issuer address:'))!
    expect(issuer).toBeDefined()
    expect(issuer).not.toContain('<button')
    expect(strip(issuer)).toContain('The issuer name comes from the issuer’s brand profile, so it can’t be edited here.')
    // The address stays editable; other fields offer Edit too.
    expect(address).toContain('aria-label="Edit Issuer address"')
    expect(html).toContain('aria-label="Edit Payment terms"')
  })
})

describe('text edit targets', () => {
  it('offers only sentences and list items under a section heading', () => {
    expect(textTargets(completeInvoice())).toEqual([])
  })
})

describe('history and viewing labels (approved wording)', () => {
  function store() {
    const env = fixedEnv()
    let { store: s } = createDocument(emptyStore(), env, completeInvoice(), { outputId: 'out-x' })
    const v1 = s.documents.get('out-x')!.currentRevisionId
    s = markApproved(s, env, v1, SAMPLE_REVIEWER)
    const r2 = saveEdit(s, env, 'out-x', v1, { kind: 'field', fieldId: 'payment.terms', value: text('Net 15.') })
    return { store: r2.store, v1, v2: r2.revision.revisionId }
  }

  it('labels the current revision and an older viewed one', () => {
    const { store: s, v1, v2 } = store()
    expect(strip(renderToStaticMarkup(<RevisionBar store={s} outputId="out-x" viewedId={v2} onViewCurrent={() => {}} />))).toContain('v2 · Current')
    const older = strip(renderToStaticMarkup(<RevisionBar store={s} outputId="out-x" viewedId={v1} onViewCurrent={() => {}} />))
    expect(older).toContain('Viewing v1 — not the current revision')
    expect(older).toMatch(/Approved \(sample\) by Sample reviewer \(fictional\) on \d+ \w+ \d{4} — applies to v1 only/)
  })

  it('history shows each revision with summary, author, parent and approval; only past revisions offer Restore', () => {
    const { store: s, v2 } = store()
    const html = renderToStaticMarkup(<HistoryPanel store={s} outputId="out-x" viewedId={v2} onView={() => {}} onRestore={() => {}} onApprove={() => {}} />)
    const out = strip(html)
    expect(out).toContain('Edited Payment terms')
    expect(out).toContain('Sample operator (fictional) · from v1')
    expect(out).toContain('System · first revision')
    expect(out).toContain('Not approved')
    expect(html.match(/aria-label="Restore version v1"/g)?.length).toBe(1)
    expect(html).not.toContain('aria-label="Restore version v2"')
  })
})
