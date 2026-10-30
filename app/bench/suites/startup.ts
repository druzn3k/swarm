// Startup: a cold load (fresh context, no service worker, nothing cached)
// with the CPU throttled from the start, traced until a second after the
// first render.
// - fcp: first-contentful-paint from the Paint Timing API.
// - first render: when the app's first unit card or page heading appeared
//   (a MutationObserver installed before the app runs), from navigation start.
// - eval: top-level module evaluation (v8.evaluateModule in the trace).
// - js: all JavaScript (union of script evaluation and function calls) from
//   navigation to the first render.
// - long tasks: tasks over 50 ms from navigation to a second after the first render.
import { LONG_TASK_MS, mainThread, seededContext, sleep, tasksOf, throttle, trace } from "../lib";
import type { TraceEvent } from "../lib";
import { matrix } from "../types";
import type { Selection, Suite } from "../types";

declare global {
  interface Window {
    __benchFirstRender?: number;
  }
}

function watchFirstRender() {
  const mo = new MutationObserver(() => {
    if (window.__benchFirstRender == null && document.querySelector(".unit-list li, main h1")) {
      window.__benchFirstRender = performance.now();
      mo.disconnect();
    }
  });
  document.addEventListener("DOMContentLoaded", () => mo.observe(document.body, { childList: true, subtree: true }));
}

const JS = new Set(["v8.evaluateModule", "EvaluateScript", "v8.compileModule", "v8.compile", "FunctionCall", "v8.callFunction", "v8.run"]);

/** total time covered by the events' [ts, ts + dur) intervals, overlapping ones counted once */
function union(events: TraceEvent[], from: number, to: number): number {
  const spans = events.map((e) => [Math.max(from, e.ts), Math.min(to, e.ts + (e.dur ?? 0))] as const).filter(([a, b]) => b > a);
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total / 1000;
}

interface Start {
  start: string;
  route: string;
}

export const startup: Suite<ReturnType<typeof cases>[number]> = {
  name: "startup",
  describe: (env) => `cold load of the meat tab, ${env.throttle}x CPU throttle from the start, no network throttling`,
  metrics: [
    { key: "fcp", label: "FCP", unit: "ms", digits: 0, better: "lower", noise: 30 },
    { key: "firstRender", label: "first render", unit: "ms", digits: 0, better: "lower", noise: 30 },
    { key: "eval", label: "module eval", unit: "ms", digits: 0, better: "lower", noise: 30 },
    { key: "js", label: "JS to render", unit: "ms", digits: 0, better: "lower", noise: 30 },
    { key: "long", label: "long tasks", digits: 1, better: "lower", noise: 1 },
    { key: "longMs", label: "long total", unit: "ms", digits: 0, better: "lower", noise: 50 },
  ],
  cases: (sel) => cases(sel),
  async run(env, c) {
    const context = await seededContext(env, { save: c.save, viewport: c.viewport, init: { fn: watchFirstRender } });
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await throttle(cdp, env.throttle);
      let fcp = NaN;
      let firstRender = NaN;
      const events = await trace(cdp, async () => {
        await page.goto(env.baseURL + c.route, { waitUntil: "load" });
        await page.waitForFunction(() => window.__benchFirstRender != null, undefined, { timeout: 30_000 });
        await sleep(page, 1);
        ({ fcp, firstRender } = await page.evaluate(() => ({
          fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN,
          firstRender: window.__benchFirstRender!,
        })));
      });
      const nav = events.find((e) => e.name === "navigationStart" && String(e.args?.data?.documentLoaderURL ?? "").startsWith(env.baseURL));
      if (!nav) throw new Error("no navigationStart in the startup trace");
      const main = mainThread(events);
      const rendered = nav.ts + firstRender * 1000;
      const long = tasksOf(main).filter((t) => t.ts >= nav.ts && t.ts <= rendered + 1e6 && (t.dur ?? 0) / 1000 > LONG_TASK_MS);
      return {
        values: {
          fcp,
          firstRender,
          eval: union(main.filter((e) => e.name === "v8.evaluateModule"), nav.ts, Infinity),
          js: union(main.filter((e) => e.ph === "X" && JS.has(e.name)), nav.ts, rendered),
          long: long.length,
          longMs: long.reduce((a, t) => a + (t.dur ?? 0) / 1000, 0),
        },
      };
    } finally {
      await context.close();
    }
  },
};

function cases(sel: Selection) {
  return matrix<Start>(sel, [{ start: "meat tab", route: "#/tab/meat" }], (s) => s.start);
}
