'use client'

// Bounded-edit forms for the workbench: one field value, one line-item
// property, or the text of one sentence / list item. Input is parsed strictly
// into typed values (money in minor units, quantities in thousandths); a
// parse failure or a refused edit is shown beside the form, never guessed
// around. Saving creates a new revision; Cancel leaves everything untouched.

import React, { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { CURRENCIES } from '@/lib/documents/defaults'
import { invoiceCurrency, isCommercial } from '@/lib/documents/invoice'
import type { Block, CurrencyCode, DocumentSnapshot, Field, FieldValue, InvoiceLineItem, TextRun } from '@/lib/documents/model'
import { formatQuantity, parseMoneyInput } from '@/lib/documents/money'
import type { BoundedEdit } from '@/lib/documents/revisions'

import styles from './workbench.module.css'

type Parse<T> = { ok: true; value: T } | { ok: false; message: string }

/** Called with a bounded edit; returns an error message when the edit is refused. */
export type SaveEdit = (edit: BoundedEdit) => string | null

function parsePercent(input: string): Parse<number> {
  const t = input.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, message: 'Enter a percentage such as 8.25 (up to two decimal places).' }
  const [whole, frac = ''] = t.split('.')
  return { ok: true, value: Number(whole) * 100 + Number(frac.padEnd(2, '0')) }
}

export function parsePercentInput(input: string) { return parsePercent(input) }

export function parseQuantity(input: string): Parse<number> {
  const t = input.trim()
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return { ok: false, message: 'Enter a quantity such as 12.5 (up to three decimal places).' }
  const [whole, frac = ''] = t.split('.')
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, '0'))
  return milli > 0 ? { ok: true, value: milli } : { ok: false, message: 'Quantity must be greater than zero.' }
}

