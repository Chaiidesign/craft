// Money arithmetic in integer minor units.
//
// Every amount is an integer count of the currency's minor unit. Division —
// the only place rounding can happen — goes through `divideRounded`, with the
// rounding mode passed explicitly. Nothing here reads a formatted string;
// `formatMoney` is output-only and `parseMoneyInput` is the single, strict way
// typed user input becomes an amount.

import { CURRENCIES, type RoundingMode } from './defaults'
import type { CurrencyCode, Money } from './model'

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

function assertSafeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${what} must be a safe integer, got ${value}`)
  }
}

/** `numerator / denominator`, rounded to an integer. Both inputs must be integers. */
export function divideRounded(numerator: number, denominator: number, mode: RoundingMode): number {
  assertSafeInteger(numerator, 'numerator')
  assertSafeInteger(denominator, 'denominator')
  if (denominator === 0) throw new MoneyError('division by zero')

  const sign = Math.sign(numerator) * Math.sign(denominator)
  const n = Math.abs(numerator)
  const d = Math.abs(denominator)
  const quotient = Math.floor(n / d)
  const remainder = n - quotient * d
  const twice = remainder * 2

  let magnitude = quotient
  if (twice > d) magnitude = quotient + 1
  else if (twice === d) magnitude = mode === 'half-up' || quotient % 2 === 1 ? quotient + 1 : quotient

  return sign * magnitude || 0
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertSafeInteger(amountMinor, 'amountMinor')
  return { amountMinor, currency }
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new MoneyError(`cannot add ${a.currency} to ${b.currency}`)
  }
  return money(a.amountMinor + b.amountMinor, a.currency)
}

export function sumMoney(amounts: readonly Money[], currency: CurrencyCode): Money {
  return amounts.reduce((total, amount) => addMoney(total, amount), money(0, currency))
}

/** Quantity (in thousandths) × unit price, rounded to the minor unit. */
export function lineAmount(quantityMilli: number, unitPrice: Money, mode: RoundingMode): Money {
  assertSafeInteger(quantityMilli, 'quantityMilli')
  return money(divideRounded(quantityMilli * unitPrice.amountMinor, 1000, mode), unitPrice.currency)
}

/** `amount × basisPoints / 10 000`, rounded to the minor unit. */
export function percentOf(amount: Money, basisPoints: number, mode: RoundingMode): Money {
  assertSafeInteger(basisPoints, 'basisPoints')
  return money(divideRounded(amount.amountMinor * basisPoints, 10_000, mode), amount.currency)
}

// ── Display ─────────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.NumberFormat>()

function formatterFor(locale: string, currency: CurrencyCode): Intl.NumberFormat {
  const key = `${locale}|${currency}`
  let formatter = formatters.get(key)
  if (!formatter) {
    const digits = CURRENCIES[currency].minorDigits
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    formatters.set(key, formatter)
  }
  return formatter
}

/**
 * The one formatter every surface uses (model inspector, preview, PDF, DOCX,
 * PPTX), so symbol, grouping, decimals and negative sign agree everywhere.
 */
export function formatMoney(value: Money, locale: string): string {
  const digits = CURRENCIES[value.currency].minorDigits
  // Divide for display only. The integer stays the source of truth.
  return formatterFor(locale, value.currency).format(value.amountMinor / 10 ** digits)
}

/** Quantity in thousandths → display text with only the decimals it needs. */
export function formatQuantity(quantityMilli: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(quantityMilli / 1000)
}

export function formatPercent(basisPoints: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(basisPoints / 10_000)
}

// ── Input ───────────────────────────────────────────────────────────────────

export type ParseResult = { ok: true; money: Money } | { ok: false; message: string }

/**
 * Strictly parse typed input like `1234.50` or `-12` into minor units.
 * Accepts an optional leading minus, digits, and at most the currency's
 * minor digits after a `.`. Rejects grouping separators, symbols and
 * exponents rather than guessing what they meant.
 */
export function parseMoneyInput(input: string, currency: CurrencyCode): ParseResult {
  const text = input.trim()
  const digits = CURRENCIES[currency].minorDigits
  if (text === '') return { ok: false, message: 'Enter an amount.' }

  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) {
    return { ok: false, message: 'Use digits with an optional decimal point, e.g. 1234.50 — no symbols or thousands separators.' }
  }
  const [, minus, whole, fraction = ''] = match
  if (fraction.length > digits) {
    return {
      ok: false,
      message: digits === 0
        ? `${currency} has no minor unit; enter a whole number.`
        : `${currency} allows at most ${digits} decimal places.`,
    }
  }

  const amountMinor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
  if (!Number.isSafeInteger(amountMinor)) return { ok: false, message: 'That amount is too large.' }
  // `|| 0` folds `-0` (from input like "-0.00") into 0.
  return { ok: true, money: money((minus ? -amountMinor : amountMinor) || 0, currency) }
}
