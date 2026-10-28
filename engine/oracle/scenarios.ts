// Golden scenario definitions. Each produces a static action list (some are
// planned by a simple deterministic auto-player running against a planning
// oracle), which runScenario() then replays on a fresh old-engine instance.
import * as fs from "fs";
import * as path from "path";
import { createOracle, Oracle } from "./oracle";
import { Action, runStep, Scenario, SnapshotKind, snapshotFull, Step } from "./scenario";

export const T0 = "2020-01-01T00:00:00.000Z";
const T0_MS = Date.parse(T0);

export function at(secs: number, base = T0_MS): string {
  return new Date(base + Math.round(secs * 1000)).toISOString();
}

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---- save fixtures ----
const persistFixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../swarmsim-ts/src/persist.test.json"), "utf8"),
);
/** fresh 1.1.14 game, from swarmsim-ts/src/persist.test.json */
export const SAVE_FRESH: string = persistFixture.exports[0].export_;
/** mid-game 1.1.14 save (3 days in, nexus 3, ~1e21 meat), from swarmsim-ts/src/persist.test.json */
export const SAVE_MIDGAME: string = persistFixture.exports[1].export_;
const MIDGAME_SAVED_AT: string = JSON.parse(persistFixture.exports[1].body).date.saved;
/** 1.0.0 save, from swarmsim-coffee/test/spec/services/session.coffee ("validates the format version") */
export const SAVE_V1 =
  "MS4wLjA=|Q2hlYXRlciA6KAoKN4IglgJiBcIG4AYB0AmEAaEALApgQwCcAXAI3yIEkpZFVpdDTyMQBXAOzCKIE8AHHAGcYoMOzhhBYEgBscWPEQDGuAjxggAjCwC2zWCgCsAZhSmkhgOzbMMwnDwbNAFgCcbpADZDzlkoD2Af7sGggsRDgEBFz+aqEsOOyRAObqsGGYBEICSgCiSQSp8ZhJAB6swum6rER4yYnFIHxZOjV1DVWYeIJKiVLBjQBmWTgAStk4Shq+mBAEwThOliwAjqw4HSAZIEmCRI3JWYqRaxshndhgcIsXWFc4p5vbODrNQpVbLM3+fLj7F8l/BAIO9Gnw8OwiLgBhdwZDoew0LCIVCcMFjGCUQjfMj4Wj2IZGv5rgQdGJqJ9MMTImT2BAkZSQNTSeSMRdmbSIDjGRzyYT2STOZ5GoIAO6EHQyMTJEVEaWREV8SAKi46fyCNYxRoyQIVf6M+Z4FQHMAowRKkEERq9SFgAQgxri82NEFwfysLJWgH+GGMzjJLCkVgy1X+KGNEiKRqtWrwxQqSJpRkxlGR/XbFOQpQ6pLRtqQsUS8UEPh52NEAgVLBllH4Y2q/NEYYPGuQsoVVu1UlJjONvRRqoAX1mxxEID2jBwFJQCE0hgAtAgUPPNJoACoIBDQFAADmgmlcSGMlhQAC0WFkJ8QpxoZ3PF8vVxut7v94fj2eWII8Ndp7OF0uK7rggzjQMeYGeEgLjGOemQ4GAgxgDeBj/g+QEbqB4HGJBS6eLBIDZuqyEgHeAGPsBL57geR4nuew5MnwcrBJUwD0awfCHHgIIsfRE5ynsYBKCxIAkDwACqnD/KAcwLGO2aCQA1pUxglKwOhLOEopiOwakaZgOB2HwghTgAYmABB7DAKDuAgxiDvRoliRxBBcTcrGYPJShKTAdldCoSHXHoBZjnwrCyIJER7No+4oCgmizPMSTRdZzi2R5CjsPUOohtZhieJ4liGLMOAkMGMAuK4eXeM4vEKXa9oALJgDIUqVAgmAkv05ygFeEQUpoSDIGE9lAAAA";

// ---- planning helpers ----

/** Records steps while applying them to a live planning oracle. */
class Planner {
  readonly steps: Step[] = [];
  constructor(readonly o: Oracle) {}
  /** apply exactly like runScenario does (including snapshot queries, which touch caches) */
  push(action: Action, snapshot?: SnapshotKind) {
    const step: Step = snapshot ? { action, snapshot } : { action };
    runStep(this.o, step);
    this.steps.push(step);
  }
  get game() {
    return this.o.game;
  }
}

