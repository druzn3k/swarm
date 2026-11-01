import { describe, expect, it } from "vitest";
import { Dec } from "@swarmsim/engine-wasm";
import { buyAllList, buyCheapestList, gainsSince, previewCast, snapshotCounts, undoSecondsLeft } from "./progression";
import { GameStore } from "./store";
import { SAVE_ID, heartbeatKey } from "./saves";
import { memoryStorage } from "./storage";
import { T0, craftV1, storeWith, testClock } from "../test/saves";
import type { CraftOptions } from "../test/saves";

/** move the game's clock and take a view */
function wait(s: { store: GameStore; clock: ReturnType<typeof testClock> }, ms: number) {
  s.clock.advance(ms);
  s.store.advance(ms);
  s.store.refresh();
}

describe("undo countdown", () => {
  it("allows undo for 30 seconds after an action, and not as a redo", () => {
    const s = storeWith();
    const { store } = s;
    expect(undoSecondsLeft(store.g)).toBe(0);
    store.act({ do: "buy_unit", unit: "drone", amount: { num: "1" } });
    expect(undoSecondsLeft(store.g)).toBe(30);
    wait(s, 10_400);
    expect(undoSecondsLeft(store.g)).toBe(20);
    store.act({ do: "undo" });
    expect(store.g.unit("drone").count).toBe("0");
    // undoing again would redo: the old UI didn't offer it
    expect(undoSecondsLeft(store.g)).toBe(0);
    store.act({ do: "buy_unit", unit: "drone", amount: { num: "1" } });
    wait(s, 30_000);
    expect(undoSecondsLeft(store.g)).toBe(0);
  });
});

describe("buy all / cheapest upgrades", () => {
  it("lists autobuyable upgrades, at 100% and 25% of resources, following notify settings", () => {
    expect(buyAllList(storeWith().store.g)).toEqual([]);
    const s = storeWith({ units: { meat: 1e6 } });
    const { store } = s;
    // the larva screen's upgrades in the view (buy-all's lists cover every upgrade anyway)
    store.need({}, { upgrades: ["larva"] });
    expect(buyAllList(store.g).map((u) => u.name)).toContain("hatchery");
    expect(buyCheapestList(store.g).map((u) => u.name)).toContain("hatchery");
    // "never notify" also leaves it out of buy-all, like the old game (after the 3 s cache)
    store.act({ do: "watch", upgrade: "hatchery", level: 0 });
    wait(s, 3100);
    expect(buyAllList(store.g).map((u) => u.name)).not.toContain("hatchery");
    expect(store.g.upgrade("hatchery").newlyUpgradable).toBe(false);
    store.act({ do: "watch", upgrade: "hatchery", level: -1 });
    expect(store.g.upgrade("hatchery").manuallyHidden).toBe(true);
    // back to the default
    store.act({ do: "watch", upgrade: "hatchery", level: 1 });
    wait(s, 3100);
    const list = buyAllList(store.g);
    store.act({ do: "buy_all_upgrades", percent: 1, which: { explicit: list.map((u) => u.name) } });
    expect(Dec.from(store.g.upgrade("hatchery").count).gt(0)).toBe(true);
  });

  it("notifies at 2x only when twice the cost is affordable", () => {
    const cost = Number(storeWith().store.g.upgrade("hatchery").totalCost[0].val);
    const at = (meat: number) => {
      const { store } = storeWith({ units: { meat }, watched: { hatchery: 2 } });
      store.need({}, { upgrades: ["larva"] });
      store.refresh();
      return store.g.upgrade("hatchery").newlyUpgradable;
    };
    expect(at(cost * 1.5)).toBe(false);
    expect(at(cost * 2)).toBe(true);
  });
});

