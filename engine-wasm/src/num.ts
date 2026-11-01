// A tiny reader for Num strings (`NumString`), enough to compare and
// convert the numbers a View carries without calling into wasm. Formatting
// stays in wasm for now (`formatShort` / `formatLong` in ./index.ts, the
// app's format.ts rules); the app's full TS formatter port is a later task.
//
// The strings are swarm_num::Num's canonical Display form ("0", "123",
// "0.5", "1.5e300", "-2.5e100000", "1e-7"); decimal.js-style "1.5e+21" is
// accepted too. Exponents go up to swarm_num::EXP_MAX (9e15), which is
// exact as a JS number, so comparisons never overflow.

import type { NumString } from './types'

/** swarm_num::EXP_MAX: Num.MAX (the engine's stand-in for Infinity) has this exponent. */
export const EXP_MAX = 9_000_000_000_000_000

/** A parsed Num: `sign * mantissa * 10^exponent`, `1 <= mantissa < 10` (0 for zero). */
export interface ParsedNum {
  sign: -1 | 0 | 1
  mantissa: number
  exponent: number
}

const NUM_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

const ZERO: ParsedNum = { sign: 0, mantissa: 0, exponent: 0 }

/** Parses a Num string; throws on anything else. */
export function parseNum(s: NumString): ParsedNum {
  const m = NUM_RE.exec(s.trim())
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    throw new Error(`not a Num string: ${JSON.stringify(s)}`)
  }
  const int = m[2]
  const frac = m[3] ?? ''
  let exponent = m[4] ? Number(m[4]) : 0
  const all = int + frac
  const first = all.search(/[1-9]/)
  if (first < 0) return ZERO
  // the first significant digit's power of ten
  exponent += int.length - 1 - first
  const digits = all.slice(first).replace(/0+$/, '')
  const mantissa = Number(`${digits[0]}.${digits.slice(1) || '0'}`)
  return { sign: m[1] === '-' ? -1 : 1, mantissa, exponent }
}

/** -1, 0 or 1 as `a` is less than, equal to or greater than `b`. */
export function compareNum(a: NumString, b: NumString): -1 | 0 | 1 {
  const x = parseNum(a)
  const y = parseNum(b)
  if (x.sign !== y.sign) return x.sign < y.sign ? -1 : 1
  if (x.sign === 0) return 0
  let c: number
  if (x.exponent !== y.exponent) c = x.exponent < y.exponent ? -1 : 1
  else if (x.mantissa !== y.mantissa) c = x.mantissa < y.mantissa ? -1 : 1
  else c = 0
  return (c * x.sign) as -1 | 0 | 1
}

/** The nearest JS number (`±Infinity` past 1.8e308, 0 below 5e-324). */
export function numToNumber(s: NumString): number {
  const p = parseNum(s)
  if (p.sign === 0) return 0
  if (p.exponent > 308) return p.sign * Infinity
  if (p.exponent < -324) return 0
  return Number(s.trim())
}

/** `Num.MAX` / `Num.MIN`: what the engine uses for the TS Infinity. */
export function numIsInfinite(s: NumString): boolean {
  return parseNum(s).exponent >= EXP_MAX
}

/** Helpers over Num strings. */
export const Num = {
  parse: parseNum,
  cmp: compareNum,
  eq: (a: NumString, b: NumString) => compareNum(a, b) === 0,
  lt: (a: NumString, b: NumString) => compareNum(a, b) < 0,
  lte: (a: NumString, b: NumString) => compareNum(a, b) <= 0,
  gt: (a: NumString, b: NumString) => compareNum(a, b) > 0,
  gte: (a: NumString, b: NumString) => compareNum(a, b) >= 0,
  isZero: (a: NumString) => parseNum(a).sign === 0,
  isInfinite: numIsInfinite,
  toNumber: numToNumber,
} as const
