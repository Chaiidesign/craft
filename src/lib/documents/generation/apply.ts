// Gate layer 2: applies a schema-valid list of operations to a base snapshot,
// all or nothing. Every operation is checked against the document as it stands
// (targets exist, digests match, values convert, quotes are real) and every
// problem is reported, so a model can fix them all in one retry. Line item IDs
// are assigned here by the host; a model never picks an ID.

import { INVOICE_FIELDS } from '../invoice'
import type { CurrencyCode, DocumentEnv, Field, FieldState, FieldValue, InvoiceLineItem, InvoiceSnapshot, Money, NotApplicableRule, Provenance } from '../model'
import { parseMoneyInput } from '../money'
import { BRAND_OWNED_FIELDS, isCalendarDate } from '../revisions'
import { isUnbranded } from '../templates/brand'
import { INVOICE_BLOCKS } from '../templates/invoice'
import { digest } from './digest'
import { gateError, type GateError } from './errors'
import type { GenerationValue, Operation } from './ops'

export type Caller = 'model' | 'direct'

export interface ApplyContext {
  env: DocumentEnv
  caller: Caller
  /** Everything the person wrote that a `prompt` quote may come from. Empty for direct callers. */
  sourceText: string
  /** Revising an existing revision: every operation on an existing target must quote its digest. */
  revising: boolean
}

export type ApplyResult =
  | { ok: true; snapshot: InvoiceSnapshot; targets: string[] }
  | { ok: false; errors: GateError[] }

const NA_RULE: Readonly<Record<string, NotApplicableRule>> = {
  [INVOICE_FIELDS.taxRate]: 'tax-rate-when-exempt',
  [INVOICE_FIELDS.discountRate]: 'discount-when-none',
}

/** Lower case, straight quotes, single spaces: a quote matches however the person typed it. */
export function normaliseQuote(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
}

/** "2400.50" → "2400.5"; the digits a stated number must show somewhere in its quote. */
function significant(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal
}