function milliToInput(milli: number): string {
  const whole = Math.floor(milli / 1000)
  const frac = String(milli % 1000).padStart(3, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : String(whole)
}

function minorToInput(amountMinor: number, currency: CurrencyCode): string {
  const digits = CURRENCIES[currency].minorDigits
  if (digits === 0) return String(amountMinor)
  const sign = amountMinor < 0 ? '-' : ''
  const abs = Math.abs(amountMinor)
  return `${sign}${Math.floor(abs / 10 ** digits)}.${String(abs % 10 ** digits).padStart(digits, '0')}`
}

/** Shared form shell: focus on open, Escape cancels, errors announced. */
function EditForm({ title, error, onSave, onCancel, children }: { title: string; error: string | null; onSave: () => void; onCancel: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, textarea, select')?.focus() }, [])
  return (
    <form
      ref={ref}
      className={styles.editForm}
      aria-label={title}
      onSubmit={(e) => { e.preventDefault(); onSave() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
    >
      {children}
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.toolbar}>
        <Button type="submit" size="sm">Save as new revision</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Field ────────────────────────────────────────────────────────────────────

function initialFieldInput(field: Field): string {
  if (field.state.status !== 'provided') {
    if (field.valueType === 'currency') return 'USD'
    if (field.valueType === 'choice') return field.options?.[0]?.value ?? ''
    return ''
  }
  const v = field.state.value
  switch (v.type) {
    case 'text': return v.text
    case 'multiline': return v.lines.join('\n')
    case 'date': return v.iso
    case 'money': return minorToInput(v.money.amountMinor, v.money.currency)
    case 'currency': return v.code
    case 'percent': return `${Math.floor(v.basisPoints / 100)}${v.basisPoints % 100 ? `.${String(v.basisPoints % 100).padStart(2, '0').replace(/0$/, '')}` : ''}`
    case 'choice': return v.option
  }
}

function parseField(field: Field, input: string, snapshot: DocumentSnapshot): Parse<FieldValue> {
  switch (field.valueType) {
    case 'text': return { ok: true, value: { type: 'text', text: input.trim() } }
    case 'multiline': return { ok: true, value: { type: 'multiline', lines: input.split('\n').map((l) => l.trim()).filter(Boolean) } }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(input) ? { ok: true, value: { type: 'date', iso: input } } : { ok: false, message: 'Choose a date.' }
    case 'currency': return input in CURRENCIES ? { ok: true, value: { type: 'currency', code: input as CurrencyCode } } : { ok: false, message: 'Choose a currency.' }
    case 'percent': {
      const p = parsePercent(input)
      return p.ok ? { ok: true, value: { type: 'percent', basisPoints: p.value } } : p
    }
    case 'choice': return { ok: true, value: { type: 'choice', option: input } }
    case 'money': {
      const currency = field.state.status === 'provided' && field.state.value.type === 'money' ? field.state.value.money.currency : isCommercial(snapshot) ? invoiceCurrency(snapshot) : null
      if (!currency) return { ok: false, message: 'Set the document currency before entering an amount.' }
      const r = parseMoneyInput(input, currency)
      return r.ok ? { ok: true, value: { type: 'money', money: r.money } } : r
    }
  }
}

export function FieldEditor({ field, snapshot, onSave, onClose }: { field: Field; snapshot: DocumentSnapshot; onSave: SaveEdit; onClose: () => void }) {
  const [input, setInput] = useState(() => initialFieldInput(field))
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const save = () => {
    const parsed = parseField(field, input, snapshot)
    if (!parsed.ok) { setError(parsed.message); return }
    const refused = onSave({ kind: 'field', fieldId: field.id, value: parsed.value })
    if (refused) setError(refused)
    else onClose()
  }
  const label = <label className={styles.label} htmlFor={id}>{field.label}</label>
  let control: React.ReactNode
  if (field.valueType === 'multiline') control = <textarea id={id} className={styles.input} rows={3} value={input} onChange={(e) => setInput(e.target.value)} />
  else if (field.valueType === 'date') control = <input id={id} className={styles.input} type="date" value={input} onChange={(e) => setInput(e.target.value)} />
  else if (field.valueType === 'currency') control = <select id={id} className={styles.select} value={input} onChange={(e) => setInput(e.target.value)}>{Object.keys(CURRENCIES).map((c) => <option key={c} value={c}>{c}</option>)}</select>
  else if (field.valueType === 'choice') control = <select id={id} className={styles.select} value={input} onChange={(e) => setInput(e.target.value)}>{field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  else control = <input id={id} className={styles.input} inputMode={field.valueType === 'percent' || field.valueType === 'money' ? 'decimal' : undefined} value={input} onChange={(e) => setInput(e.target.value)} />
  return <EditForm title={`Edit ${field.label}`} error={error} onSave={save} onCancel={onClose}>{label}{control}</EditForm>
}

// ── Line item ────────────────────────────────────────────────────────────────

type LineProperty = 'description' | 'quantity' | 'unitPrice'

export function LineItemEditor({ blockId, item, index, snapshot, onSave, onClose }: { blockId: string; item: InvoiceLineItem; index: number; snapshot: DocumentSnapshot; onSave: SaveEdit; onClose: () => void }) {
  const currency = isCommercial(snapshot) ? invoiceCurrency(snapshot) : null
  const [property, setProperty] = useState<LineProperty>('quantity')
  const initial = (p: LineProperty) => (p === 'description' ? item.description ?? '' : p === 'quantity' ? milliToInput(item.quantityMilli) : item.unitPrice ? minorToInput(item.unitPrice.amountMinor, item.unitPrice.currency) : '')
  const [input, setInput] = useState(() => initial('quantity'))
  const [error, setError] = useState<string | null>(null)
  const propId = useId()
  const valueId = useId()
  const save = () => {
    let edit: BoundedEdit
    if (property === 'description') edit = { kind: 'line-item', blockId, itemId: item.id, change: { property, value: input.trim() } }
    else if (property === 'quantity') {
      const q = parseQuantity(input)
      if (!q.ok) { setError(q.message); return }
      edit = { kind: 'line-item', blockId, itemId: item.id, change: { property, quantityMilli: q.value } }
    } else {
      if (!currency) { setError('Set the invoice currency before entering a unit price.'); return }
      const r = parseMoneyInput(input, currency)
      if (!r.ok) { setError(r.message); return }
      edit = { kind: 'line-item', blockId, itemId: item.id, change: { property, value: r.money } }
    }
    const refused = onSave(edit)
    if (refused) setError(refused)
    else onClose()
  }
  return (
    <EditForm title={`Edit line ${index + 1}`} error={error} onSave={save} onCancel={onClose}>
      <p className={styles.muted} style={{ margin: 0 }}>Line {index + 1}: {item.description ?? 'Description not supplied'} · {formatQuantity(item.quantityMilli, snapshot.locale)}{item.unit ? ` ${item.unit}` : ''}</p>
      <label className={styles.label} htmlFor={propId}>Change</label>
      <select id={propId} className={styles.select} value={property} onChange={(e) => { const p = e.target.value as LineProperty; setProperty(p); setInput(initial(p)); setError(null) }}>
        <option value="description">Description</option>
        <option value="quantity">Quantity</option>
        <option value="unitPrice">Unit price{currency ? ` (${currency})` : ''}</option>
      </select>
      <label className={styles.label} htmlFor={valueId}>New value</label>
      {property === 'description'
        ? <textarea id={valueId} className={styles.input} rows={2} value={input} onChange={(e) => setInput(e.target.value)} />
        : <input id={valueId} className={styles.input} inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} />}
    </EditForm>
  )
}

// ── Text of one sentence / list item ─────────────────────────────────────────

export type TextTarget = { blockId: string; item?: number; run: number; label: string; text: string }

/** Every sentence (paragraph run) and list item under a section heading — what a text edit can target. */
export function textTargets(snapshot: DocumentSnapshot): TextTarget[] {
  const out: TextTarget[] = []
  let heading: string | null = null
  const add = (blockId: string, runs: readonly TextRun[], prefix: string, item?: number) => runs.forEach((r, run) => {
    if (r.text.trim().length > 1) out.push({ blockId, item, run, label: `${prefix}${runs.length > 1 ? `, sentence ${run + 1}` : ''}`, text: r.text })
  })
  snapshot.blocks.forEach((b: Block) => {
    if (b.type === 'heading') { heading = b.text; return }
    if (!heading) return
    if (b.type === 'paragraph' || b.type === 'callout') add(b.id, b.runs, `${heading} — ${b.type === 'callout' ? 'note' : b.role === 'pull-quote' ? 'quote' : 'paragraph'} ${b.id}`)
    if (b.type === 'list') b.items.forEach((runs, i) => add(b.id, runs, `${heading} — item ${i + 1}`, i))
  })
  return out
}

export function TextEditor({ target, onSave, onClose }: { target: TextTarget; onSave: SaveEdit; onClose: () => void }) {
  const [input, setInput] = useState(target.text)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const save = () => {
    const refused = onSave({ kind: 'text', blockId: target.blockId, item: target.item, run: target.run, text: input })
    if (refused) setError(refused)
    else onClose()
  }
  return (
    <EditForm title={`Edit text: ${target.label}`} error={error} onSave={save} onCancel={onClose}>
      <label className={styles.label} htmlFor={id}>{target.label}</label>
      <textarea id={id} className={styles.input} rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
      <p className={styles.muted} style={{ margin: 0 }}>Citation markers stay attached to this sentence.</p>
    </EditForm>
  )
}
