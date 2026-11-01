import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@swarmsim/engine";
import { Dec } from "@swarmsim/engine-wasm";
import { GameStore, RESYNC_MILLIS, TICK_MILLIS } from "./store";
import { FakeWindow, countingStorage } from "./fakewindow";
import { T0, craftV1, storeWith } from "../test/saves";

const relClose = (a: string, b: string, rel = 1e-9) => {
  const x = Dec.from(a);
  const y = Dec.from(b);
  if (y.isZero()) return x.isZero();
  return x.minus(y).abs().div(y.abs()).lte(rel);
};

describe("GameStore frame loop", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // a game with production going, so time matters
  const busy = () => craftV1({ units: { drone: 1000, queen: 10 } });
  const running = () => {
    const store = new GameStore({ storage: countingStorage(), save: busy(), perfNow: () => Date.now() });
    const win = new FakeWindow();
    const refresh = vi.spyOn(store, "refresh");
    const stop = store.start(win.asWindow());
    return { store, win, refresh, stop };
  };

  it("advances by the monotonic clock every frame and takes a view every 100ms", () => {
    const { store, win, refresh, stop } = running();
    expect(refresh).toHaveBeenCalledTimes(1); // at start
    vi.advanceTimersByTime(1000);
    expect(win.frames).toBeGreaterThan(50);
    // ~10 views a second, not one per frame
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(13);
    // (the latest view is at most one view interval old)
    expect(T0 + 1000 - store.view.now_ms).toBeLessThanOrEqual(TICK_MILLIS);
    expect(T0 + 1000 - store.view.now_ms).toBeGreaterThanOrEqual(0);
    stop();
  });

  it("stops frames while the page is hidden and catches up with one frame on return", () => {
    const { store, win, refresh, stop } = running();
    win.setVisibility("hidden");
    refresh.mockClear();
    const frames = win.frames;
    vi.advanceTimersByTime(3_600_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(win.frames).toBe(frames);

    win.setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.view.now_ms).toBe(T0 + 3_600_000);
    // the same as the old engine loading the save an hour later
    const ref = createGame({ save: busy(), now: () => new Date(T0 + 3_600_000) });
    for (const name of ["meat", "drone", "larva"]) {
      const got = store.g.unit(name).count;
      const want = ref.game.unit(name).count().toString();
      expect(relClose(got, want), `${name}: ${got} vs ${want}`).toBe(true);
    }
    expect(Dec.from(store.g.unit("meat").count).gt(1e6)).toBe(true);

    vi.advanceTimersByTime(TICK_MILLIS * 5);
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(5);
    stop();
    refresh.mockClear();
    vi.advanceTimersByTime(TICK_MILLIS * 5);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not run frames when started in a hidden page", () => {
    const store = new GameStore({ storage: countingStorage(), perfNow: () => Date.now() });
    const win = new FakeWindow();
    win.document.visibilityState = "hidden";
    const refresh = vi.spyOn(store, "refresh");
    const stop = store.start(win.asWindow());
    vi.advanceTimersByTime(TICK_MILLIS * 50);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(win.frames).toBe(0);
    win.setVisibility("visible");
    vi.advanceTimersByTime(TICK_MILLIS);
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });
});

describe("GameStore clocks", () => {
  it("resyncs with the wall clock once a second, adding time the monotonic clock missed", () => {
    const { store, clock } = storeWith({ units: { drone: 10 } });
    const state = { last: clock.perf(), lastView: -Infinity, lastResync: clock.perf() };
    clock.advance(100);
    store.frame(state);
    expect(store.view.now_ms).toBe(T0 + 100);
    // the laptop sleeps for ten minutes: the monotonic clock doesn't see it
    clock.suspend(600_000);
    clock.advance(RESYNC_MILLIS);
    store.frame(state);
    expect(store.view.now_ms).toBe(T0 + 100 + 600_000 + RESYNC_MILLIS);
  });
});

