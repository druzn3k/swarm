import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@swarmsim/engine";
import { GameStore, TICK_MILLIS } from "./store";
import { FakeWindow, countingStorage } from "./fakewindow";

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2024, 0, 1) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GameStore.start ticks", () => {
  it("stops ticking while the page is hidden and catches up with one tick on return", () => {
    const storage = countingStorage();
    // a game with production going, so time matters
    const seed = createGame({});
    seed.game.unit("drone")._setCount(1000);
    seed.game.unit("queen")._setCount(10);
    seed.game.save();
    const store = new GameStore({ storage, save: seed.session.exportSave() });
    const win = new FakeWindow();
    const tick = vi.spyOn(store, "tick");
    const stop = store.start(win.asWindow());
    vi.advanceTimersByTime(TICK_MILLIS * 10);
    expect(tick.mock.calls.length).toBe(11); // the first one at start, then every 100ms

    win.setVisibility("hidden");
    tick.mockClear();
    vi.advanceTimersByTime(3_600_000);
    expect(tick).not.toHaveBeenCalled();

    win.setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    // the same as a game that ticked all along
    const ref = createGame({ save: seed.session.exportSave() });
    ref.game.tick(new Date(Date.now()));
    for (const name of ["meat", "drone", "larva"]) {
      expect(store.game.unit(name).count().toString(), name).toBe(ref.game.unit(name).count().toString());
    }
    expect(store.game.unit("meat").count().greaterThan(1e6)).toBe(true);

    vi.advanceTimersByTime(TICK_MILLIS * 5);
    expect(tick).toHaveBeenCalledTimes(6);
    stop();
    vi.advanceTimersByTime(TICK_MILLIS * 5);
    expect(tick).toHaveBeenCalledTimes(6);
  });

  it("does not tick on a timer when started in a hidden page", () => {
    const store = new GameStore({ storage: countingStorage() });
    const win = new FakeWindow();
    win.document.visibilityState = "hidden";
    const tick = vi.spyOn(store, "tick");
    const stop = store.start(win.asWindow());
    vi.advanceTimersByTime(TICK_MILLIS * 50);
    expect(tick).toHaveBeenCalledTimes(1);
    win.setVisibility("visible");
    vi.advanceTimersByTime(TICK_MILLIS);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });
});
