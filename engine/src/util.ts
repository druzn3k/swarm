// Port of services/util.coffee. Only the engine-relevant helpers are kept; the
// browser/Angular bits (requestAnimationFrame, animateController,
// isWindowFocused, utcdoy) belong to the UI layer.
import * as _ from "./lodash";

// Replacement for $rootScope.$emit 'assertionFailure' / 'error'. The UI layer
// can subscribe; by default nothing happens.
export type UtilListener = (message: any[]) => void;
const assertionFailureListeners: UtilListener[] = [];
const errorListeners: UtilListener[] = [];

export function onAssertionFailure(fn: UtilListener): void {
  assertionFailureListeners.push(fn);
}
export function onError(fn: UtilListener): void {
  errorListeners.push(fn);
}

export function sum(ns: number[]): number {
  return _.reduce(ns, (a, b) => a + b, 0);
}

export function assert<T>(val: T, ...message: any[]): T {
  if (!val) {
    for (const fn of assertionFailureListeners) fn(message);
    // coffee: `throw new Error message` where message is an array; the array
    // is stringified (comma-joined).
    throw new Error(String(message));
  }
  return val;
}

export function error(...message: any[]): void {
  for (const fn of errorListeners) fn(message);
}

export function isFloatEqual(a: number, b: number, tolerance: number = 0): boolean {
  return Math.abs(a - b) <= tolerance;
}

export const util = { sum, assert, error, isFloatEqual };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `date.toString()` exactly as V8 prints it with TZ=UTC, e.g.
 * "Wed Jan 01 2020 00:00:00 GMT+0000 (Coordinated Universal Time)".
 *
 * The old engine stringified Dates (timezone-dependent) in a few places that
 * matter, notably random seeds (seedrand.mkseed). We always render them as a
 * browser in UTC would, so results don't depend on the host's timezone.
 */
export function utcDateString(d: Date): string {
  if (isNaN(d.getTime())) return "Invalid Date";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = d.getUTCFullYear();
  const year = y < 0 ? "-" + p(-y, 6) : p(y, 4);
  return (
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())} ${year} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

/** String interpolation the way the old engine saw it: Dates render as utcDateString. */
export function str(v: unknown): string {
  return v instanceof Date ? utcDateString(v) : String(v);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** window.btoa for latin1 strings, without depending on a browser or Buffer. */
export function btoa(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i) & 0xff;
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) & 0xff : NaN;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) & 0xff : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
    out += isNaN(b) ? "=" : B64[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
    out += isNaN(c) ? "=" : B64[c & 63];
  }
  return out;
}

/** window.atob, lenient like Node's Buffer.from(s, 'base64'): unknown characters are skipped. */
export function atob(s: string): string {
  let out = "";
  let bits = 0;
  let nbits = 0;
  for (const ch of s) {
    if (ch === "=") break;
    const v = B64.indexOf(ch === "-" ? "+" : ch === "_" ? "/" : ch);
    if (v < 0) continue;
    bits = (bits << 6) | v;
    nbits += 6;
    if (nbits >= 8) {
      nbits -= 8;
      out += String.fromCharCode((bits >> nbits) & 0xff);
    }
  }
  return out;
}

/** CoffeeScript's exclusive range `[0...n]` (counts down when n < 0). */
export function coffeeRange(n: number): number[] {
  const ret: number[] = [];
  if (0 <= n) for (let j = 0; j < n; j++) ret.push(j);
  else for (let j = 0; j > n; j--) ret.push(j);
  return ret;
}
