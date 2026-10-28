// Number, percent and duration formatting. Everything the app shows goes
// through a Formatter, so the Options screen can switch notation, duration
// style and velocity unit by providing a different one:
//
//   <FormatContext.Provider value={createFormatter({ notation: "scientific-e" })}>
//
// Components call useFormat(). The number algorithm is a port of
// swarm-numberformat 0.2.0 (what the old game used) on the decimal.js
// backend, rounding down, with the same "bignum" (short) and "longnum"
// (full) flavors.
import { createContext, useContext } from "react";
import { Decimal, numberSuffixesLong, numberSuffixesShort } from "@swarmsim/engine";

export type Notation = "standard-decimal" | "scientific-e" | "hybrid" | "engineering";
export type DurationFormat = "abbreviated" | "full" | "human";
export type Flavor = "short" | "full";

export interface VelocityUnit {
  name: string; // "sec"
  label: string; // "second"
  plural: string; // "seconds"
  mult: number; // multiply a per-second rate by this
}

export const VELOCITY_SECOND: VelocityUnit = { name: "sec", label: "second", plural: "seconds", mult: 1 };

export interface FormatSettings {
  notation: Notation;
  durationFormat: DurationFormat;
  velocityUnit: VelocityUnit;
  /** picks the velocity unit per unit/producer (options.ts: warp falls back to seconds for energy) */
  resolveVelocityUnit?: (about?: { unit?: string; prod?: string }) => VelocityUnit;
}

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  notation: "standard-decimal",
  durationFormat: "abbreviated",
  velocityUnit: VELOCITY_SECOND,
};

// --- numbers ------------------------------------------------------------------

export interface NumberOptions {
  notation?: Notation;
  flavor?: Flavor;
  /** significant figures for suffixed numbers. Default: 3 (short), 5 (full) */
  sigfigs?: number;
  /** numbers below this are written out in full. Default 1e5 (also for the old `longnum`, whose `minsuffix: 1e6` was a typo the formatter ignored) */
  minSuffix?: number;
  /** numbers below this keep their decimals (e.g. energy). Default 0 */
  maxSmall?: number;
}

const DecFloor = Decimal.clone({ rounding: Decimal.ROUND_FLOOR });

// toLocaleString() with options builds a new Intl.NumberFormat per call; these run for every number, every tick
const numberFormats = new Map<number, Intl.NumberFormat>();
function grouped(n: number, places = 0): string {
  let f = numberFormats.get(places);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
    numberFormats.set(places, f);
  }
  return f.format(n);
}

function suffixFor(notation: Notation, flavor: Flavor, index: number): string | undefined {
  if (index < 0) return "";
  switch (notation) {
    case "engineering":
      return index === 0 ? "" : `E${index * 3}`;
    case "scientific-e":
      return undefined;
    case "hybrid":
    case "standard-decimal": {
      const list = flavor === "full" ? numberSuffixesLong : numberSuffixesShort;
      const limit = notation === "hybrid" ? 12 : list.length;
      return index < limit ? list[index] || "" : undefined;
    }
  }
}

export function formatNumber(value: Decimal.Value | null | undefined, opts: NumberOptions = {}): string {
  if (value == null) return "";
  const flavor = opts.flavor ?? "short";
  const notation = opts.notation ?? "standard-decimal";
  const sigfigs = opts.sigfigs ?? (flavor === "full" ? 5 : 3);
  const minSuffix = opts.minSuffix ?? 1e5;
  const maxSmall = opts.maxSmall ?? 0;
  let val: Decimal;
  try {
    val = new DecFloor(value as Decimal.Value);
  } catch {
    return "?";
  }
  if (val.isNaN()) return "?";
  if (!val.isFinite()) return val.isNegative() ? "-∞" : "∞";
  const abs = val.abs();
  if (abs.lessThan(maxSmall)) {
    return trimZeros(val.toPrecision(sigfigs, Decimal.ROUND_FLOOR));
  }
  if (abs.lessThan(minSuffix)) {
    return grouped(Math.floor(val.toNumber()));
  }
  const index = Math.floor(val.e / 3);
  const suffix = suffixFor(notation, flavor, index);
  if (suffix == null) {
    return trimZeros(val.toExponential(sigfigs - 1, Decimal.ROUND_FLOOR).replace("e+", "e"));
  }
  // 1000^index, built from its exponent: Decimal#pow is slow and this runs for every number on screen, every tick
  const prefix = val.dividedBy(new DecFloor(`1e${index * 3}`)).toPrecision(sigfigs, Decimal.ROUND_FLOOR);
  return trimZeros(prefix) + suffix;
}

/**
 * Drops trailing zeros after the decimal point: "8.00000" -> "8",
 * "1.50e300" -> "1.5e300". The old game kept them ("8.00000 million"); this
 * app drops them on purpose, as they add digits without adding information.
 */
export function trimZeros(s: string): string {
  return s.replace(/(\.\d*?)0+(?=\D|$)/, "$1").replace(/\.(?=\D|$)/, "");
}

export interface PercentOptions {
  places?: number;
  floor?: boolean;
  /** show (value - 1), e.g. a 1.25x multiplier as "25%" */
  plusOne?: boolean;
}

export function formatPercent(value: Decimal.Value | null | undefined, opts: PercentOptions = {}): string {
  if (value == null) return "";
  let d = new Decimal(value + "");
  if (d.isNaN()) return "?";
  if (opts.plusOne) d = d.minus(1);
  d = d.times(100);
  if (opts.floor) d = d.floor();
  const places = opts.places ?? 0;
  const n = d.toNumber();
  if (!isFinite(n)) return n > 0 ? "∞%" : "?";
  return grouped(n, places) + "%";
}