const digitsOf = (text: string) => text.replace(/[,\s '_]/g, '')

function parseScaled(decimal: string, scale: number): number | null {
  const [whole, fraction = ''] = decimal.split('.')
  if (fraction.length > scale) return null
  const n = Number(whole) * 10 ** scale + Number(fraction.padEnd(scale, '0') || '0')
  return Number.isSafeInteger(n) ? n : null
}

export const lineKey = (itemId: string) => `line:${itemId}`
export const fieldKey = (fieldId: string) => `field:${fieldId}`

export function applyOperations(base: InvoiceSnapshot, operations: readonly Operation[], ctx: ApplyContext, pathPrefix = 'operations'): ApplyResult {
  const errors: GateError[] = []
  const fields: Record<string, Field> = { ...base.fields }
  const provenance: Record<string, Provenance> = { ...(base.provenance ?? {}) }
  const linesBlock = base.blocks.find((b) => b.id === INVOICE_BLOCKS.lines)
  let items: InvoiceLineItem[] = linesBlock?.type === 'line-items' ? [...linesBlock.items] : []
  const targets: string[] = []
  const source = normaliseQuote(ctx.sourceText)

  // The invoice currency after this proposal: set in it, or already on the document.
  const currencyOp = operations.find((o) => o.op === 'setField' && o.fieldId === INVOICE_FIELDS.currency && o.value.type === 'currency')
  const currencyState = base.fields[INVOICE_FIELDS.currency]?.state
  const currency: CurrencyCode | null = currencyOp?.op === 'setField' && currencyOp.value.type === 'currency'
    ? currencyOp.value.code
    : currencyState?.status === 'provided' && currencyState.value.type === 'currency' ? currencyState.value.code : null

  const checkProvenance = (p: Provenance, path: string, target: string, numbers: string[] = []): boolean => {
    if (ctx.caller === 'model' && p.source !== 'prompt') {
      errors.push(gateError('provenance-not-allowed', `${path}.provenance`, 'A model must quote the request for every value it sets (source "prompt").', target))
      return false
    }
    if (ctx.caller === 'direct' && p.source !== 'caller') {
      errors.push(gateError('provenance-not-allowed', `${path}.provenance`, 'Direct callers supply values themselves (source "caller"); there is no request to quote.', target))
      return false
    }
    if (p.source === 'prompt') {
      const quote = normaliseQuote(p.evidence)
      if (!source.includes(quote)) {
        errors.push(gateError('evidence-not-found', `${path}.provenance.evidence`, `“${p.evidence}” is not in the request. Quote the request's own words, or leave the value unknown.`, target))
        return false
      }
      for (const n of numbers) {
        if (!digitsOf(quote).includes(significant(n))) {
          errors.push(gateError('evidence-not-found', `${path}.provenance.evidence`, `The quote “${p.evidence}” does not state ${n}. Numbers must come from the request.`, target))
          return false
        }
      }
    }
    return true
  }

  const toMoney = (amount: string, path: string, target: string): Money | null => {
    if (!currency) {
      errors.push(gateError('currency-required', path, 'Set the invoice currency (field invoice.currency) before giving amounts.', target))
      return null
    }
    const parsed = parseMoneyInput(amount, currency)
    if (!parsed.ok) {
      errors.push(gateError('invalid-value', path, `${amount}: ${parsed.message}`, target))
      return null
    }
    return parsed.money
  }

  const toQuantity = (quantity: string, path: string, target: string): number | null => {
    const milli = parseScaled(quantity, 3)
    if (milli === null || milli <= 0) {
      errors.push(gateError('invalid-value', path, `Quantity ${quantity} must be greater than zero with at most three decimal places.`, target))
      return null
    }
    return milli
  }

  const toFieldValue = (field: Field, value: GenerationValue, path: string, target: string): FieldValue | null => {
    if (value.type !== field.valueType) {
      errors.push(gateError('wrong-type', `${path}.value.type`, `${field.label} takes a ${field.valueType} value, not ${value.type}.`, target))
      return null
    }
    switch (value.type) {
      case 'text': {
        const text = value.text.trim()
        if (!text) { errors.push(gateError('invalid-value', `${path}.value.text`, `${field.label} cannot be blank; use markUnknown instead.`, target)); return null }
        return { type: 'text', text }
      }
      case 'multiline': {
        const lines = value.lines.map((l) => l.trim()).filter(Boolean)
        if (lines.length === 0) { errors.push(gateError('invalid-value', `${path}.value.lines`, `${field.label} cannot be blank; use markUnknown instead.`, target)); return null }
        return { type: 'multiline', lines }
      }
      case 'date':
        if (!isCalendarDate(value.iso)) { errors.push(gateError('invalid-value', `${path}.value.iso`, `${value.iso} is not a real calendar date.`, target)); return null }
        return value
      case 'currency':
        return value
      case 'money': {
        if (currency && value.currency !== currency) { errors.push(gateError('invalid-value', `${path}.value.currency`, `${field.label} is in ${value.currency}, but this invoice is in ${currency}.`, target)); return null }
        const money = toMoney(value.amount, `${path}.value.amount`, target)
        return money ? { type: 'money', money } : null
      }
      case 'percent': {
        const bp = parseScaled(value.percent, 2)
        if (bp === null || bp > 10_000) { errors.push(gateError('invalid-value', `${path}.value.percent`, `${field.label} must be between 0 and 100 with at most two decimal places.`, target)); return null }
        return { type: 'percent', basisPoints: bp }
      }
      case 'choice':
        if (!field.options?.some((o) => o.value === value.option)) {
          errors.push(gateError('invalid-value', `${path}.value.option`, `“${value.option}” is not an option for ${field.label}. Options: ${(field.options ?? []).map((o) => o.value).join(', ')}.`, target))
          return null
        }
        return value
    }
  }

  const fieldFor = (fieldId: string, expectedDigest: string | undefined, path: string): Field | null => {
    const target = fieldKey(fieldId)
    const field = fields[fieldId]
    if (!field) { errors.push(gateError('unknown-target', `${path}.fieldId`, `This document has no field ${fieldId}.`, target)); return null }
    if (BRAND_OWNED_FIELDS[fieldId] && !isUnbranded(base.brand)) {
      errors.push(gateError('brand-owned', `${path}.fieldId`, BRAND_OWNED_FIELDS[fieldId], target, false))
      return null
    }
    if (ctx.revising) {
      const current = digest(base.fields[fieldId].state)
      if (!expectedDigest) { errors.push(gateError('missing-digest', `${path}.expectedDigest`, `Quote the digest of ${fieldId} (${current}) to change it.`, target)); return null }
      if (expectedDigest !== current) { errors.push(gateError('stale-target', `${path}.expectedDigest`, `${fieldId} has changed since it was read (digest ${current}, not ${expectedDigest}). Read the document again.`, target)); return null }
    }
    return field
  }

  const setState = (fieldId: string, state: FieldState) => {
    fields[fieldId] = { ...fields[fieldId], state }
    targets.push(fieldKey(fieldId))
  }

  const itemFor = (itemId: string, expectedDigest: string, path: string): number => {
    const index = items.findIndex((i) => i.id === itemId)
    const target = lineKey(itemId)
    if (index < 0) { errors.push(gateError('unknown-target', `${path}.itemId`, `This invoice has no line item ${itemId}.`, target)); return -1 }
    const original = (linesBlock?.type === 'line-items' ? linesBlock.items : []).find((i) => i.id === itemId)
    const current = digest(original ?? items[index])
    if (expectedDigest !== current) { errors.push(gateError('stale-target', `${path}.expectedDigest`, `Line item ${itemId} has changed since it was read (digest ${current}, not ${expectedDigest}). Read the document again.`, target)); return -1 }
    return index
  }

  operations.forEach((op, i) => {
    const path = `${pathPrefix}[${i}]`
    switch (op.op) {
      case 'setField': {
        const field = fieldFor(op.fieldId, op.expectedDigest, path)
        if (!field) return
        const target = fieldKey(op.fieldId)
        const numbers = op.value.type === 'money' ? [op.value.amount] : op.value.type === 'percent' ? [op.value.percent] : []
        if (!checkProvenance(op.provenance, path, target, numbers)) return
        const value = toFieldValue(field, op.value, path, target)
        if (!value) return
        setState(op.fieldId, { status: 'provided', value })
        provenance[target] = op.provenance
        return
      }
      case 'markUnknown': {
        if (!fieldFor(op.fieldId, op.expectedDigest, path)) return
        setState(op.fieldId, { status: 'missing' })
        delete provenance[fieldKey(op.fieldId)]
        return
      }
      case 'setNotApplicable': {
        if (!fieldFor(op.fieldId, op.expectedDigest, path)) return
        setState(op.fieldId, { status: 'not-applicable', rule: NA_RULE[op.fieldId] })
        delete provenance[fieldKey(op.fieldId)]
        return
      }
      case 'addLineItem': {
        const id = ctx.env.nextId('li')
        const target = lineKey(id)
        if (!checkProvenance(op.provenance, path, target, op.unitPrice ? [op.unitPrice.amount] : [])) return
        const quantityMilli = toQuantity(op.quantity, `${path}.quantity`, target)
        const unitPrice = op.unitPrice ? toMoney(op.unitPrice.amount, `${path}.unitPrice.amount`, target) : null
        if (quantityMilli === null || (op.unitPrice && !unitPrice)) return
        const description = op.description?.trim() || null
        items = [...items, { id, description, quantityMilli, unitPrice, ...(op.unit ? { unit: op.unit } : {}) }]
        provenance[target] = op.provenance
        targets.push(target)
        return
      }
      case 'updateLineItem': {
        const index = itemFor(op.itemId, op.expectedDigest, path)
        if (index < 0) return
        const target = lineKey(op.itemId)
        if (!checkProvenance(op.provenance, path, target, op.unitPrice ? [op.unitPrice.amount] : [])) return
        const next: InvoiceLineItem = { ...items[index] }
        if (op.description !== undefined) next.description = op.description?.trim() || null
        if (op.quantity !== undefined) {
          const q = toQuantity(op.quantity, `${path}.quantity`, target)
          if (q === null) return
          next.quantityMilli = q
        }
        if (op.unit !== undefined) {
          if (op.unit === null) delete next.unit
          else next.unit = op.unit
        }
        if (op.unitPrice !== undefined) {
          const price = op.unitPrice ? toMoney(op.unitPrice.amount, `${path}.unitPrice.amount`, target) : null
          if (op.unitPrice && !price) return
          next.unitPrice = price
        }
        items = items.map((it, k) => (k === index ? next : it))
        provenance[target] = op.provenance
        targets.push(target)
        return
      }
      case 'removeLineItem': {
        const index = itemFor(op.itemId, op.expectedDigest, path)
        if (index < 0) return
        items = items.filter((_, k) => k !== index)
        delete provenance[lineKey(op.itemId)]
        targets.push(lineKey(op.itemId))
        return
      }
    }
  })

  if (errors.length > 0) return { ok: false, errors }
  const blocks = base.blocks.map((b) => (b.id === INVOICE_BLOCKS.lines && b.type === 'line-items' ? { ...b, items } : b))
  return { ok: true, snapshot: { ...base, fields, blocks, provenance }, targets: [...new Set(targets)] }
}
