// Port of services/util.coffee. Only the engine-relevant helpers are kept; the
// browser/Angular bits (requestAnimationFrame, animateController,
// isWindowFocused, utcdoy) belong to the UI layer.
import * as _ from "lodash";

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
