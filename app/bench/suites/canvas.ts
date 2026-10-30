// The hive canvas: animation frames that drew something, per second, while
// the canvas is visible, scrolled off screen, and with the page hidden; plus
// timer wake-ups per second (setTimeout and setInterval callbacks), a proxy
// for battery use. A frame "drew" if a 2D-context drawing call ran during its
// requestAnimationFrame callback. Expected: about 20 draws/s visible, none off
// screen or hidden.
// - off screen: the canvas's scroll container (the page on a phone, the left
//   column on a laptop) gets bottom padding and is scrolled so the canvas is
//   above the viewport; NaN if it can't be scrolled out of view.
// - hidden: headless Chromium never hides a page, so document.visibilityState
//   is overridden to "hidden" and a visibilitychange event dispatched.
// Under the CPU throttle like the tick suite.
import { openPage, sleep } from "../lib";
import { matrix } from "../types";
import type { Selection, Suite } from "../types";

interface Counters {
  raf: number;
  drew: number;
  wake: number;
}

declare global {
  interface Window {
    __benchCanvas?: Counters;
  }
}

function instrumentCanvas() {
  const st: Counters = (window.__benchCanvas = { raf: 0, drew: 0, wake: 0 });
  let drawing = false;
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ["fillRect", "drawImage", "putImageData", "clearRect", "fill", "stroke", "fillText"]) {
    const orig = proto[m];
    proto[m] = function (this: unknown, ...a: unknown[]) {
      drawing = true;
      return orig.apply(this, a);
    };
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (fn) =>
    raf.call(window, (t) => {
      st.raf++;
      drawing = false;
      fn(t);
      if (drawing) st.drew++;
    });
  const wrap = <F extends (fn: TimerHandler, ms?: number, ...rest: unknown[]) => number>(orig: F): F =>
    function (this: unknown, fn: TimerHandler, ms?: number, ...rest: unknown[]) {
      const cb =
        typeof fn === "function"
          ? function (this: unknown, ...args: unknown[]) {
              st.wake++;
              return (fn as (...x: unknown[]) => unknown).apply(this, args);
            }
          : fn;
      return orig.call(window, cb, ms, ...rest);
    } as F;
  window.setTimeout = wrap(window.setTimeout) as typeof window.setTimeout;
  window.setInterval = wrap(window.setInterval) as typeof window.setInterval;
}

interface Hive {
  hive: string;
  route: string;
}

export const canvas: Suite<ReturnType<typeof cases>[number]> = {
  name: "canvas",
  describe: (env) => `hive canvas frames that drew, per second, and timer wake-ups/s; ${env.throttle}x CPU throttle, ${env.duration} s per state`,
  metrics: [
    { key: "visible", label: "draws/s visible", digits: 1, better: "none", noise: 1 },
    { key: "offscreen", label: "off screen", digits: 1, better: "lower", noise: 1 },
    { key: "hidden", label: "hidden", digits: 1, better: "lower", noise: 1 },
    { key: "wakeVisible", label: "wake-ups/s visible", digits: 1, better: "lower", noise: 1 },
    { key: "wakeHidden", label: "hidden", digits: 1, better: "lower", noise: 1 },
  ],
  cases: (sel) => cases(sel),
  async run(env, c) {
    const { page, close } = await openPage(env, { save: c.save, viewport: c.viewport, route: c.route, throttle: env.throttle, init: { fn: instrumentCanvas } });
    const window_ = async () => {
      await page.evaluate(() => Object.assign(window.__benchCanvas!, { raf: 0, drew: 0, wake: 0 }));
      await sleep(page, env.duration);
      const s = await page.evaluate(() => window.__benchCanvas!);
      return { draws: s.drew / env.duration, wake: s.wake / env.duration };
    };
    try {
      const visible = await window_();
      const scrolled = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c) return false;
        let el = c.parentElement;
        while (el && el !== document.body && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
        const box = !el || el === document.body ? document.scrollingElement! : el;
        const pad = box === document.scrollingElement ? document.body : (box as HTMLElement);
        pad.style.paddingBottom = `${2 * innerHeight}px`;
        box.scrollTop += c.getBoundingClientRect().bottom + 10;
        return c.getBoundingClientRect().bottom < 0;
      });
      await sleep(page, 0.5);
      const offscreen = scrolled ? await window_() : { draws: NaN, wake: NaN };
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await sleep(page, 0.5);
      const hidden = await window_();
      return {
        values: { visible: visible.draws, offscreen: offscreen.draws, hidden: hidden.draws, wakeVisible: visible.wake, wakeHidden: hidden.wake },
        detail: { wakeOffscreen: offscreen.wake },
      };
    } finally {
      await close();
    }
  },
};

function cases(sel: Selection) {
  return matrix<Hive>(sel, [{ hive: "meat tab", route: "#/tab/meat" }], (h) => h.hive);
}