describe("GameStore.act", () => {
  const counted = () => {
    const { store } = storeWith({ units: { meat: 1e30, larva: 1e30, drone: 1e6 } });
    let bumps = 0;
    store.subscribe(() => bumps++);
    return { store, bumps: () => bumps };
  };

  it("runs a command, returns its outcome, and tells subscribers once", () => {
    const { store, bumps } = counted();
    const commands: string[] = [];
    store.on("command", (c) => commands.push(`${c.name}:${c.unit}`));
    const { error, outcome } = store.act({ do: "buy_unit", unit: "drone", amount: { num: "1" } });
    expect(error).toBeUndefined();
    expect(outcome?.bought?.num).toBe("1");
    expect(commands).toEqual(["buyUnit:drone"]);
    expect(bumps()).toBe(1);
    expect(store.g.unit("drone").count).toBe("1000001");
  });

  it("tells subscribers once for an action with many command events", () => {
    const { store, bumps } = counted();
    let events = 0;
    store.on("command", () => events++);
    store.act({ do: "buy_all_upgrades", percent: 1, which: "autobuyable" });
    expect(events).toBeGreaterThan(1);
    expect(bumps()).toBe(1);
  });

  it("returns errors instead of throwing, and still tells subscribers", () => {
    const { store, bumps } = counted();
    const { error } = store.act({ do: "buy_unit", unit: "nope", amount: { num: "1" } });
    expect(String(error)).toContain("nope");
    expect(bumps()).toBe(1);
    // a list stops at the first command that fails
    const multi = store.act([
      { do: "buy_unit", unit: "drone", amount: { num: "1" } },
      { do: "buy_unit", unit: "nope", amount: { num: "1" } },
      { do: "buy_unit", unit: "drone", amount: { num: "1" } },
    ]);
    expect(multi.error).toBeInstanceOf(Error);
    expect(store.g.unit("drone").count).toBe("1000001");
    expect(bumps()).toBe(2);
    expect(store.actions).toBe(2);
  });

  it("emits achievements and writes the save the engine asks for", () => {
    const storage = countingStorage();
    const store = new GameStore({ storage, save: craftV1({ units: { meat: 100, larva: 100 } }) });
    const achieved: string[] = [];
    store.on("achieve", (i) => achieved.push(store.statics.achievements[i].name));
    const before = storage.writes.get("swarmhive-v2") ?? 0;
    store.act({ do: "buy_unit", unit: "drone", amount: { num: "1" } });
    expect(achieved).toContain("drone1");
    expect(storage.writes.get("swarmhive-v2")).toBe(before + 1);
    expect(storage.getItem("swarmhive-v2")).toMatch(/^SW2\|/);
  });

  it("keeps options in the save's options bag", () => {
    const { store } = counted();
    store.setOption("notation", "hybrid");
    expect(store.ui.options.notation).toBe("hybrid");
    expect(store.handle.uiState().options.notation).toBe("hybrid");
  });
});

describe("GameStore needs", () => {
  it("adds the focused units' details and optional sections while needed, in one view", async () => {
    const { store } = storeWith({ units: { drone: 10, queen: 2 } });
    const refresh = vi.spyOn(store, "refresh");
    expect(store.g.unit("drone").detailed).toBe(false);
    const a = {};
    const b = {};
    const releaseA = store.need(a, { focus: ["drone"] });
    store.need(b, { focus: ["queen"], sections: ["statistics"] });
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.g.unit("drone").detailed).toBe(true);
    expect(store.g.unit("queen").eachProduction.drone).toBeDefined();
    expect(store.view.statistics).toBeDefined();
    expect(store.view.ascension).toBeUndefined();
    releaseA();
    store.refresh();
    expect(store.g.unit("drone").detailed).toBe(false);
    expect(store.g.unit("queen").detailed).toBe(true);
  });

  it("reads hidden units' stats on request", async () => {
    const { store } = storeWith({ upgrades: { hatchery: 3 } });
    store.need({}, { hidden: ["invisiblehatchery"] });
    await Promise.resolve();
    expect(store.g.unit("invisiblehatchery").stat("random.freq")).toBeDefined();
    expect(store.g.unit("invisiblehatchery").totalProduction.larva).toBeDefined();
  });
});

describe("GameStore import and reset", () => {
  it("imports a save of either format, with a welcome back and the import achievement", () => {
    const { store } = storeWith({ units: { drone: 3 } });
    const other = craftV1({ units: { drone: 77 }, at: T0 - 3_600_000 });
    expect(() => store.checkSave(other)).not.toThrow();
    expect(() => store.checkSave("junk")).toThrow();
    const achieved: string[] = [];
    store.on("achieve", (i) => achieved.push(store.statics.achievements[i].name));
    expect(store.importSave(other).error).toBeUndefined();
    expect(Dec.from(store.g.unit("drone").count).eq(77)).toBe(true);
    expect(store.welcomeBack?.away_ms).toBe(3_600_000);
    expect(achieved.length).toBeGreaterThan(0);
    // and back from its own v2 export
    const v2 = store.exportSave("v2");
    store.act({ do: "buy_unit", unit: "drone", amount: { num: "0" } });
    expect(store.importSave(v2).error).toBeUndefined();
    expect(Dec.from(store.g.unit("drone").count).eq(77)).toBe(true);
    // a bad one leaves the game alone
    expect(store.importSave("nope").error).toBeInstanceOf(Error);
    expect(Dec.from(store.g.unit("drone").count).eq(77)).toBe(true);
  });

  it("resets to a new game and saves it", () => {
    const storage = countingStorage();
    const store = new GameStore({ storage, save: craftV1({ units: { drone: 3 } }) });
    store.reset();
    expect(store.g.unit("drone").count).toBe("0");
    const again = new GameStore({ storage });
    expect(again.loaded).toBe("v2");
    expect(again.g.unit("drone").count).toBe("0");
  });
});

describe("GameStore upgrade scope", () => {
  it("lists only the upgrades of the units components ask for, and every unit", async () => {
    const { store } = storeWith({ units: { drone: 10, meat: 1e6 } });
    store.need({}, { upgrades: ["drone"] });
    await Promise.resolve();
    expect(store.g.upgrade("dronetwin").v).toBeDefined();
    expect(store.g.upgrade("hatchery").v).toBeUndefined();
    expect(store.g.unit("larva").v).toBeDefined();
    // buy-all still sees every upgrade
    expect(store.view.buy_all?.map((i) => store.statics.upgrades[i].name)).toContain("hatchery");
    store.need({}, { upgrades: "all" });
    await Promise.resolve();
    expect(store.g.upgrade("hatchery").v).toBeDefined();
  });
});