describe("ability casts", () => {
  it("previews what a cast raises and reports the gains", async () => {
    const { store } = storeWith({ units: { drone: 100, nexus: 5, energy: 10000 } });
    // effect outputs are details of the abilities' unit
    store.need({}, { focus: ["energy"] });
    await Promise.resolve();
    const warp = store.g.upgrade("swarmwarp");
    const preview = previewCast(warp);
    expect(preview.skipSecs).toBeGreaterThan(0);
    expect(preview.units).toContain("meat");
    expect(preview.units).not.toContain("energy");
    const rush = previewCast(store.g.upgrade("meatrush"));
    expect(rush.units).toEqual(["meat"]);
    expect(rush.skipSecs).toBe(0);

    const before = snapshotCounts(store.g, preview.units);
    expect(store.act({ do: "buy_upgrade", upgrade: "swarmwarp", amount: { num: "1" } }).error).toBeUndefined();
    const gains = gainsSince(store.g, before);
    expect(gains.map((g) => g.unit.name)).toContain("meat");
    expect(gains.every((g) => Dec.from(g.val).gt(0))).toBe(true);
  });
});

describe("welcome back", () => {
  function closeAndReopen(awaySecs: number, heartbeatSecsBeforeReopen?: number, force = false) {
    const storage = memoryStorage();
    storage.setItem(SAVE_ID, new GameStore({ save: craftV1({ units: { drone: 10 } }), now: () => T0 }).exportSave());
    const reopen = T0 + awaySecs * 1000;
    if (heartbeatSecsBeforeReopen != null) storage.setItem(heartbeatKey(SAVE_ID), String(reopen - heartbeatSecsBeforeReopen * 1000));
    return new GameStore({ storage, now: () => reopen, forceWelcomeBack: force });
  }

  it("lists the meat producers and tab leaders that grew while away", () => {
    const store = closeAndReopen(3600);
    const wb = store.welcomeBack!;
    expect(wb).not.toBeNull();
    expect(Math.round(wb.away_ms / 1000)).toBe(3600);
    const name = (i: number) => store.statics.units[i].name;
    const meat = wb.gains.find((g) => name(g.unit) === "meat")!;
    // 10 drones at 1 meat/sec for an hour
    expect(Number(meat.val)).toBeCloseTo(36000, 0);
    expect(wb.gains.map((g) => name(g.unit))).toContain("larva");
    expect(wb.gains.every((g) => Dec.from(g.val).gt(0))).toBe(true);
  });

  it("stays quiet after less than 3 minutes, unless forced (?forcewelcome)", () => {
    expect(closeAndReopen(120).welcomeBack).toBeNull();
    expect(closeAndReopen(120, undefined, true).welcomeBack).not.toBeNull();
  });

  it("uses the heartbeat: a game that was open until recently isn't welcomed back", () => {
    expect(closeAndReopen(3600, 30).welcomeBack).toBeNull();
  });

  it("is dismissed for good", () => {
    const store = closeAndReopen(600);
    expect(store.welcomeBack).not.toBeNull();
    store.dismissWelcomeBack();
    expect(store.welcomeBack).toBeNull();
    expect(store.view.welcome_back).toBeUndefined();
  });
});

describe("tutorial steps (view.tutorial_step)", () => {
  const step = (craft: CraftOptions) => storeWith(craft).store.view.tutorial_step;
  it("follows the old game's conditions", () => {
    expect(step({})).toBe(1);
    expect(step({ units: { drone: 1 } })).toBe(2);
    expect(step({ units: { drone: 10 } })).toBe(3);
    expect(step({ units: { drone: 10, meat: 300 } })).toBe(11);
    expect(step({ units: { drone: 10 }, upgrades: { hatchery: 1 } })).toBe(4);
    expect(step({ units: { queen: 1 }, upgrades: { hatchery: 1 } })).toBe(5);
    expect(step({ units: { queen: 5 }, upgrades: { hatchery: 1 } })).toBe(6);
    expect(step({ units: { queen: 5, territory: 1 }, upgrades: { hatchery: 1 } })).toBe(7);
    expect(step({ units: { queen: 5, territory: 6 }, upgrades: { hatchery: 1 } })).toBe(8);
    expect(step({ upgrades: { expansion: 1 } })).toBe(9);
    expect(step({ upgrades: { expansion: 5 } })).toBe(0);
    expect(step({ units: { ascension: 1 } })).toBe(0);
  });

  it("congratulates after the first ascension, this session only", () => {
    const { store } = storeWith({ units: { energy: 1e8, mtxEnergy: 1e8, nexus: 5, premutagen: 100 }, upgrades: { nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1 } });
    expect(store.act({ do: "ascend" }).error).toBeUndefined();
    expect(store.view.tutorial_step).toBe(100);
  });
});
