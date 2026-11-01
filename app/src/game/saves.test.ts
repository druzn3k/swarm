// The v1 -> v2 migration on first load: the wasm engine plays on from where
// the TypeScript engine (the parity oracle, a dev dependency here) left the
// game, and the v1 save stays as it was.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame } from "@swarmsim/engine";
import { Dec, detectSaveFormat } from "@swarmsim/engine-wasm";
import { GameStore } from "./store";
import { LEGACY_SAVE_ID, SAVE_ID, heartbeatKey, loadGame } from "./saves";
import { countingStorage } from "./fakewindow";
import { craftV1 } from "../test/saves";

const fixtures = JSON.parse(readFileSync(new URL("../../../engine/test/fixtures/session-saves.json", import.meta.url), "utf8")) as Record<string, string>;

/** within `rel` of each other, relative to the larger */
function relClose(a: string, b: string, rel = 1e-9): boolean {
  const x = Dec.from(a);
  const y = Dec.from(b);
  if (x.eq(y)) return true;
  const scale = Dec.max(x.abs(), y.abs());
  return x.minus(y).abs().div(scale).lte(rel);
}

const MID = craftV1({
  units: {
    meat: 1e25, larva: 1e9, drone: 1e9, queen: 1e6, nest: 5e4, greaterqueen: 900, hive: 40, hivequeen: 3,
    territory: 1e9, swarmling: 1e6, stinger: 3e4, centipede: 1234, nexus: 5, energy: 5000, nightbug: 1e5, bat: 100,
    premutagen: 1e6, crystal: 12,
  },
  upgrades: { hatchery: 10, expansion: 5, nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1, dronetwin: 2 },
  options: { notation: "engineering", theme: "slate" },
  at: Date.UTC(2025, 5, 1),
});

const LATE = craftV1({
  units: {
    meat: "1e80", larva: "1e40", drone: "1e40", queen: "1e35", nest: "1e30", greaterqueen: "1e25", hive: "1e20", hivequeen: "1e15",
    empress: "1e12", prophet: "1e9", goddess: "1e6", pantheon: 1e4, territory: "1e40", swarmling: "1e20", stinger: "1e18",
    nexus: 5, energy: 50000, nightbug: "1e8", bat: 1e6, moth: 1e5, crystal: 1e7, premutagen: "1e9", mutagen: "1e12", ascension: 10,
    mutanthatchery: 1000, mutantbat: 1000, mutantmeat: 1000, mutantnexus: 1000,
  },
  upgrades: { hatchery: 100, expansion: 100, mutatehidden: 1, mutatehatchery: 5, mutatebat: 5, mutatemeat: 5, mutatenexus: 5 },
  at: Date.UTC(2025, 5, 1, 12),
});

const SAVES: Record<string, string> = { mid: MID, late: LATE, ...fixtures };
/** when the migration happens: a day after the mid save, years after the fixtures */
const NOW = Date.UTC(2025, 5, 2);

describe("v1 -> v2 migration", () => {
  for (const [name, v1] of Object.entries(SAVES)) {
    let ref: ReturnType<typeof createGame>;
    try {
      ref = createGame({ save: v1, now: () => new Date(NOW) });
    } catch {
      // the old engine refuses it too (publictestBroken): nothing to compare
      it.skip(`${name}: not loadable by the old engine`, () => {});
      continue;
    }
    it(`${name}: counts match the old engine's reading of the v1 save (rel 1e-9)`, () => {
      const storage = countingStorage();
      storage.setItem(LEGACY_SAVE_ID, v1);
      const store = new GameStore({ storage, now: () => NOW });
      expect(store.loaded).toBe("migrated");
      let compared = 0;
      for (const unit of ref.game.unitlist()) {
        const want = unit.count().toString();
        const got = store.g.unit(unit.name).count;
        expect(relClose(got, want), `${unit.name}: wasm ${got}, ts ${want}`).toBe(true);
        compared++;
      }
      for (const up of ref.game.upgradelist()) {
        expect(store.g.upgrade(up.name).count, up.name).toBe(Dec.from(up.count().toString()).toString());
      }
      expect(compared).toBeGreaterThan(50);
    });
  }

  it("keeps the v1 save untouched, writes v2 under its own key, and loads v2 from then on", () => {
    const storage = countingStorage();
    storage.setItem(LEGACY_SAVE_ID, MID);
    storage.setItem(heartbeatKey(LEGACY_SAVE_ID), new Date(NOW - 60_000).toISOString());
    const writesBefore = storage.writes.get(LEGACY_SAVE_ID);
    const store = new GameStore({ storage, now: () => NOW });
    expect(store.loaded).toBe("migrated");
    expect(detectSaveFormat(storage.getItem(SAVE_ID)!)).toBe("v2");
    // the heartbeat of the old engine counts: closed a minute ago, no welcome back
    expect(store.welcomeBack).toBeNull();
    expect(store.ui.options).toMatchObject({ notation: "engineering", theme: "slate" });

    // play, save, close, reopen: v1 never written again
    store.act({ do: "buy_unit", unit: "drone", amount: { num: "1" } });
    store.save();
    store.close();
    const again = new GameStore({ storage, now: () => NOW + 1000 });
    expect(again.loaded).toBe("v2");
    expect(storage.getItem(LEGACY_SAVE_ID)).toBe(MID);
    expect(storage.writes.get(LEGACY_SAVE_ID)).toBe(writesBefore);
    expect(storage.writes.get(SAVE_ID)).toBeGreaterThanOrEqual(2);
    // the purchase is in the v2 save
    const fresh = createGame({ save: MID, now: () => new Date(NOW) });
    expect(Dec.from(again.g.unit("drone").count).gt(fresh.game.unit("drone").count().toString())).toBe(true);
  });

  it("leaves an unreadable v1 save alone and starts a new game", () => {
    const storage = countingStorage();
    storage.setItem(LEGACY_SAVE_ID, "not a save");
    const loaded = loadGame(storage, NOW);
    expect(loaded.source).toBe("new");
    expect(storage.getItem(LEGACY_SAVE_ID)).toBe("not a save");
    expect(storage.getItem(SAVE_ID)).toBeNull();
  });

  it("keeps an unreadable v2 save aside instead of overwriting it", () => {
    const storage = countingStorage();
    storage.setItem(SAVE_ID, "SW2|garbage");
    const loaded = loadGame(storage, NOW);
    expect(loaded.source).toBe("new");
    expect(storage.getItem(`${SAVE_ID}:unreadable`)).toBe("SW2|garbage");
  });
});
