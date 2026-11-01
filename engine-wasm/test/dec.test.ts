import { describe, expect, it } from 'vitest'
import { Dec } from '../src/dec'

const d = Dec.from

describe('Dec', () => {
  it('round-trips canonical Num strings', () => {
    for (const s of ['0', '1', '123', '0.5', '1e-7', '1.5e300', '-2.5e100000', '123456789012345', '1.23456789012345e25', '999999999999999999999']) {
      expect(d(s).toString(), s).toBe(s === '999999999999999999999' ? '1e21' : s)
    }
    expect(d('1.5e+21').toString()).toBe('1.5e21')
    expect(d(35.9).toString()).toBe('35.9')
    expect(() => d('abc')).toThrow(/not a Num/)
  })

  it('does arithmetic without float noise', () => {
    expect(d('1.15').times(100).toString()).toBe('115')
    expect(d('0.1').plus('0.2').toString()).toBe('0.3')
    expect(d('1e300').times('1e300').toString()).toBe('1e600')
    expect(d('1e600').div('2e300').toString()).toBe('5e299')
    expect(d('1e20').plus(1).toString()).toBe('100000000000000000000')
    expect(d('1e40').plus(1).toString()).toBe('1e40')
    expect(d(5).minus(7).toString()).toBe('-2')
    expect(d(3).minus(3).isZero()).toBe(true)
    expect(d(1).div(0).isInfinite()).toBe(true)
    expect(Dec.MAX.times(2).isInfinite()).toBe(true)
  })

  it('floors, ceils, compares', () => {
    expect(d('35.9').floor().toString()).toBe('35')
    expect(d('-35.9').floor().toString()).toBe('-36')
    expect(d('0.2').ceil().toString()).toBe('1')
    expect(d('0.2').floor().toString()).toBe('0')
    expect(d('-0.2').floor().toString()).toBe('-1')
    expect(d('1.5e30').floor().toString()).toBe('1.5e30')
    expect(d('2').gt('1.99999')).toBe(true)
    expect(d('1e100000').gt('9.9e99999')).toBe(true)
    expect(d('-1e10').lt('-1e9')).toBe(true)
    expect(Dec.max(1, '5', d(3)).toString()).toBe('5')
    expect(Dec.min(1, '5', d(3)).toString()).toBe('1')
    expect(d('1.5e3').eq(1500)).toBe(true)
  })

  it('gives digits and numbers', () => {
    expect(d('1500').digits()).toBe('15')
    expect(d('0').digits()).toBe('0')
    expect(d('1.5e400').toNumber()).toBe(Infinity)
    expect(d('123.25').toNumber()).toBe(123.25)
  })
})
