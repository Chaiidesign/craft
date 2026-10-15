// Proposed prototype defaults, in one place so they can be changed without
// touching logic. These are requirements to test — not claims that Souvenir
// implements them today.

import type { CurrencyCode } from './model'

export type RoundingMode = 'half-up' | 'half-even'

export interface CurrencySpec {
  /** Digits after the decimal point (JPY has none). */
  minorDigits: number
}

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencySpec>> = {
  USD: { minorDigits: 2 },
  EUR: { minorDigits: 2 },
  GBP: { minorDigits: 2 },
  INR: { minorDigits: 2 },
  JPY: { minorDigits: 0 },
}

export const DOCUMENT_DEFAULTS = {
  /**
   * Applied wherever an amount is divided (line quantity × price, percentage
   * discount, tax). Half-up away from zero is the common invoicing convention;
   * half-even is available for issuers who require it. Line amounts are
   * rounded per line; discount and tax are computed once on the summed amounts.
   */
  rounding: 'half-up' as RoundingMode,
} as const
