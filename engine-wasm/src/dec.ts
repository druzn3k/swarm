// Dec: small immutable arithmetic over Num strings, for frontends that need
// to add, multiply or compare the numbers a View carries (costs times an
// amount, a rate times a velocity unit, a percentage) without calling into
// wasm. It mirrors swarm_num::Num's model: a float mantissa in [1, 10) and an
// integer exponent up to EXP_MAX, rounded to 15 significant digits after
// every operation, so `Dec.from(s).toString() === s` for every canonical Num
// string and results don't carry float noise (`1.15 * 100` is `115`).
//
// It is a display helper, not a second engine: game rules stay in wasm.
// `Dec.MAX` (exponent EXP_MAX) stands for the TS engine's Infinity, as in
// num.ts; dividing by zero gives it.

import { EXP_MAX } from './num'
import type { NumString } from './types'

/** Anything Dec.from takes. */
export type DecLike = Dec | NumString | number

const SIG = 15
const NUM_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

/** 10^n as a float, n small. */
const pow10 = (n: number) => Number(`1e${n}`)

export class Dec {
  /** -1, 0 or 1. */
  readonly sign: -1 | 0 | 1
  /** In [1, 10), 0 for zero. */
  readonly mantissa: number
  readonly exponent: number

  private constructor(sign: -1 | 0 | 1, mantissa: number, exponent: number) {
    this.sign = sign
    this.mantissa = mantissa
    this.exponent = exponent
  }

  static readonly ZERO = new Dec(0, 0, 0)
  static readonly ONE = new Dec(1, 1, 0)
  /** The engine's stand-in for Infinity. */
  static readonly MAX = new Dec(1, 1, EXP_MAX)

  /** Builds a Dec from a sign and a float mantissa of any size, rounded to 15 digits. */
  private static make(sign: number, m: number, e: number): Dec {
    if (sign === 0 || m === 0 || !Number.isFinite(m)) {
      if (!Number.isFinite(m)) return sign < 0 ? Dec.MAX.neg() : Dec.MAX
      return Dec.ZERO
    }
    if (m < 0) {
      m = -m
      sign = -sign
    }
    const shift = Math.floor(Math.log10(m))
    if (shift !== 0) {
      m = shift > 0 ? m / pow10(shift) : m * pow10(-shift)
      e += shift
    }
    m = Number(m.toPrecision(SIG))
    if (m >= 10) {
      m /= 10
      e += 1
    } else if (m < 1) {
      m *= 10
      e -= 1
    }
    if (e >= EXP_MAX) return sign < 0 ? Dec.MAX.neg() : Dec.MAX
    if (e <= -EXP_MAX) return Dec.ZERO
    return new Dec(sign < 0 ? -1 : 1, m, e)
  }