function plan(start: Scenario["start"], fn: (p: Planner) => void): Step[] {
  const p = new Planner(createOracle({ now: start.now, save: start.save }));
  snapshotFull(p.o); // runScenario takes an initial snapshot too
  fn(p);
  return p.steps;
}

/** Buy max of every affordable unit in a tab, highest tier first. */
function buyTab(p: Planner, tabName: string, percent: number) {
  const tab = p.game.tabs.byName[tabName];
  if (!tab) return;
  for (const u of [...tab.units].reverse()) {
    if (u.unittype.unbuyable || !u.isVisible() || !u.isBuyable()) continue;
    if (u.maxCostMet(percent).greaterThan(0)) {
      p.push({ do: "buyMaxUnit", unit: u.name, percent });
    }
  }
}

/** One round of the auto-player: tick, buy all upgrades, buy units. */
function autoRound(p: Planner, t: string) {
  p.push({ do: "tick", at: t });
  p.push({ do: "buyAllUpgrades" });
  buyTab(p, "meat", 0.5);
  buyTab(p, "territory", 0.5);
  p.push({ do: "ascendInfo" }, "full");
}

// ---- scenarios ----

export function scenarios(): Scenario[] {
  const list: Scenario[] = [];

  // 1. a fresh game left alone
  {
    const start = { now: T0 };
    const times = [0, 1, 60, HOUR, DAY, 30 * DAY];
    list.push({
      name: "fresh-idle",
      description:
        "Fresh game, nothing bought. counts+velocity of every unit at t=0, 1s, 60s, 1h, 1d, 30d; full snapshots at 0 and 30d.",
      start,
      steps: times.map((s, i) => ({
        action: { do: "tick", at: at(s) } as Action,
        snapshot: (i === 0 || i === times.length - 1 ? "full" : "counts") as SnapshotKind,
      })),
    });
  }

  // 2. scripted early game: explicit opening, then a deterministic auto-player
  {
    const start = { now: T0 };
    const roundTimes = [
      2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, 45 * MIN, HOUR, 2 * HOUR, 3 * HOUR,
      5 * HOUR, 8 * HOUR, 12 * HOUR, DAY, 1.5 * DAY, 2 * DAY, 3 * DAY,
    ];
    const steps = plan(start, (p) => {
      p.push({ do: "buyUnit", unit: "drone", num: 3 }, "full");
      p.push({ do: "buyUnit", unit: "queen", num: 1 }, "none"); // can't afford: error
      p.push({ do: "tick", at: at(10) });
      p.push({ do: "buyUnit", unit: "drone", num: 1000 }, "full"); // more than affordable: buys max
      p.push({ do: "tick", at: at(60) });
      p.push({ do: "buyMaxUnit", unit: "drone", percent: 1 }, "full");
      for (const t of roundTimes) autoRound(p, at(t));
    });
    // split into two files to keep them small
    const cut = steps.findIndex((s) => s.action.do === "tick" && s.action.at === at(HOUR));
    list.push({
      name: "early-game-1",
      description:
        "Scripted opening (buy drones, failed queen buy, over-buy) then an auto-player (buyAllUpgrades + buyMaxUnit 50% per meat/territory tier) up to t=45min. Full snapshots after each round.",
      start,
      steps: steps.slice(0, cut),
    });
    list.push({
      name: "early-game-2",
      description:
        "Continuation of early-game-1 (replays its steps first, unrecorded) from t=1h to t=3d: queens, nests, territory, hatchery/expansion (seeded premutagen), droneprod etc.",
      start,
      prefixSteps: steps.slice(0, cut),
      steps: steps.slice(cut),
    });
  }

  // 3. undo / redo
  {
    const start = { now: T0 };
    list.push({
      name: "undo",
      description: "commands.undo() after buying, and redo (undo of the undo).",
      start,
      steps: [
        { action: { do: "setUnitCount", unit: "meat", val: 10000 } },
        { action: { do: "setUnitCount", unit: "larva", val: 10000 } },
        { action: { do: "tick", at: at(5) } },
        { action: { do: "buyUnit", unit: "drone", num: 7 }, snapshot: "counts" },
        { action: { do: "tick", at: at(8) } },
        { action: { do: "undo" }, snapshot: "counts" },
        { action: { do: "tick", at: at(9) } },
        { action: { do: "undo" }, snapshot: "counts" },
        { action: { do: "tick", at: at(20) }, snapshot: "counts" },
      ],
    });
  }

  // 4. estimates
  {
    const start = { now: MIDGAME_SAVED_AT, save: SAVE_MIDGAME };
    const steps: Step[] = [];
    const est = (unit: string, target: string | number) =>
      steps.push({ action: { do: "estimateUnit", unit, target } });
    const g = createOracle(start).game;
    const units = ["meat", "drone", "queen", "nest", "greaterqueen", "larva", "territory", "energy", "swarmling", "crystal", "hive"];
    for (const name of units) {
      const c = g.unit(name).count();
      est(name, c.minus(1).toString());
      est(name, c.plus(1).toString());
      est(name, c.times(2).toString());
      est(name, c.times(10).plus(10).toString());
      est(name, "1e30");
    }
    for (const up of g.upgradelist()) {
      if (up.isVisible()) steps.push({ action: { do: "estimateUpgrade", upgrade: up.name } });
    }
    steps.push({ action: { do: "ascendInfo" } });
    for (const secs of [1, 60, 3600, 86400, 1e7]) {
      steps.push({ action: { do: "countInSecs", unit: "meat", secs } });
    }
    // time passes: estimates for the same targets shift
    steps.push({ action: { do: "tick", at: at(3 * MIN, Date.parse(MIDGAME_SAVED_AT)) } });
    for (const up of g.upgradelist()) {
      if (up.isVisible()) steps.push({ action: { do: "estimateUpgrade", upgrade: up.name } });
    }
    est("meat", "1e30");
    est("territory", "1e20");
    list.push({
      name: "estimates-midgame",
      description:
        "estimateSecsUntilEarned for several units/targets (incl. already-met -> number 0, degree>2 bisection), estimateSecsUntilBuyable for every visible upgrade, ascend/respec cost info, count-in-the-future; on the mid-game save.",
      start,
      steps,
    });

    const fresh = { now: T0 };
    list.push({
      name: "estimates-fresh",
      description: "Estimates in a fresh game: zero-velocity (Infinity), linear (larva), after first drones (meat degree 1), after queens (degree 2).",
      start: fresh,
      steps: [
        { action: { do: "estimateUnit", unit: "meat", target: 100 } },
        { action: { do: "estimateUnit", unit: "larva", target: 100 } },
        { action: { do: "estimateUnit", unit: "drone", target: 100 } },
        { action: { do: "estimateUpgrade", upgrade: "hatchery" } },
        { action: { do: "buyUnit", unit: "drone", num: 3 } },
        { action: { do: "estimateUnit", unit: "meat", target: 100 } },
        { action: { do: "estimateUnit", unit: "meat", target: 1e6 } },
        { action: { do: "estimateUpgrade", upgrade: "hatchery" } },
        { action: { do: "estimateUpgrade", upgrade: "droneprod" } },
        { action: { do: "setUnitCount", unit: "queen", val: 5 } },
        { action: { do: "estimateUnit", unit: "meat", target: 1e6 } },
        { action: { do: "estimateUnit", unit: "drone", target: 1000 } },
        { action: { do: "setUnitCount", unit: "nest", val: 2 } },
        { action: { do: "estimateUnit", unit: "meat", target: 1e9 } },
        { action: { do: "estimateUnit", unit: "drone", target: 1e6 } },
        { action: { do: "estimateUpgrade", upgrade: "droneprod" } },
        { action: { do: "tick", at: at(100) }, snapshot: "full" },
      ],
    });
  }

  // 5. mid-game save: import, snapshot, play forward
  {
    const start = { now: MIDGAME_SAVED_AT, save: SAVE_MIDGAME };
    const base = Date.parse(MIDGAME_SAVED_AT);
    const steps = plan(start, (p) => {
      p.push({ do: "exportSave" });
      p.push({ do: "tick", at: at(HOUR, base) }, "full");
      p.push({ do: "buyAllUpgrades" }, "full");
      buyTab(p, "meat", 0.5);
      buyTab(p, "territory", 0.5);
      p.push({ do: "ascendInfo" }, "full");
      p.push({ do: "tick", at: at(DAY, base) }, "full");
      p.push({ do: "save" });
    });
    list.push({
      name: "midgame-save",
      description:
        "Import the mid-game save from swarmsim-ts/src/persist.test.json at its save time, snapshot, tick +1h, buy all upgrades, buy units, tick +1d, save/export.",
      start,
      steps,
    });
  }

  // 6. abilities, ascension, respec
  {
    const start = { now: MIDGAME_SAVED_AT, save: SAVE_MIDGAME };
    const base = Date.parse(MIDGAME_SAVED_AT);
    const t = (s: number) => at(s, base);
    const abilities = ["larvarush", "meatrush", "territoryrush", "clonelarvae", "swarmwarp"];
    const steps: Step[] = [
      { action: { do: "tick", at: t(10) } },
      { action: { do: "setUnitCount", unit: "nexus", val: 5 } },
      { action: { do: "setUnitCount", unit: "energy", val: 50000 } },
      { action: { do: "tick", at: t(20) }, snapshot: "full" },
    ];
    for (const a of abilities) {
      steps.push({ action: { do: "effects", upgrade: a } });
      steps.push({ action: { do: "buyUpgrade", upgrade: a, num: 1 }, snapshot: "full" });
      steps.push({ action: { do: "effects", upgrade: a } });
    }
    steps.push({ action: { do: "tick", at: t(30) } });
    steps.push({ action: { do: "buyUpgrade", upgrade: "swarmwarp", num: 3 }, snapshot: "counts" });
    steps.push({ action: { do: "tick", at: t(40) }, snapshot: "counts" });
    list.push({
      name: "abilities",
      description:
        "Mid-game save with energy 50000/nexus 5 (cheat), then cast larvarush, meatrush, territoryrush, clonelarvae, swarmwarp (effect outputs before/after, full snapshots), then 3 swarmwarps at once.",
      start,
      steps,
    });

    const steps2: Step[] = [
      { action: { do: "tick", at: t(10) } },
      { action: { do: "ascendInfo" } },
      { action: { do: "ascend" } }, // can't afford: error
      { action: { do: "setUnitCount", unit: "nexus", val: "1e100" } },
      { action: { do: "setUnitCount", unit: "energy", val: "1e100" } },
      { action: { do: "setUnitCount", unit: "premutagen", val: 123456 } },
      { action: { do: "buyUpgrade", upgrade: "swarmwarp", num: 30 } },
      { action: { do: "tick", at: t(20) }, snapshot: "full" },
      { action: { do: "ascend" }, snapshot: "full" },
      { action: { do: "tick", at: t(60) }, snapshot: "counts" },
      { action: { do: "buyUpgrade", upgrade: "mutatehatchery", num: 1 } },
      { action: { do: "buyUpgrade", upgrade: "mutatebat", num: 1 } },
      { action: { do: "buyUpgrade", upgrade: "mutateclone", num: 1 } },
      { action: { do: "buyMaxUnit", unit: "mutanthatchery", percent: 0.25 } },
      { action: { do: "buyMaxUnit", unit: "mutantbat", percent: 0.25 } },
      { action: { do: "buyUnit", unit: "mutantclone", num: 100 } },
      { action: { do: "tick", at: t(70) }, snapshot: "full" },
      // ascension reset nexus/energy
      { action: { do: "setUnitCount", unit: "nexus", val: "1e100" } },
      { action: { do: "setUnitCount", unit: "energy", val: "1e100" } },
      { action: { do: "buyUpgrade", upgrade: "swarmwarp", num: 10 } },
      { action: { do: "ascendInfo" } },
      { action: { do: "respec" }, snapshot: "full" },
      { action: { do: "buyUpgrade", upgrade: "mutatehatchery", num: 1 } },
      { action: { do: "buyMaxUnit", unit: "mutanthatchery", percent: 0.5 } },
      { action: { do: "tick", at: t(80) }, snapshot: "counts" },
      { action: { do: "respecFree" }, snapshot: "full" },
      { action: { do: "setUnitCount", unit: "freeRespec", val: 0 } },
      { action: { do: "respecFree" } }, // none left: error
      { action: { do: "setUnitCount", unit: "energy", val: 0 } },
      { action: { do: "respec" } }, // can't afford: error
      { action: { do: "tick", at: t(90) }, snapshot: "full" },
    ];
    list.push({
      name: "ascend-respec",
      description:
        "Mid-game save: failed ascend, cheat energy/nexus/premutagen, swarmwarps (energy spent lowers ascend cost), ascend, buy mutagen upgrades + mutant units, respec (energy), respecFree, failure cases.",
      start,
      steps: steps2,
    });
  }

  // 6b. seeded random premutagen spawns (addUnitRand) and timed crystal (addUnitTimed)
  {
    const start = { now: MIDGAME_SAVED_AT, save: SAVE_MIDGAME };
    const base = Date.parse(MIDGAME_SAVED_AT);
    const t = (s: number) => at(s, base);
    const steps: Step[] = [
      { action: { do: "tick", at: t(10) } },
      { action: { do: "setUnitCount", unit: "meat", val: "1e300" } },
      { action: { do: "setUnitCount", unit: "territory", val: "1e300" } },
      { action: { do: "effects", upgrade: "hatchery" } },
      { action: { do: "effects", upgrade: "expansion" } },
    ];
    for (let i = 0; i < 6; i++) {
      steps.push({ action: { do: "buyUpgrade", upgrade: "hatchery", num: 7 }, snapshot: "counts" });
      steps.push({ action: { do: "buyUpgrade", upgrade: "expansion", num: 13 }, snapshot: "counts" });
      steps.push({ action: { do: "effects", upgrade: "expansion" } });
      steps.push({ action: { do: "tick", at: t(10 + 3600 * (i + 1)) } });
    }
    steps.push({ action: { do: "buyMaxUpgrade", upgrade: "hatchery", percent: 1 }, snapshot: "full" });
    list.push({
      name: "random-spawns",
      description:
        "Mid-game save with 1e300 meat/territory: buy hatcheries/expansions in batches across hours. Exercises addUnitRand (seeded premutagen spawns: seed = date.restarted + upgrade name + level) and addUnitTimed (crystal every N hours).",
      start,
      steps,
    });
  }

  // 7. save import/export round trips
  {
    const base = { now: T0 };
    list.push({
      name: "saves",
      description:
        "importSave/exportSave round trips: right after import, exportSave returns the imported string verbatim; save() re-encodes with the clock's date. Also an old 1.0.0 save, and re-importing our own export.",
      start: base,
      steps: [
        { action: { do: "exportSave" } },
        { action: { do: "save" } },
        { action: { do: "tick", at: "2022-12-13T21:00:00.000Z" } },
        { action: { do: "importSave", save: SAVE_FRESH }, snapshot: "counts" },
        { action: { do: "exportSave" } },
        { action: { do: "save" } },
        { action: { do: "tick", at: "2022-12-14T00:00:00.000Z" } },
        { action: { do: "importSave", save: SAVE_MIDGAME }, snapshot: "full" },
        { action: { do: "exportSave" } },
        { action: { do: "tick", at: "2022-12-14T00:10:00.000Z" } },
        { action: { do: "save" } },
        { action: { do: "buyUnit", unit: "drone", num: 1 } },
        { action: { do: "exportSave" } },
        { action: { do: "tick", at: "2022-12-14T01:00:00.000Z" } },
        { action: { do: "importSave", save: SAVE_V1 }, snapshot: "full" },
        { action: { do: "save" } },
      ],
    });
  }

  // 8. parseNumber
  {
    const inputs = [
      "1", "0", "-5", "1.5", "1.9", "12345678901234567890", "1,000", "1,000,000", "1e3", "1E3", "1.5e3",
      "1e999", "1e100001", "1k", "1K", "2.5k", "1 k", "1m", "1 million", "1 Million", "1 billion", "1b",
      "1qa", "1 quadrillion", "1 thousand", "3 decillion", "1 foo", "abc", "", " ", "=1", "=7", "=12.5", "@100",
      "@1", "@1e6", "10%", "50%", "100%", "150%", "0%", "-10%", "abc%", "Infinity", "NaN", "0x10",
    ];
    const steps: Step[] = [
      { action: { do: "setUnitCount", unit: "meat", val: "123456789" } },
      { action: { do: "setUnitCount", unit: "larva", val: "100000" } },
      { action: { do: "setUnitCount", unit: "drone", val: "42" } },
    ];
    for (const input of inputs) steps.push({ action: { do: "parseNumber", input, unit: "drone" } });
    steps.push({ action: { do: "setUpgradeCount", upgrade: "dronetwin", val: 3 } });
    for (const input of ["1", "=1", "=7", "=12.5", "@100", "@43", "50%", "7.9"]) {
      steps.push({ action: { do: "parseNumber", input, unit: "drone" } });
    }
    list.push({
      name: "parsenumber",
      description: "parseNumber(input, drone) for many inputs; null == undefined (parse error). Then again with dronetwin=3 (twinMult 8).",
      start: { now: T0 },
      steps,
    });
  }

  return list;
}
