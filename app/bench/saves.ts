// Early, mid and late saves for the benchmarks, made with the engine at run
// time (ported from the performance reviews' craft script). The game is played
// on a fixed clock, so every run gets the same units, upgrades, statistics and
// achievements; only the save's dates are moved to "a few seconds ago" when a
// page is seeded, so the app shows no welcome-back and does no offline catch-up.
import * as engine from "@swarmsim/engine";

// The engine is TypeScript source loaded as CommonJS (tsx, Playwright); its named exports may sit on the default export.
const { createGame } = ((engine as { default?: typeof engine }).default ?? engine) as typeof engine;

export const SAVE_NAMES = ["early", "mid", "late"] as const;
export type SaveName = (typeof SAVE_NAMES)[number];

type Counts = Record<string, number | string>;
interface Recipe {
  units: Counts;
  upgrades: Record<string, number>;
  /** rounds of "ten minutes pass, buy a quarter of everything", so statistics and achievements fill in */
  rounds: number;
}

const RECIPES: Record<SaveName, Recipe> = {
  early: { units: { meat: 300, drone: 12 }, upgrades: {}, rounds: 0 },
  mid: {
    units: {
      meat: 1e25, larva: 1e9, drone: 1e9, queen: 1e6, nest: 5e4, greaterqueen: 900, hive: 40, hivequeen: 3,
      territory: 1e9, swarmling: 1e6, stinger: 3e4, centipede: 1234, nexus: 5, energy: 5000, nightbug: 1e5, bat: 100,
    },
    upgrades: { hatchery: 10, expansion: 5, nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1 },
    rounds: 20,
  },
  late: {
    units: {
      meat: "1e80", larva: "1e40", drone: "1e40", queen: "1e35", nest: "1e30", greaterqueen: "1e25", hive: "1e20",
      hivequeen: "1e15", empress: "1e12", prophet: "1e9", goddess: "1e6", pantheon: 1e4, pantheon2: 100,
      territory: "1e40", swarmling: "1e20", stinger: "1e18", spider: "1e16", mosquito: "1e14", locust: "1e12",
      roach: "1e10", giantspider: "1e8", centipede: "1e8", wasp: "1e6", devourer: "1e4", goon: 1000,
      nexus: 5, energy: 50000, nightbug: "1e8", bat: 1e6, moth: 1e5, crystal: 1e7, premutagen: "1e9", mutagen: "1e12",
      overmind: 100, pantheon3: 10, ascension: 10,
      mutanthatchery: 1000, mutantbat: 1000, mutantclone: 1000, mutantswarmwarp: 1000, mutantrush: 1000,
      mutanteach: 1000, mutantfreq: 1000, mutantnexus: 1000, mutantarmy: 1000, mutantmeat: 1000,
    },
    upgrades: {
      hatchery: 100, expansion: 100, mutatehidden: 1, mutatehatchery: 5, mutatebat: 5, mutateclone: 5, mutateswarmwarp: 5,
      mutaterush: 5, mutateeach: 5, mutatefreq: 5, mutatenexus: 5, mutatearmy: 5, mutatemeat: 5,
      nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1,
    },
    rounds: 40,
  },
};

/** The fixed clock the saves are played on (any fixed date works). */
const START = Date.UTC(2026, 0, 1);
const DAY = 86400e3;

export interface BenchSave {
  name: SaveName;
  /** the save, its dates moved so it was last saved `agoMs` before `now` */
  encode(now?: number, agoMs?: number): string;
  summary: { achievements: number; achievementsTotal: number; units: number; upgrades: number; chars: number };
}

/** Plays one save on the fixed clock. */
export function craftSave(name: SaveName): BenchSave {
  const recipe = RECIPES[name];
  let t = START;
  const { game, commands, session } = createGame({ now: () => new Date(t) });
  for (const [n, v] of Object.entries(recipe.units)) game.unit(n)._setCount(v);
  for (const [n, v] of Object.entries(recipe.upgrades)) game.upgrade(n)._setCount(v);
  game.save();
  for (let r = 0; r < recipe.rounds; r++) {
    t += 600e3;
    game.tick();
    for (const u of game.unitlist().slice().reverse()) {
      if (!u.isVisible() || u.isBuyable?.() === false) continue;
      try {
        if (u.maxCostMet().gte(1)) commands.buyMaxUnit({ unit: u, percent: 0.25 });
      } catch {
        /* some units can't be bought this way (e.g. no cost); skip them */
      }
    }
    try {
      commands.buyAllUpgrades({ upgrades: game.availableAutobuyUpgrades(), percent: 0.25 });
    } catch {
      /* nothing affordable */
    }
  }
  // a month after the start, like the original script's "now"
  t = START + 30 * DAY;
  game.tick();
  game.save();
  const end = t;
  // a plain JSON copy of the state (Decimals become strings, Dates ISO strings)
  const state = JSON.stringify(session.state);
  const encode = (now = Date.now(), agoMs = 5000): string => {
    const copy = JSON.parse(state) as { date: Record<string, string> };
    const shift = now - agoMs - end;
    for (const k of Object.keys(copy.date)) copy.date[k] = new Date(Date.parse(copy.date[k]) + shift).toISOString();
    delete copy.date.loaded;
    return session._saves(copy, false);
  };
  return {
    name,
    encode,
    summary: {
      achievements: game.achievementlist().filter((a) => a.isEarned()).length,
      achievementsTotal: game.achievementlist().length,
      units: game.unitlist().filter((u) => u.isVisible()).length,
      upgrades: game.upgradelist().filter((u) => u.isVisible()).length,
      chars: encode().length,
    },
  };
}