// --- durations ----------------------------------------------------------------

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const pad2 = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function clock(secs: number, withHours: boolean): string {
  const h = Math.floor(secs / HOUR);
  const m = Math.floor((secs % HOUR) / MIN);
  const s = Math.floor(secs % MIN);
  return withHours || h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

function humanize(secs: number): string {
  if (secs < 45) return "a few seconds";
  if (secs < 90) return "a minute";
  if (secs < 45 * MIN) return `${Math.round(secs / MIN)} minutes`;
  if (secs < 90 * MIN) return "an hour";
  if (secs < 22 * HOUR) return `${Math.round(secs / HOUR)} hours`;
  if (secs < 36 * HOUR) return "a day";
  if (secs < 26 * DAY) return `${Math.round(secs / DAY)} days`;
  if (secs < 45 * DAY) return "a month";
  if (secs < 320 * DAY) return `${Math.round(secs / MONTH)} months`;
  if (secs < 548 * DAY) return "a year";
  return `${formatNumber(Math.round(secs / YEAR), { flavor: "full" })} years`;
}

export interface DurationOptions {
  format?: DurationFormat;
  /** estimate is an upper bound: adds "or less" */
  nonexact?: boolean;
  /** number notation for very long durations ("123.456 thousand years"), like the old filter's longnum */
  notation?: Notation;
}

/**
 * Seconds as a duration, like the old `duration` filter: "" for zero,
 * Infinity and NaN (unknown or never).
 */
export function formatDuration(value: number | Decimal | null | undefined, opts: DurationOptions = {}): string {
  if (value == null) return "";
  const secs = typeof value === "number" ? value : value.toNumber();
  if (!secs || !isFinite(secs) || secs < 0) return "";
  const format = opts.format ?? "abbreviated";
  if (format === "human") return (opts.nonexact ? "or less " : "") + humanize(secs);
  const tail = opts.nonexact ? " or less" : "";
  if (format === "full") {
    if (secs < 60) return `0:${pad2(Math.floor(secs))}${tail}`;
    const y = Math.floor(secs / YEAR);
    const mo = Math.floor((secs % YEAR) / MONTH);
    const d = Math.floor(((secs % YEAR) % MONTH) / DAY);
    const parts: string[] = [];
    if (y) parts.push(`${y} yr`);
    if (y || mo) parts.push(`${mo} mth`);
    if (y || mo || d) parts.push(`${d} day`);
    parts.push(clock(secs % DAY, parts.length > 0));
    return parts.join(" ") + tail;
  }
  // abbreviated
  let text: string;
  if (secs >= 100 * YEAR) text = `${formatNumber(secs / YEAR, { flavor: "full", sigfigs: 6, notation: opts.notation })} years`;
  else if (secs >= YEAR) text = `${plural(Math.floor(secs / YEAR), "year", "years")} ${plural(Math.floor((secs % YEAR) / MONTH), "month", "months")}`;
  else if (secs >= MONTH) text = `${plural(Math.floor(secs / MONTH), "month", "months")} ${plural(Math.floor((secs % MONTH) / DAY), "day", "days")}`;
  else if (secs >= DAY) text = `${plural(Math.floor(secs / DAY), "day", "days")} ${plural(Math.floor((secs % DAY) / HOUR), "hour", "hours")}`;
  else if (secs >= MIN) text = clock(secs, false);
  else text = `00:${pad2(Math.floor(secs))}`;
  return text + tail;
}

// --- the formatter components use -----------------------------------------------

export interface Formatter {
  settings: FormatSettings;
  /** short number, like the old `bignum` filter: "1.23M" */
  num(value: Decimal.Value | null | undefined, maxSmall?: number): string;
  /** long number, like the old `longnum` filter: "123.456 thousand", "8.00000 million" */
  long(value: Decimal.Value | null | undefined, maxSmall?: number): string;
  percent(value: Decimal.Value | null | undefined, opts?: PercentOptions): string;
  duration(secs: number | Decimal | null | undefined, opts?: Omit<DurationOptions, "format">): string;
  /** the unit of time rates are shown in. `about` is the unit or producer (some units can't use every velocity unit) */
  velocityUnit(about?: { unit?: string; prod?: string }): VelocityUnit;
  /** a per-second rate in the velocity unit, short: "+1.5/sec" */
  rate(perSecond: Decimal, about?: { unit?: string; prod?: string }): string;
}

export function createFormatter(overrides: Partial<FormatSettings> = {}): Formatter {
  const settings: FormatSettings = { ...DEFAULT_FORMAT_SETTINGS, ...overrides };
  const { notation } = settings;
  const f: Formatter = {
    settings,
    num: (v, maxSmall = 0) => formatNumber(v, { notation, flavor: "short", maxSmall }),
    long: (v, maxSmall = 0) => formatNumber(v, { notation, flavor: "full", sigfigs: 6, maxSmall }),
    percent: (v, opts) => formatPercent(v, opts),
    duration: (secs, opts) => formatDuration(secs, { ...opts, format: settings.durationFormat, notation }),
    velocityUnit: (about) => settings.resolveVelocityUnit?.(about) ?? settings.velocityUnit,
    rate: (perSecond, about) => {
      const vu = f.velocityUnit(about);
      return `+${f.num(perSecond.times(vu.mult), 2)}/${vu.name}`;
    },
  };
  return f;
}

export const defaultFormatter = createFormatter();

/** Provide a Formatter built from the player's options (phase B: Options screen). */
export const FormatContext = createContext<Formatter>(defaultFormatter);

export function useFormat(): Formatter {
  return useContext(FormatContext);
}
