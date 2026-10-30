// Shared helpers for the benchmark suites: browser contexts seeded with a
// save, CPU throttling, tracing, and small statistics.
import { existsSync } from "fs";
import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, BrowserContextOptions, CDPSession, Page } from "@playwright/test";
import type { BenchSave, SaveName } from "./saves";

export const SAVE_KEY = "swarmhive-v1";
/** every tutorial step, dismissed (src/components/progression/TutorialHint.tsx) */
const TUTORIAL_KEY = "swarmhive-tutorial-dismissed";
const NO_TUTORIAL = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100]);

export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} satisfies Record<string, BrowserContextOptions>;
export type ViewportName = keyof typeof VIEWPORTS;
export const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[];

export interface Settings {
  baseURL: string;
  /** CPU slowdown for the suites that measure time (Emulation.setCPUThrottlingRate) */
  throttle: number;
  /** seconds per measurement window */
  duration: number;
}

export interface Env extends Settings {
  browser: Browser;
  saves: Record<SaveName, BenchSave>;
}

/** Launches Playwright's Chromium (the preinstalled one at /opt/pw-browsers when the default is missing, like playwright.config.ts). */
export async function launchBrowser(): Promise<Browser> {
  const fallback = "/opt/pw-browsers/chromium";
  const executablePath = !existsSync(chromium.executablePath()) && existsSync(fallback) ? fallback : undefined;
  return chromium.launch(executablePath ? { executablePath } : {});
}

export interface OpenOptions {
  save: SaveName;
  viewport: ViewportName;
  route: string;
  /** CPU throttle once the page has settled (default: no throttling) */
  throttle?: number;
  /** extra script run before the app's own, in every document of the context */
  init?: string | { fn: (arg: never) => unknown; arg?: unknown };
  /** ms to wait after the app has drawn, before the throttle */
  settle?: number;
  /** wait for this before settling (default: the header) */
  ready?: string;
}

export interface Opened {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  close(): Promise<void>;
}

/**
 * A fresh context with the save seeded once (later reloads keep the game's
 * own state), the tutorial dismissed, Google Fonts blocked and service
 * workers off; navigated to `route` and settled.
 */
export async function openPage(env: Env, opts: OpenOptions): Promise<Opened> {
  const context = await seededContext(env, opts);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(env.baseURL + opts.route);
  await page.locator(opts.ready ?? ".app-header").first().waitFor();
  await dismissWelcomeBack(page);
  await page.waitForTimeout(opts.settle ?? 1500);
  if (opts.throttle && opts.throttle !== 1) await throttle(cdp, opts.throttle);
  return { context, page, cdp, close: () => context.close() };
}

/** The context alone (see openPage), for suites that drive the first load themselves. */
export async function seededContext(env: Env, opts: Pick<OpenOptions, "save" | "viewport" | "init">): Promise<BrowserContext> {
  const context = await env.browser.newContext({ ...VIEWPORTS[opts.viewport], serviceWorkers: "block" });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // tsx compiles with keepNames, which wraps named functions in __name(); page functions need it too
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(
    ([key, save, tutKey, tut]) => {
      if (sessionStorage.getItem("bench-seeded")) return;
      sessionStorage.setItem("bench-seeded", "1");
      localStorage.setItem(key, save);
      localStorage.setItem(tutKey, tut);
    },
    [SAVE_KEY, env.saves[opts.save].encode(), TUTORIAL_KEY, NO_TUTORIAL] as const,
  );
  if (typeof opts.init === "string") await context.addInitScript(opts.init);
  else if (opts.init) await context.addInitScript(opts.init.fn as (arg: unknown) => unknown, opts.init.arg);
  return context;
}

/** The saves are dated a few seconds ago, so welcome back shouldn't show; close it if it does. */
export async function dismissWelcomeBack(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "Dismiss welcome back" });
  if (await close.isVisible()) await close.click();
}

export async function throttle(cdp: CDPSession, rate: number): Promise<void> {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

export async function collectGarbage(cdp: CDPSession): Promise<void> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
}

/** Performance.getMetrics as a name -> value map (JSHeapUsedSize, Nodes, JSEventListeners, ScriptDuration, ...). */
export async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  await cdp.send("Performance.enable");
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

export interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: { name?: string; data?: Record<string, unknown> & { message?: string } };
}

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "toplevel",
  "v8",
  "v8.execute",
  "disabled-by-default-v8.gc",
  "blink.user_timing",
  "loading",
].join(",");

/** Records a Chrome trace while `during` runs. */
export async function trace(cdp: CDPSession, during: () => Promise<unknown>): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  const onData = (d: { value: object[] }) => events.push(...(d.value as TraceEvent[]));
  cdp.on("Tracing.dataCollected", onData);
  const done = new Promise((ok) => cdp.once("Tracing.tracingComplete", ok));
  await cdp.send("Tracing.start", { categories: TRACE_CATEGORIES, transferMode: "ReportEvents" });
  try {
    await during();
  } finally {
    await cdp.send("Tracing.end");
    await done;
    cdp.off("Tracing.dataCollected", onData);
  }
  return events;
}

/** The page's main-thread events (the CrRendererMain thread that ran timers). */
export function mainThread(events: TraceEvent[]): TraceEvent[] {
  const busy = new Set(events.filter((e) => e.name === "TimerFire" || e.name === "FireAnimationFrame").map((e) => e.pid));
  const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain" && busy.has(e.pid));
  if (!main) throw new Error("no renderer main thread in the trace");
  return events.filter((e) => e.pid === main.pid && e.tid === main.tid);
}

/** Top-level tasks (RunTask), sorted by start. */
export function tasksOf(events: TraceEvent[]): TraceEvent[] {
  return events.filter((e) => e.ph === "X" && e.name === "RunTask" && e.dur != null).sort((a, b) => a.ts - b.ts);
}

export const LONG_TASK_MS = 50;

export const sleep = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);

// --- statistics ---

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** nearest-rank percentile, p in 0..1 */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function max(xs: number[]): number {
  return xs.length ? Math.max(...xs) : NaN;
}

