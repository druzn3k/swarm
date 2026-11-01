import { describe, expect, it } from "vitest";
import { Dec } from "@swarmsim/engine-wasm";
import { createFormatter, formatDuration, formatNumber, formatPercent } from "./format";

describe("formatNumber", () => {
  it("writes small numbers out, rounding down", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(35.9)).toBe("35");
    expect(formatNumber(99999)).toBe("99,999");
  });
  it("uses short suffixes from 1e5, three sigfigs, rounding down", () => {
    expect(formatNumber(1e5)).toBe("100K");
    expect(formatNumber(123456789)).toBe("123M");
    expect(formatNumber(Dec.from("1.999e9"))).toBe("1.99B");
    expect(formatNumber(Dec.from("1e300"))).toMatch(/^1\w+$/);
  });
  it("falls back to exponents past the last suffix", () => {
    expect(formatNumber(Dec.from("1.5e10000"))).toBe("1.5e10000");
  });
  it("supports the other notations", () => {
    expect(formatNumber(1.5e9, { notation: "scientific-e" })).toBe("1.5e9");
    expect(formatNumber(1.5e9, { notation: "engineering" })).toBe("1.5E9");
    expect(formatNumber(1e40, { notation: "hybrid" })).toBe("1e40");
    expect(formatNumber(1.5e9, { flavor: "full", sigfigs: 6, minSuffix: 1e6 })).toBe("1.5 billion");
  });
  it("keeps decimals below maxSmall", () => {
    expect(formatNumber(1.25, { maxSmall: 2 })).toBe("1.25");
    expect(formatNumber(0.5, { maxSmall: 2 })).toBe("0.5");
    // trailing zeros are dropped (the old game kept them: "1.00000")
    expect(formatNumber(1, { maxSmall: 2, sigfigs: 6 })).toBe("1");
  });
  it("handles odd input", () => {
    expect(formatNumber(undefined)).toBe("");
    expect(formatNumber(Dec.from(Infinity))).toBe("∞");
    expect(formatNumber(NaN)).toBe("?");
    expect(formatNumber("1.5e9000000000000000")).toBe("∞");
  });
});

describe("formatPercent", () => {
  it("formats", () => {
    expect(formatPercent(0.256, { floor: true })).toBe("25%");
    expect(formatPercent(1.25, { plusOne: true })).toBe("25%");
    expect(formatPercent(0.5)).toBe("50%");
  });
});

describe("formatDuration", () => {
  it("is empty for zero, never and unknown", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(Infinity)).toBe("");
    expect(formatDuration(NaN)).toBe("");
  });
  it("abbreviates", () => {
    expect(formatDuration(5)).toBe("00:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(90000)).toBe("1 day 1 hour");
    expect(formatDuration(5, { nonexact: true })).toBe("00:05 or less");
  });
  it("has full and human styles", () => {
    expect(formatDuration(90061, { format: "full" })).toBe("1 day 1:01:01");
    expect(formatDuration(3 * 3600, { format: "human" })).toBe("3 hours");
  });
});

describe("createFormatter", () => {
  it("formats rates in the velocity unit", () => {
    const f = createFormatter();
    expect(f.rate(Dec.from(1.5))).toBe("+1.5/sec");
    const perMin = createFormatter({ velocityUnit: { name: "min", label: "minute", plural: "minutes", mult: 60 } });
    expect(perMin.rate(Dec.from(2))).toBe("+120/min");
  });
});

describe("formatNumber on Num strings", () => {
  it("reads the engine's strings", () => {
    expect(formatNumber("123456789")).toBe("123M");
    expect(formatNumber("1.23456789e38", { flavor: "full", sigfigs: 6 })).toBe("123.456 undecillion");
    expect(formatNumber("2.9999999999999e5")).toBe("299K");
    expect(formatNumber("-1.2345e-3", { maxSmall: 2, sigfigs: 3 })).toBe("-0.00124");
    expect(formatPercent("0.256", { floor: true })).toBe("25%");
  });
});
