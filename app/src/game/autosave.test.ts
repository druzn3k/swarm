import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosave, SAVE_IDLE_TIMEOUT_MILLIS, SAVE_MILLIS } from "./autosave";
import type { AutosaveHost } from "./autosave";
import { GameStore, SAVE_ID } from "./store";
import { FakeWindow, countingStorage } from "./fakewindow";

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2024, 0, 1) });
});
afterEach(() => {
  vi.useRealTimers();
});

/** a host with requestIdleCallback, whose idle callbacks run when the test says so */
function idleHost() {
  const idle = new Map<number, () => void>();
  let next = 1;
  const opts: ({ timeout: number } | undefined)[] = [];
  const host: AutosaveHost = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => globalThis.clearTimeout(id),
    requestIdleCallback: (fn, o) => {
      opts.push(o);
      idle.set(next, fn);
      return next++;
    },
    cancelIdleCallback: (id) => void idle.delete(id),
  };
  const runIdle = () => {
    const fns = [...idle.values()];
    idle.clear();
    fns.forEach((fn) => fn());
  };
  return { host, idle, opts, runIdle };
}

describe("Autosave", () => {
  it("saves every 30 seconds, in idle time", () => {
    const { host, idle, opts, runIdle } = idleHost();
    const save = vi.fn();
    new Autosave(save, host).start();
    vi.advanceTimersByTime(SAVE_MILLIS - 1);
    expect(idle.size).toBe(0);
    vi.advanceTimersByTime(1);
    expect(idle.size).toBe(1);
    expect(opts[0]).toEqual({ timeout: SAVE_IDLE_TIMEOUT_MILLIS });
    expect(save).not.toHaveBeenCalled();
    runIdle();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SAVE_MILLIS);
    runIdle();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("waits 30 seconds after any other save (e.g. the engine's, after a purchase)", () => {
    const { host, idle, runIdle } = idleHost();
    const save = vi.fn();
    const a = new Autosave(save, host);
    a.start();
    vi.advanceTimersByTime(20000);
    a.saved();
    vi.advanceTimersByTime(SAVE_MILLIS - 1);
    expect(idle.size).toBe(0);
    vi.advanceTimersByTime(1);
    runIdle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("drops a pending idle save when another save happens first", () => {
    const { host, idle, runIdle } = idleHost();
    const save = vi.fn();
    const a = new Autosave(save, host);
    a.start();
    vi.advanceTimersByTime(SAVE_MILLIS);
    expect(idle.size).toBe(1);
    a.saved();
    expect(idle.size).toBe(0);
    runIdle();
    expect(save).not.toHaveBeenCalled();
  });

  it("falls back to setTimeout without requestIdleCallback", () => {
    const save = vi.fn();
    const host: AutosaveHost = {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => globalThis.clearTimeout(id),
    };
    new Autosave(save, host).start();
    vi.advanceTimersByTime(SAVE_MILLIS);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush saves at once; pause stops timed saves until start", () => {
    const { host, runIdle } = idleHost();
    const save = vi.fn();
    const a = new Autosave(save, host);
    a.start();
    a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    a.pause();
    vi.advanceTimersByTime(SAVE_MILLIS * 3);
    runIdle();
    expect(save).toHaveBeenCalledTimes(1);
    a.start();
    vi.advanceTimersByTime(SAVE_MILLIS);
    runIdle();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe("GameStore.start saves", () => {
  function setup() {
    const storage = countingStorage();
    const store = new GameStore({ storage });
    const win = new FakeWindow();
    const stop = store.start(win.asWindow());
    const saves = () => storage.writes.get(SAVE_ID) ?? 0;
    return { store, win, stop, saves, storage };
  }

  it("autosaves every 30 seconds, not every 5", () => {
    const { saves, stop } = setup();
    vi.advanceTimersByTime(29000);
    expect(saves()).toBe(0);
    vi.advanceTimersByTime(1001 + 1);
    expect(saves()).toBe(1);
    vi.advanceTimersByTime(SAVE_MILLIS + 1);
    expect(saves()).toBe(2);
    stop();
  });

  it("a purchase is saved by the engine alone, and puts off the next timed save", () => {
    const { store, saves, stop } = setup();
    vi.advanceTimersByTime(20000);
    const before = saves();
    store.act(({ game, commands }) => commands.buyUnit({ unit: game.unit("drone"), num: 1 }));
    const engineSaves = saves() - before;
    expect(engineSaves).toBeGreaterThan(0);
    // no extra save from the app, and the 30s count starts again
    vi.advanceTimersByTime(SAVE_MILLIS - 1);
    expect(saves()).toBe(before + engineSaves);
    vi.advanceTimersByTime(2);
    expect(saves()).toBe(before + engineSaves + 1);
    stop();
  });

  it("saves at once when the page is hidden or closed, and not while hidden", () => {
    const { win, saves, storage, stop } = setup();
    win.setVisibility("hidden");
    expect(saves()).toBe(1);
    vi.advanceTimersByTime(SAVE_MILLIS * 4);
    expect(saves()).toBe(1);
    win.setVisibility("visible");
    win.dispatchEvent(new Event("pagehide"));
    expect(saves()).toBe(2);
    expect(storage.writes.get(`${SAVE_ID}:heartbeat`)).toBeGreaterThan(0);
    stop();
  });
});
