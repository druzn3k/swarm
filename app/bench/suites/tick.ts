// Per-tick cost: the game's 100 ms tick task, which includes React's render
// of the tick's changes (useSyncExternalStore updates render synchronously in
// the same task). The page's setInterval(…, 100) callbacks are marked with
// console.timeStamp("tick") and a Chrome trace splits the main thread's tasks
// into tick tasks, animation frames, rendering and the rest.
import { LONG_TASK_MS, collectGarbage, mainThread, max, mean, metrics, openPage, percentile, sleep, tasksOf, trace } from "../lib";
import type { TraceEvent } from "../lib";
import { matrix } from "../types";
import type { Selection, Suite } from "../types";
import { SCREENS } from "./screens";
import type { Screen } from "./screens";

const MARK_TICKS = `{
  const si = window.setInterval;
  window.setInterval = function (fn, ms, ...rest) {
    if (ms === 100 && typeof fn === "function") {
      const f = fn;
      fn = function () { console.timeStamp("tick"); return f.apply(this, arguments); };
    }
    return si.call(this, fn, ms, ...rest);
  };
}`;

type Kind = "tick" | "raf" | "render" | "other";
const RENDERING = new Set(["UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Commit"]);

/** Sorts each top-level task by what ran inside it. */
export function classify(events: TraceEvent[]): Record<Kind, number[]> {
  const tasks = tasksOf(events);
  const inner = events.filter((e) => e.ph === "X" || e.ph === "I" || e.ph === "i").sort((a, b) => a.ts - b.ts);
  const out: Record<Kind, number[]> = { tick: [], raf: [], render: [], other: [] };
  let j = 0;
  for (const t of tasks) {
    const end = t.ts + (t.dur ?? 0);
    while (j < inner.length && inner[j].ts < t.ts) j++;
    let kind: Kind = "other";
    for (let k = j; k < inner.length && inner[k].ts <= end; k++) {
      const n = inner[k].name;
      if (n === "TimeStamp" && inner[k].args?.data?.message === "tick") kind = "tick";
      else if (n === "FireAnimationFrame" && kind !== "tick") kind = "raf";
      else if (RENDERING.has(n) && kind === "other") kind = "render";
    }
    out[kind].push((t.dur ?? 0) / 1000);
  }
  return out;
}

export const tick: Suite<ReturnType<typeof cases>[number]> = {
  name: "tick",
  describe: (env) => `main-thread cost of the 100 ms game tick (incl. React render), ${env.throttle}x CPU throttle, ${env.duration} s per run`,
  metrics: [
    { key: "mean", label: "tick mean", unit: "ms", better: "lower", noise: 0.5 },
    { key: "p95", label: "p95", unit: "ms", better: "lower", noise: 1 },
    { key: "max", label: "max", unit: "ms", better: "lower", noise: 3 },
    { key: "ticks", label: "ticks/s", digits: 1, better: "higher", noise: 0.5 },
    { key: "long", label: "long tasks", digits: 1, better: "lower", noise: 1 },
    { key: "busy", label: "busy", unit: "%", digits: 1, better: "lower", noise: 1 },
  ],
  cases: (sel) => cases(sel),
  async run(env, c) {
    const { page, cdp, close } = await openPage(env, { save: c.save, viewport: c.viewport, route: c.route, throttle: env.throttle, init: MARK_TICKS });
    try {
      await collectGarbage(cdp);
      await sleep(page, 0.5);
      const t0 = Date.now();
      const events = mainThread(await trace(cdp, () => sleep(page, env.duration)));
      const wall = Date.now() - t0;
      const kinds = classify(events);
      const all = tasksOf(events).map((t) => (t.dur ?? 0) / 1000);
      const m = await metrics(cdp);
      return {
        values: {
          mean: mean(kinds.tick),
          p95: percentile(kinds.tick, 0.95),
          max: max(kinds.tick),
          ticks: kinds.tick.length / (wall / 1000),
          long: all.filter((d) => d > LONG_TASK_MS).length,
          busy: (100 * all.reduce((a, b) => a + b, 0)) / wall,
        },
        detail: {
          rafMean: mean(kinds.raf),
          renderMean: mean(kinds.render),
          heapMB: m.JSHeapUsedSize / 1e6,
          nodes: m.Nodes,
        },
      };
    } finally {
      await close();
    }
  },
};

function cases(sel: Selection) {
  return matrix<Screen>(sel, SCREENS, (s) => s.screen);
}
