// Results: the JSON format, the summary table, and before/after comparison.
import { median } from "./lib";
import type { MetricDef, Sample } from "./types";

export interface Summary {
  median: number;
  min: number;
  max: number;
  samples: number[];
}

export interface Row {
  id: string;
  save: string;
  viewport: string;
  values: Record<string, Summary>;
  note?: string;
  errors?: string[];
}

export interface SuiteResult {
  description: string;
  metrics: MetricDef[];
  rows: Row[];
}

export interface Results {
  format: 1;
  date: string;
  commit?: string;
  machine: { cpu: string; cpus: number; platform: string; node: string; chromium: string };
  settings: { throttle: number; duration: number; repeat: number; dist: string };
  suites: Record<string, SuiteResult>;
}

export function summarize(samples: Sample[], metrics: MetricDef[]): Record<string, Summary> {
  const out: Record<string, Summary> = {};
  for (const m of metrics) {
    const xs = samples.map((s) => s.values[m.key]).filter((x) => Number.isFinite(x));
    out[m.key] = xs.length ? { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), samples: xs } : { median: NaN, min: NaN, max: NaN, samples: [] };
  }
  return out;
}

const fmt = (x: number, digits: number) => (Number.isFinite(x) ? x.toFixed(digits) : "–");
const digitsOf = (m: MetricDef) => m.digits ?? 2;
const keyOf = (r: Row) => `${r.save}|${r.viewport}|${r.id}`;

/**
 * When a change between two runs counts as more than noise: the medians differ
 * by more than 10% of the baseline and by more than the metric's noise floor,
 * and (with two or more samples on each side) the min–max ranges don't overlap.
 */
export function significant(a: Summary, b: Summary, m: MetricDef): boolean {
  if (!Number.isFinite(a.median) || !Number.isFinite(b.median)) return false;
  const delta = Math.abs(b.median - a.median);
  if (delta <= Math.max(m.noise ?? 0, 0.1 * Math.abs(a.median))) return false;
  if (a.samples.length < 2 || b.samples.length < 2) return true;
  return a.max < b.min || b.max < a.min;
}

function table(headers: string[], rows: string[][], rightFrom: number): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i >= rightFrom ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

const header = (m: MetricDef) => (m.unit ? `${m.label} ${m.unit}` : m.label);

/** The readable summary: one table per suite, median ± half the min–max range. */
export function formatResults(res: Results): string {
  const out: string[] = [];
  for (const [name, suite] of Object.entries(res.suites)) {
    out.push(`\n## ${name}: ${suite.description}`);
    out.push(`   median of ${res.settings.repeat} run(s), ± half the range\n`);
    const rows = suite.rows.map((r) => [
      r.save,
      r.viewport,
      r.id,
      ...suite.metrics.map((m) => {
        const s = r.values[m.key];
        const d = digitsOf(m);
        const spread = (s.max - s.min) / 2;
        return fmt(s.median, d) + (s.samples.length > 1 && Number.isFinite(spread) ? ` ±${fmt(spread, d)}` : "");
      }),
    ]);
    out.push(table(["save", "viewport", "case", ...suite.metrics.map(header)], rows, 3));
    const notes = suite.rows.flatMap((r) => [
      ...(r.note ? [`  ${r.save} ${r.viewport} ${r.id}: ${r.note}`] : []),
      ...(r.errors ?? []).map((e) => `  ${r.save} ${r.viewport} ${r.id}: ERROR ${e}`),
    ]);
    if (notes.length) out.push("", ...notes);
  }
  return out.join("\n");
}

/** The tables again, with each value's change from `base`; `*` marks changes beyond the runs' noise. */
export function formatComparison(base: Results, res: Results): string {
  const out: string[] = [];
  const settings = (r: Results) => `throttle ${r.settings.throttle}x, ${r.settings.duration} s, ${r.settings.repeat} run(s)`;
  out.push(`\n# compared with ${base.date}${base.commit ? ` (${base.commit})` : ""}: ${settings(base)}`);
  if (settings(base) !== settings(res)) out.push(`  note: this run used ${settings(res)}; numbers may not be comparable`);
  const flagged: { better: string[]; worse: string[] } = { better: [], worse: [] };
  for (const [name, suite] of Object.entries(res.suites)) {
    const old = base.suites[name];
    out.push(`\n## ${name}: change from the baseline (new value, Δ; * = beyond noise)\n`);
    if (!old) {
      out.push("  (not in the baseline)");
      continue;
    }
    const oldRows = new Map(old.rows.map((r) => [keyOf(r), r]));
    const rows = suite.rows.map((r) => {
      const o = oldRows.get(keyOf(r));
      return [
        r.save,
        r.viewport,
        r.id,
        ...suite.metrics.map((m) => {
          const s = r.values[m.key];
          const d = digitsOf(m);
          const before = o?.values[m.key];
          if (!before || !Number.isFinite(before.median)) return `${fmt(s.median, d)} (new)`;
          const delta = s.median - before.median;
          const pct = before.median !== 0 ? ` ${delta >= 0 ? "+" : ""}${Math.round((100 * delta) / Math.abs(before.median))}%` : "";
          const sig = significant(before, s, m);
          if (sig && m.better !== "none") {
            const improved = m.better === "lower" ? delta < 0 : delta > 0;
            flagged[improved ? "better" : "worse"].push(
              `  ${name} ${r.save} ${r.viewport} ${r.id} ${header(m)}: ${fmt(before.median, d)} → ${fmt(s.median, d)}${pct}`,
            );
          }
          return `${fmt(s.median, d)} ${delta >= 0 ? "+" : ""}${fmt(delta, d)}${sig ? "*" : ""}`;
        }),
      ];
    });
    out.push(table(["save", "viewport", "case", ...suite.metrics.map(header)], rows, 3));
  }
  out.push(`\n${flagged.worse.length} worse, ${flagged.better.length} better beyond noise`);
  if (flagged.worse.length) out.push("worse:", ...flagged.worse);
  if (flagged.better.length) out.push("better:", ...flagged.better);
  return out.join("\n");
}
