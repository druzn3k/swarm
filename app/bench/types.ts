// What a suite is, and what it produces.
import type { Env, ViewportName } from "./lib";
import type { SaveName } from "./saves";

export interface MetricDef {
  key: string;
  /** column header */
  label: string;
  /** e.g. "ms", "%", "/s", "MB" */
  unit?: string;
  digits?: number;
  /** which way is an improvement; "none" for counts that are only context */
  better: "lower" | "higher" | "none";
  /** smallest change worth flagging in a comparison, in the metric's unit (on top of 10% of the baseline) */
  noise?: number;
}

export interface Case {
  /** the row's name within the suite (a screen, a button, ...) */
  id: string;
  save: SaveName;
  viewport: ViewportName;
}

/** One measurement of a case. NaN means "not measurable here" (e.g. no button to tap). */
export interface Sample {
  values: Record<string, number>;
  /** extra, non-compared information (e.g. the top components) */
  detail?: Record<string, unknown>;
}

export interface Selection {
  saves: SaveName[];
  viewports: ViewportName[];
}

export interface Suite<C extends Case = Case> {
  name: string;
  /** one line for the table header: what it measures and under which conditions */
  describe(env: Env): string;
  metrics: MetricDef[];
  cases(sel: Selection): C[];
  run(env: Env, c: C): Promise<Sample>;
  /** a line or two under the table for a row (from all its samples), e.g. top components */
  note?(samples: Sample[]): string | undefined;
}

/** each item on each selected save and viewport */
export function matrix<T extends object>(sel: Selection, items: T[], id: (item: T) => string): (Case & T)[] {
  const out: (Case & T)[] = [];
  for (const save of sel.saves) for (const viewport of sel.viewports) for (const item of items) out.push({ ...item, id: id(item), save, viewport });
  return out;
}
