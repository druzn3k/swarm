import { describe, expect, it } from "vitest";
import { createGame } from "@swarmsim/engine";
import type { Game, SaveStorage } from "@swarmsim/engine";
import { buyAllList, buyCheapestList, gainsSince, isUndoable, previewCast, snapshotCounts, undoSecondsLeft } from "./progression";
import { computeWelcomeBack, interestingUnits } from "./welcomeback";
import { tutorialStep } from "./tutorial";
import { GameStore } from "./store";

function memoryStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function clock(start = Date.UTC(2024, 0, 1)) {
  let t = start;
  const now = () => new Date(t);
  return { now, advance: (secs: number) => (t += secs * 1000) };
}

describe("undo countdown", () => {
  it("allows undo for 30 seconds after an action, and not as a redo", () => {
    const c = clock();
    const { game, commands } = createGame({ now: c.now });
    expect(isUndoable(game, commands)).toBe(false);
    expect(undoSecondsLeft(game, commands)).toBe(0);
    commands.buyUnit({ unit: game.unit("drone"), num: 1 });
    expect(undoSecondsLeft(game, commands)).toBe(30);
    c.advance(10.4);
    game.tick();
    expect(undoSecondsLeft(game, commands)).toBe(20);
    commands.undo();
    expect(game.unit("drone").count().toNumber()).toBe(0);
    // undoing again would redo: the old UI didn't offer it
    expect(isUndoable(game, commands)).toBe(false);
    commands.buyUnit({ unit: game.unit("drone"), num: 1 });
    c.advance(30);
    game.tick();
    expect(isUndoable(game, commands)).toBe(false);
  });
});

describe("buy all / cheapest upgrades", () => {
  it("lists autobuyable upgrades, at 100% and 25% of resources, following notify settings", () => {
    const { game, commands } = createGame();
    expect(buyAllList(game)).toEqual([]);
    game.unit("meat")._setCount(1e6);
    game.cache.onUpdate();
    expect(buyAllList(game).map((u) => u.name)).toContain("hatchery");
    expect(buyCheapestList(game).map((u) => u.name)).toContain("hatchery");
    // "never notify" also leaves it out of buy-all, like the old game
    game.upgrade("hatchery").watch(0);
    game.cache.onUpdate();
    expect(buyAllList(game).map((u) => u.name)).not.toContain("hatchery");
    expect(game.upgrade("hatchery").isNewlyUpgradable()).toBe(false);
    game.upgrade("hatchery").watch(-1);
    expect(game.upgrade("hatchery").isManuallyHidden()).toBe(true);
    // back to the default; the setting lives in the save
    game.upgrade("hatchery").watch(true);
    expect(game.session.state.watched?.hatchery).toBeUndefined();
    game.cache.onUpdate();
    commands.buyAllUpgrades({ upgrades: buyAllList(game), percent: 1 });
    expect(game.upgrade("hatchery").count().toNumber()).toBeGreaterThan(0);
  });

  it("notifies at 2x only when twice the cost is affordable", () => {
    const { game } = createGame();
    const hatchery = game.upgrade("hatchery");
    const cost = hatchery.totalCost()[0].val.toNumber();
    hatchery.watch(2);
    game.unit("meat")._setCount(cost * 1.5);
    game.cache.onUpdate();
    expect(hatchery.isNewlyUpgradable()).toBe(false);
    game.unit("meat")._setCount(cost * 2);
    game.cache.onUpdate();
    expect(hatchery.isNewlyUpgradable()).toBe(true);
  });
});

describe("ability casts", () => {
  it("previews what a cast raises and reports the gains", () => {
    const { game, commands } = createGame();
    const warp = game.upgrade("swarmwarp");
    const preview = previewCast(warp);
    expect(preview.skipSecs).toBeGreaterThan(0);
    expect(preview.units).toContain("meat");
    expect(preview.units).not.toContain("energy");
    const rush = previewCast(game.upgrade("meatrush"));
    expect(rush.units).toEqual(["meat"]);
    expect(rush.skipSecs).toBe(0);

    game.unit("drone")._setCount(100);
    game.unit("nexus")._setCount(5);
    game.unit("energy")._setCount(10000);
    game.cache.onUpdate();
    const before = snapshotCounts(game, preview.units);
    commands.buyUpgrade({ upgrade: warp, num: 1 });
    const gains = gainsSince(game, before);
    expect(gains.map((g) => g.unit.name)).toContain("meat");
    expect(gains.every((g) => g.val.greaterThan(0))).toBe(true);
  });
});

