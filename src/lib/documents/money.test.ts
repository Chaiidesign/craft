import { describe, expect, it } from 'vitest'

import { divideRounded, formatMoney, lineAmount, money, MoneyError, parseMoneyInput, percentOf, sumMoney } from '@/lib/documents/money'

describe('divideRounded', () => {
  it.each([
    // numerator, denominator, half-up, half-even
    [25, 10, 3, 2],
    [35, 10, 4, 4],
    [24, 10, 2, 2],
    [26, 10, 3, 3],
    [-25, 10, -3, -2],
    [-35, 10, -4, -4],
    [0, 7, 0, 0],
  ])('%i / %i → half-up %i, half-even %i', (n, d, up, even) => {
    expect(divideRounded(n, d, 'half-up')).toBe(up)
    expect(divideRounded(n, d, 'half-even')).toBe(even)
  })

  it('never returns negative zero', () => {
    expect(Object.is(divideRounded(-4, 10, 'half-up'), 0)).toBe(true)
  })

  it('rejects non-integers and division by zero', () => {
    expect(() => divideRounded(1.5, 10, 'half-up')).toThrow(MoneyError)
    expect(() => divideRounded(1, 0, 'half-up')).toThrow(MoneyError)
  })
})

describe('line and percentage arithmetic', () => {
  it('multiplies a fractional quantity in thousandths without floats', () => {
    // 12.5 h × $185.00 = $2,312.50
    expect(lineAmount(12_500, money(18_500, 'USD'), 'half-up')).toEqual(money(231_250, 'USD'))
    // 0.5 × $0.05 = 2.5¢ → rounding mode decides
    expect(lineAmount(500, money(5, 'USD'), 'half-up').amountMinor).toBe(3)
    expect(lineAmount(500, money(5, 'USD'), 'half-even').amountMinor).toBe(2)
  })

  it('takes a percentage in basis points', () => {
    expect(percentOf(money(694_210, 'USD'), 825, 'half-up').amountMinor).toBe(57_272)
    expect(percentOf(money(730_747, 'USD'), 500, 'half-up').amountMinor).toBe(36_537)
  })

  it('refuses to add different currencies', () => {
    expect(() => sumMoney([money(1, 'USD'), money(1, 'EUR')], 'USD')).toThrow(MoneyError)
  })

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in minor units it is 30.
    expect(sumMoney([money(10, 'USD'), money(20, 'USD')], 'USD').amountMinor).toBe(30)
  })
})

describe('formatMoney', () => {
  it('uses one presentation per currency and locale', () => {
    expect(formatMoney(money(751_482, 'USD'), 'en-US')).toBe('$7,514.82')
    expect(formatMoney(money(-36_537, 'USD'), 'en-US')).toBe('-$365.37')
    expect(formatMoney(money(12_345_678, 'INR'), 'en-IN')).toBe('₹1,23,456.78')
    expect(formatMoney(money(167_750, 'EUR'), 'en-IE')).toBe('€1,677.50')
    expect(formatMoney(money(1_200, 'JPY'), 'ja-JP')).toBe('￥1,200')
  })
})

describe('parseMoneyInput', () => {
  it('parses plain decimal input into minor units', () => {
    expect(parseMoneyInput('1234.5', 'USD')).toEqual({ ok: true, money: money(123_450, 'USD') })
    expect(parseMoneyInput(' -12 ', 'USD')).toEqual({ ok: true, money: money(-1_200, 'USD') })
    expect(parseMoneyInput('1200', 'JPY')).toEqual({ ok: true, money: money(1_200, 'JPY') })
  })

  it('rejects input it would have to guess at, with a specific message', () => {
    for (const input of ['$1,200.00', '1,200', '1e3', 'twelve']) {
      const result = parseMoneyInput(input, 'USD')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toMatch(/digits/)
    }
    const tooPrecise = parseMoneyInput('1.234', 'USD')
    expect(tooPrecise).toEqual({ ok: false, message: 'USD allows at most 2 decimal places.' })
    expect(parseMoneyInput('12.5', 'JPY')).toEqual({ ok: false, message: 'JPY has no minor unit; enter a whole number.' })
    expect(parseMoneyInput('   ', 'USD')).toEqual({ ok: false, message: 'Enter an amount.' })
  })
})
