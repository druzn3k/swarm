import Decimal from "decimal.js";
import { util, sum, assert, onAssertionFailure, isFloatEqual } from "../src";

describe("util", () => {
  it("should do something", () => {
    expect(!!util).toBe(true);
  });

  it("sums", () => {
    expect(sum([])).toBe(0);
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([1, 2, -3])).toBe(0);
  });

  it("imports decimal.js bignums", () => {
    expect(!!Decimal).toBe(true);
    expect(new Decimal("1e+500").times(2).toString()).toBe("2e+500");
  });

  it("asserts", () => {
    const seen: any[] = [];
    onAssertionFailure((m) => seen.push(m));
    expect(assert(5, "ok")).toBe(5);
    expect(() => assert(0, "bad", 1)).toThrow("bad,1");
    expect(seen).toEqual([["bad", 1]]);
  });

  it("compares floats", () => {
    expect(isFloatEqual(1, 1.05, 0.1)).toBe(true);
    expect(isFloatEqual(1, 1.05)).toBe(false);
  });
});