describe("welcome back", () => {
  function closeAndReopen(awaySecs: number, heartbeatSecsBeforeReopen?: number) {
    const c = clock();
    const storage = memoryStorage();
    const first = createGame({ now: c.now, storage });
    first.game.unit("drone")._setCount(10);
    first.game.save();
    c.advance(awaySecs);
    if (heartbeatSecsBeforeReopen != null) {
      storage.setItem(first.session.heartbeatId, new Date(c.now().getTime() - heartbeatSecsBeforeReopen * 1000).toISOString());
    }
    return createGame({ now: c.now, storage });
  }

  it("lists the meat producers and tab leaders that grew while away", () => {
    const { game, session } = closeAndReopen(3600);
    const wb = computeWelcomeBack(game, session)!;
    expect(wb).not.toBeNull();
    expect(Math.round(wb.millis / 1000)).toBe(3600);
    const meat = wb.gains.find((g) => g.unit.name === "meat")!;
    // 10 drones at 1 meat/sec for an hour
    expect(meat.val.toNumber()).toBeCloseTo(36000, 0);
    expect(wb.gains.map((g) => g.unit.name)).toContain("larva");
    expect(wb.gains.every((g) => g.val.greaterThan(0))).toBe(true);
  });

  it("stays quiet after less than 3 minutes, unless forced", () => {
    const { game, session } = closeAndReopen(120);
    expect(computeWelcomeBack(game, session)).toBeNull();
    expect(computeWelcomeBack(game, session, { force: true })).not.toBeNull();
  });

  it("uses the heartbeat: a game that was open until recently isn't welcomed back", () => {
    const { game, session } = closeAndReopen(3600, 30);
    expect(computeWelcomeBack(game, session)).toBeNull();
    expect(computeWelcomeBack(game, session, { ignoreHeartbeat: true })).not.toBeNull();
  });

  it("picks the three highest meat generations that produce, then each tab's lead unit, once each", () => {
    const { game } = createGame();
    // the units being produced: queens (by the nest), drones (by queens), meat (by drones)
    game.unit("nest")._setCount(1);
    game.unit("queen")._setCount(1);
    game.unit("drone")._setCount(1);
    game.cache.onUpdate();
    const names = interestingUnits(game).map((u) => u.name);
    expect(names.slice(0, 3)).toEqual(["queen", "drone", "meat"]);
    expect(names).toContain("meat");
    expect(names).toContain("larva");
    expect(new Set(names).size).toBe(names.length);
  });

  it("is computed by the store on load, and can be dismissed", () => {
    const c = clock();
    const storage = memoryStorage();
    const a = new GameStore({ storage, now: c.now });
    a.game.unit("drone")._setCount(5);
    a.save();
    c.advance(600);
    const b = new GameStore({ storage, now: c.now });
    expect(b.welcomeBack).not.toBeNull();
    b.dismissWelcomeBack();
    expect(b.welcomeBack).toBeNull();
  });
});

describe("tutorial steps", () => {
  const step = (setup: (g: Game) => void) => {
    const { game } = createGame();
    setup(game);
    game.cache.onTick();
    return tutorialStep(game);
  };
  it("follows the old game's conditions", () => {
    expect(step(() => {})).toBe(1);
    expect(step((g) => g.unit("drone")._setCount(1))).toBe(2);
    expect(step((g) => g.unit("drone")._setCount(10))).toBe(3);
    expect(
      step((g) => {
        g.unit("drone")._setCount(10);
        g.unit("meat")._setCount(300);
      })
    ).toBe(11);
    expect(
      step((g) => {
        g.unit("drone")._setCount(10);
        g.upgrade("hatchery")._setCount(1);
      })
    ).toBe(4);
    expect(
      step((g) => {
        g.upgrade("hatchery")._setCount(1);
        g.unit("queen")._setCount(1);
      })
    ).toBe(5);
    expect(
      step((g) => {
        g.upgrade("hatchery")._setCount(1);
        g.unit("queen")._setCount(5);
      })
    ).toBe(6);
    expect(
      step((g) => {
        g.upgrade("hatchery")._setCount(1);
        g.unit("queen")._setCount(5);
        g.unit("territory")._setCount(1);
      })
    ).toBe(7);
    expect(
      step((g) => {
        g.upgrade("hatchery")._setCount(1);
        g.unit("queen")._setCount(5);
        g.unit("territory")._setCount(6);
      })
    ).toBe(8);
    expect(step((g) => g.upgrade("expansion")._setCount(1))).toBe(9);
    expect(step((g) => g.upgrade("expansion")._setCount(5))).toBe(0);
    expect(
      step((g) => {
        g.upgrade("expansion")._setCount(5);
        g.cache.firstSpawn.premutagen = new Date();
      })
    ).toBe(10);
    expect(step((g) => g.unit("ascension")._setCount(1))).toBe(0);
  });

  it("congratulates after the first ascension, this session only", () => {
    const { game } = createGame();
    game.ascend(true);
    expect(tutorialStep(game)).toBe(100);
  });
});
