// Buy-button latency. Each run taps (phone) or clicks (laptop) one button
// several times, with a pause between taps, under the CPU throttle.
// - handler: from the click reaching window (capture) to it leaving window
//   (bubble), which takes in React's event handler and, for a trusted event,
//   the synchronous re-render that useSyncExternalStore schedules as a
//   microtask between listeners.
// - paint: from pointerdown's timestamp to a message posted from the next
//   animation frame, i.e. just after the frame that shows the purchase was
//   rendered (the usual "after next paint" approximation of Event Timing's
//   duration, without its 8 ms rounding and 16 ms floor).
import { median, max, openPage, sleep } from "../lib";
import { matrix } from "../types";
import type { Selection, Suite } from "../types";

declare global {
  interface Window {
    __benchTaps?: { handler: number; paint: number }[];
  }
}

function instrumentTaps() {
  const taps: { handler: number; paint: number }[] = (window.__benchTaps = []);
  let cur: { down: number; c0?: number } | null = null;
  addEventListener("pointerdown", (e) => (cur = { down: e.timeStamp }), true);
  addEventListener("click", () => cur && (cur.c0 = performance.now()), true);
  addEventListener("click", () => {
    const t = cur;
    cur = null;
    if (!t || t.c0 == null) return;
    const handler = performance.now() - t.c0;
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => taps.push({ handler, paint: performance.now() - t.down });
      ch.port2.postMessage(0);
    });
  });
}

interface Target {
  target: string;
  route: string;
  selector: string;
}

const TARGETS: Target[] = [
  { target: "meat quick buy", route: "#/tab/meat", selector: '[data-actions="drone"] button:not([disabled])' },
  { target: "drone buy", route: "#/unit/drone", selector: "main .btn-stack:not(.upgrade .btn-stack):not([disabled])" },
  { target: "drone upgrade", route: "#/unit/drone", selector: "main .upgrade:not(.ability) .btn-stack:not([disabled])" },
];

const TAPS = 8;
const GAP_SECONDS = 0.7;

export const tap: Suite<ReturnType<typeof cases>[number]> = {
  name: "tap",
  describe: (env) => `buy-button latency over ${TAPS} taps per run, ${env.throttle}x CPU throttle`,
  metrics: [
    { key: "paint", label: "tap→paint", unit: "ms", better: "lower", noise: 5 },
    { key: "paintMax", label: "worst", unit: "ms", better: "lower", noise: 15 },
    { key: "handler", label: "handler", unit: "ms", better: "lower", noise: 3 },
    { key: "handlerMax", label: "worst", unit: "ms", better: "lower", noise: 10 },
  ],
  cases: (sel) => cases(sel),
  async run(env, c) {
    const { page, close } = await openPage(env, { save: c.save, viewport: c.viewport, route: c.route, throttle: env.throttle, init: { fn: instrumentTaps } });
    try {
      await page.evaluate(() => (window.__benchTaps!.length = 0));
      const touch = c.viewport === "phone";
      for (let i = 0; i < TAPS; i++) {
        const button = page.locator(c.selector).first();
        // nothing affordable (e.g. the early save's upgrades): not measurable here
        if (!(await button.count())) break;
        if (touch) await button.tap();
        else await button.click();
        await sleep(page, GAP_SECONDS);
      }
      const taps = await page.evaluate(() => window.__benchTaps!);
      const paint = taps.map((t) => t.paint);
      const handler = taps.map((t) => t.handler);
      return {
        values: { paint: median(paint), paintMax: max(paint), handler: median(handler), handlerMax: max(handler) },
        detail: { taps: taps.length },
      };
    } finally {
      await close();
    }
  },
  note(samples) {
    const n = samples.map((s) => Number(s.detail?.taps ?? 0));
    return n.some((x) => x < TAPS) ? `taps that landed per run: ${n.join(", ")} of ${TAPS} (nothing affordable?)` : undefined;
  },
};

function cases(sel: Selection) {
  return matrix<Target>(sel, TARGETS, (t) => t.target);
}