  /** Parses a Num string (or decimal.js's `1.5e+21`), or converts a JS number. NaN and Infinity become MAX. */
  static from(v: DecLike): Dec {
    if (v instanceof Dec) return v
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return Dec.MAX
      if (!Number.isFinite(v)) return v < 0 ? Dec.MAX.neg() : Dec.MAX
      if (v === 0) return Dec.ZERO
      v = String(v)
    }
    const m = NUM_RE.exec(v.trim())
    if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
      if (/^-?Infinity$/.test(v.trim())) return v.trim().startsWith('-') ? Dec.MAX.neg() : Dec.MAX
      throw new Error(`not a Num string: ${JSON.stringify(v)}`)
    }
    const int = m[2]
    const frac = m[3] ?? ''
    const all = int + frac
    const first = all.search(/[1-9]/)
    if (first < 0) return Dec.ZERO
    const exponent = (m[4] ? Number(m[4]) : 0) + int.length - 1 - first
    const digits = all.slice(first, first + 17).replace(/0+$/, '')
    const mantissa = Number(`${digits[0]}.${digits.slice(1) || '0'}`)
    return Dec.make(m[1] === '-' ? -1 : 1, mantissa, exponent)
  }

  isZero(): boolean {
    return this.sign === 0
  }
  isPositive(): boolean {
    return this.sign > 0
  }
  isNegative(): boolean {
    return this.sign < 0
  }
  /** MAX or -MAX (the engine's Infinity). */
  isInfinite(): boolean {
    return this.exponent >= EXP_MAX
  }

  neg(): Dec {
    return this.sign === 0 ? this : new Dec((-this.sign) as -1 | 1, this.mantissa, this.exponent)
  }
  abs(): Dec {
    return this.sign < 0 ? this.neg() : this
  }

  plus(other: DecLike): Dec {
    const b = Dec.from(other)
    if (b.sign === 0) return this
    if (this.sign === 0) return b
    if (this.isInfinite()) return this
    if (b.isInfinite()) return b
    const [hi, lo] = this.exponent >= b.exponent ? [this, b] : [b, this]
    const gap = hi.exponent - lo.exponent
    if (gap > SIG + 2) return hi
    const m = hi.sign * hi.mantissa + lo.sign * lo.mantissa / pow10(gap)
    return Dec.make(1, m, hi.exponent)
  }
  minus(other: DecLike): Dec {
    return this.plus(Dec.from(other).neg())
  }
  times(other: DecLike): Dec {
    const b = Dec.from(other)
    if (this.sign === 0 || b.sign === 0) return Dec.ZERO
    if (this.isInfinite() || b.isInfinite()) return this.sign * b.sign < 0 ? Dec.MAX.neg() : Dec.MAX
    return Dec.make(this.sign * b.sign, this.mantissa * b.mantissa, this.exponent + b.exponent)
  }
  div(other: DecLike): Dec {
    const b = Dec.from(other)
    if (b.sign === 0) return this.sign < 0 ? Dec.MAX.neg() : this.sign === 0 ? Dec.ZERO : Dec.MAX
    if (this.sign === 0) return Dec.ZERO
    if (this.isInfinite()) return this.sign * b.sign < 0 ? Dec.MAX.neg() : Dec.MAX
    if (b.isInfinite()) return Dec.ZERO
    return Dec.make(this.sign * b.sign, this.mantissa / b.mantissa, this.exponent - b.exponent)
  }

  /** Rounds toward -Infinity. */
  floor(): Dec {
    return this.round(Math.floor)
  }
  /** Rounds toward +Infinity. */
  ceil(): Dec {
    return this.round(Math.ceil)
  }
  private round(fn: (n: number) => number): Dec {
    if (this.sign === 0 || this.exponent >= SIG) return this
    if (this.exponent < 0) return Dec.from(fn(this.sign * 0.5))
    return Dec.from(fn(this.toNumber()))
  }

  cmp(other: DecLike): -1 | 0 | 1 {
    const b = Dec.from(other)
    if (this.sign !== b.sign) return this.sign < b.sign ? -1 : 1
    if (this.sign === 0) return 0
    let c: number
    if (this.exponent !== b.exponent) c = this.exponent < b.exponent ? -1 : 1
    else if (this.mantissa !== b.mantissa) c = this.mantissa < b.mantissa ? -1 : 1
    else c = 0
    return (c * this.sign) as -1 | 0 | 1
  }
  eq(other: DecLike): boolean {
    return this.cmp(other) === 0
  }
  gt(other: DecLike): boolean {
    return this.cmp(other) > 0
  }
  gte(other: DecLike): boolean {
    return this.cmp(other) >= 0
  }
  lt(other: DecLike): boolean {
    return this.cmp(other) < 0
  }
  lte(other: DecLike): boolean {
    return this.cmp(other) <= 0
  }

  static max(...vals: DecLike[]): Dec {
    return vals.map(Dec.from).reduce((a, b) => (b.gt(a) ? b : a))
  }
  static min(...vals: DecLike[]): Dec {
    return vals.map(Dec.from).reduce((a, b) => (b.lt(a) ? b : a))
  }

  /** The significant digits, without a point or trailing zeros ("15" for 1500). "0" for zero. */
  digits(): string {
    if (this.sign === 0) return '0'
    return this.mantissa.toPrecision(SIG).replace('.', '').replace(/0+$/, '') || '0'
  }

  /** The nearest JS number (±Infinity past 1.8e308, 0 below 5e-324). */
  toNumber(): number {
    if (this.sign === 0) return 0
    if (this.exponent > 308) return this.sign * Infinity
    if (this.exponent < -324) return 0
    const d = this.digits()
    return this.sign * Number(`${d[0]}.${d.slice(1) || '0'}e${this.exponent}`)
  }

  /** The canonical Num string: plain up to 1e21 like JS numbers, then `1.5e300`. */
  toString(): NumString {
    if (this.sign === 0) return '0'
    if (this.exponent < 21 && this.exponent > -7) return String(this.toNumber())
    const d = this.digits()
    return `${this.sign < 0 ? '-' : ''}${d[0]}${d.length > 1 ? '.' + d.slice(1) : ''}e${this.exponent}`
  }
  toJSON(): NumString {
    return this.toString()
  }
}
