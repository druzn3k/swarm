import { describe, expect, it } from 'vitest'
import { EXP_MAX, Num, parseNum } from '../src/num'

describe('Num strings', () => {
  it('parses canonical and decimal.js forms', () => {
    expect(parseNum('0')).toEqual({ sign: 0, mantissa: 0, exponent: 0 })
    expect(parseNum('123')).toEqual({ sign: 1, mantissa: 1.23, exponent: 2 })
    expect(parseNum('0.005')).toEqual({ sign: 1, mantissa: 5, exponent: -3 })
    expect(parseNum('-2.5e100000')).toEqual({ sign: -1, mantissa: 2.5, exponent: 100000 })
    expect(parseNum('1.5e+21')).toEqual({ sign: 1, mantissa: 1.5, exponent: 21 })
    expect(parseNum('1e-7')).toEqual({ sign: 1, mantissa: 1, exponent: -7 })
    expect(parseNum('123456789012345000000')).toEqual({
      sign: 1,
      mantissa: 1.23456789012345,
      exponent: 20,
    })
    expect(() => parseNum('abc')).toThrow(/not a Num/)
    expect(() => parseNum('')).toThrow(/not a Num/)
  })

  it('compares without overflowing', () => {
    expect(Num.lt('9.99e307', '1e309')).toBe(true)
    expect(Num.gt('1e100000', '9.9e99999')).toBe(true)
    expect(Num.lt('-1e10', '-1e9')).toBe(true)
    expect(Num.lt('-5', '0')).toBe(true)
    expect(Num.eq('1500', '1.5e3')).toBe(true)
    expect(Num.gte('2', '1.99999')).toBe(true)
    expect(Num.cmp('0', '0.0')).toBe(0)
  })

  it('converts to JS numbers', () => {
    expect(Num.toNumber('1.5e3')).toBe(1500)
    expect(Num.toNumber('1e400')).toBe(Infinity)
    expect(Num.toNumber('-1e400')).toBe(-Infinity)
    expect(Num.toNumber('1e-400')).toBe(0)
    expect(Num.isInfinite(`9.99999999999999e${EXP_MAX}`)).toBe(true)
    expect(Num.isInfinite('1e308')).toBe(false)
  })
})
