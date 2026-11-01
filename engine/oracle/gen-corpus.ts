// Writes the dual-engine harness corpus (rust/harness/corpus/*.json) and the
// TS engine's expected output for each scenario (rust/harness/expected/*.json,
// exactly what `oracle/run.ts <scenario>` prints), plus rust/harness/manifest.json
// (hashes; test/harness-corpus.test.ts checks it). See rust/harness/README.md.
//
//   pnpm --filter @swarmsim/engine oracle:corpus
//
// Scenarios:
//   - fixture-*: every fixture save (test/fixtures/session-saves.json,
//     swarmsim-ts/src/persist.test.json, SAVE_V1), started with an importSave step;
//   - progress-* / ascension-*: saves at increasing progress, produced by the
//     deterministic auto-player (Planner, buyTab) on the TS engine from a fresh
//     game: t = 1 min .. 30 days, then 5 ascensions; loaded through start.save.
// Each runs STEPS steps chosen by a seeded random auto-player (ticks of 0.1 s
// to 3 days, unit/upgrade buys, buy-alls, abilities incl. swarmwarp, ascend,
// respec, undo, queries). Snapshots: see snapshotKind().
//
// Everything is deterministic: fixed clocks, seedrandom seeded by scenario name,
// and the planner drives the TS engine exactly like the replay does.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import seedrandom from "seedrandom";
import { createTsEngine } from "../test/tsengine";
import { goldenJson } from "./generate";
import { runScenarioJson } from "./run";
import { Action, Scenario, ScenarioEngine, SnapshotKind, snapshotFull, Step } from "./scenario";
import { at, buyTab, Planner, SAVE_V1, T0 } from "./scenarios";

export const HARNESS_DIR = path.resolve(__dirname, "../../rust/harness");
export const CORPUS_DIR = path.join(HARNESS_DIR, "corpus");
export const EXPECTED_DIR = path.join(HARNESS_DIR, "expected");
export const MANIFEST = path.join(HARNESS_DIR, "manifest.json");

/** steps per scenario (the importSave of fixture scenarios included) */
export const STEPS = 200;
/** snapshot cadence, see snapshotKind() */
const FULL_EVERY = 100;
const COUNTS_EVERY = 20;

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ENGINE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ENGINE_ROOT, "..");

/**
 * Files whose content determines the corpus and the expected outputs (repo-relative;
 * directories are hashed recursively). Any change here makes the staleness test fail.
 */
export const INPUTS = [
  "engine/oracle/gen-corpus.ts",
  "engine/oracle/scenario.ts",
  "engine/oracle/scenarios.ts",
  "engine/oracle/generate.ts",
  "engine/oracle/run.ts",
  "engine/test/tsengine.ts",
  "engine/test/fixtures/session-saves.json",
  "swarmsim-ts/src/persist.test.json",
  "engine/src",
  "tables/src/spreadsheet/static.ts",
  "tables/src/spreadsheet/compact.ts",
];

// ---- start saves ----

export interface Start {
  name: string;
  description: string;
  start: Scenario["start"];
  /** fixture saves: imported by the first step instead of start.save */
  importSave?: string;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/** the save's last reified date (when it was last played), by importing it into a throwaway TS engine */
function reifiedDate(save: string): number | undefined {
  try {
    const e = createTsEngine({ now: "2030-01-01T00:00:00.000Z" });
    e.game.importSave(save, true);
    return e.session.state.date.reified.getTime();
  } catch (e) {
    return undefined;
  }
}

export function fixtureStarts(): Start[] {
  const session = JSON.parse(fs.readFileSync(path.join(ENGINE_ROOT, "test/fixtures/session-saves.json"), "utf8"));
  const persist = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "swarmsim-ts/src/persist.test.json"), "utf8"));
  const saves: [string, string, string][] = [];
  for (const k of Object.keys(session)) {
    saves.push([`session-${k}`, `engine/test/fixtures/session-saves.json "${k}"`, session[k]]);
  }
  persist.exports.forEach((x: any, i: number) => {
    saves.push([`persist-export${i}`, `swarmsim-ts/src/persist.test.json exports[${i}] (${x.version})`, x.export_]);
  });
  persist.format.forEach((x: any, i: number) => {
    saves.push([`persist-format${i}`, `swarmsim-ts/src/persist.test.json format[${i}] (body ${x.body})`, x.export_]);
  });
  if (!saves.some(([, , s]) => s === SAVE_V1)) saves.push(["save-v1", "oracle/scenarios.ts SAVE_V1", SAVE_V1]);
  return saves.map(([key, from, save]) => {
    const reified = reifiedDate(save);
    // one hour of offline progress after the save's last play; unreadable saves start at T0
    const now = reified === undefined ? T0 : iso(reified + HOUR);
    return {
      name: `fixture-${key}`,
      description: `importSave of ${from} at ${reified === undefined ? "T0 (does not import)" : "its last reified date + 1h"}, then the random auto-player.`,
      start: { now },
      importSave: save,
    };
  });
}

/** offline gaps between a progress save and its load, cycled */
const LOAD_GAPS = [0, 10, HOUR, 8 * HOUR, 2 * DAY];

function mutagenUpgrades(g: any): any[] {
  return g.upgradelist().filter((up: any) => up.unit.tab?.name === "mutagen");
}

/** one auto-player round, like oracle/scenarios.ts autoRound plus energy/mutagen tabs (no snapshots) */
function progressRound(p: Planner, t: string) {
  p.push({ do: "tick", at: t });
  p.push({ do: "buyAllUpgrades" });
  for (const up of mutagenUpgrades(p.game)) {
    if (up.isVisible() && up.isBuyable() && up.count().isZero()) p.push({ do: "buyUpgrade", upgrade: up.name, num: 1 });
  }
  for (const tab of ["mutagen", "energy", "territory", "meat"]) buyTab(p, tab, 0.5);
}

/**
 * Saves at increasing progress: one long auto-player run from a fresh game at T0,
 * saving at checkpoints; then 5 ascensions (each as soon as affordable, but at
 * least 2 days after the last), saving after each ascension and on the way.
 */
export function progressStarts(): Start[] {
  const p = new Planner(createTsEngine({ now: T0 }));
  const T0_MS = Date.parse(T0);
  const starts: Start[] = [];
  let secs = 0;
  const save = (name: string, description: string) => {
    const r = p.push({ do: "save" });
    const gap = LOAD_GAPS[starts.length % LOAD_GAPS.length];
    starts.push({
      name,
      description: `${description}; loaded (start.save) ${gap}s after it was saved, then the random auto-player.`,
      start: { now: iso(T0_MS + (secs + gap) * 1000), save: r.result as string },
    });
  };
  const playUntil = (until: number) => {
    // rounds every ~10% of elapsed time, at least 30 s, at most 6 h apart
    while (secs < until) {
      secs = Math.min(until, secs + Math.min(6 * HOUR, Math.max(30, Math.round(secs * 0.1))));
      progressRound(p, at(secs));
    }
  };
  const label = (s: number) => (s < HOUR ? `${s / MIN}m` : s < DAY ? `${+(s / HOUR).toFixed(1)}h` : `${+(s / DAY).toFixed(1)}d`);

  const checkpoints = [
    MIN, 2 * MIN, 5 * MIN, 10 * MIN, 20 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 5 * HOUR, 8 * HOUR, 12 * HOUR, 18 * HOUR,
    DAY, 1.5 * DAY, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 7 * DAY, 9 * DAY, 11 * DAY, 14 * DAY, 17 * DAY, 20 * DAY, 24 * DAY, 30 * DAY,
  ];
  checkpoints.forEach((cp, i) => {
    playUntil(cp);
    save(`progress-${String(i + 1).padStart(2, "0")}-${label(cp)}`, `Auto-player (buyAllUpgrades + buyMaxUnit 50% per tab) from a fresh game, saved at t=${label(cp)}`);
  });

  const g = p.game;
  for (let n = 1; n <= 5; n++) {
    const from = secs;
    // play until ascension is affordable (2 days minimum, 60 days maximum, checking every 6 h)
    playUntil(from + 2 * DAY);
    while (g.ascendCostPercent().lessThan(1) && secs < from + 60 * DAY) playUntil(secs + 6 * HOUR);
    if (n > 1) save(`ascension-${n - 1}-before-next`, `Auto-player after ${n - 1} ascension(s), at t=${label(secs)}, ascension ${n} affordable: ${g.ascendCostPercent().gte(1)}`);
    const r = p.push({ do: "ascend" });
    if (r.error) throw new Error(`progress run: ascension ${n} failed at t=${label(secs)}: ${r.error}`);
    save(`ascension-${n}-0-just-ascended`, `Auto-player, ascension ${n} at t=${label(secs)}, saved right after ascending`);
    // spend the mutagen and play on
    for (const [dt, what] of [[MIN, "1m"], [HOUR, "1h"], [DAY, "1d"]] as [number, string][]) {
      playUntil(secs + dt);
      save(`ascension-${n}-${what}`, `Auto-player, ${what} after ascension ${n} (t=${label(secs)})`);
    }
  }
  return starts;
}

// ---- random auto-player ----

const ABILITIES = ["larvarush", "meatrush", "territoryrush", "clonelarvae", "swarmwarp"];
const TICK_MIN = 0.1;
const TICK_MAX = 3 * DAY;

type Rng = () => number;

function pick<T>(rng: Rng, xs: T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

function weighted<T>(rng: Rng, xs: [number, T][]): T {
  const total = xs.reduce((s, [w]) => s + w, 0);
  let r = rng() * total;
  for (const [w, x] of xs) {
    if ((r -= w) < 0) return x;
  }
  return xs[xs.length - 1][1];
}

/**
 * Snapshot kind of step i: full after every FULL_EVERY-th step (the last one
 * included) and after an ascend/respec that will succeed; counts after every
 * COUNTS_EVERY-th; none otherwise. (A full snapshot is ~45 KB; one after every
 * step would make the corpus ~0.5 GB. respecFree succeeds whenever a free respec
 * is left, i.e. often, so it gets no extra full snapshot.)
 */
function snapshotKind(i: number, g: any, action: Action): SnapshotKind | undefined {
  if (i === STEPS - 1 || i % FULL_EVERY === FULL_EVERY - 1) return "full";
  if (action.do === "ascend" && g.ascendCostPercent().gte(1)) return "full";
  if (action.do === "respec" && g.isRespecCostMet()) return "full";
  if (i % COUNTS_EVERY === COUNTS_EVERY - 1) return "counts";
  return undefined;
}

/** STEPS steps of a seeded random auto-player, planned on a live TS engine */
export function planSteps(s: Start): Step[] {
  const o: ScenarioEngine = createTsEngine(s.start);
  const p = new Planner(o);
  snapshotFull(o); // runScenario takes an initial snapshot too
  const rng: Rng = seedrandom(`swarm-harness:${s.name}`);
  const g = p.game;
  let now = Date.parse(s.start.now);
  let warps = 0;
  const push = (a: Action) => {
    if (a.do === "buyUpgrade" && a.upgrade === "swarmwarp") warps++;
    if (a.do === "tick") now = Date.parse(a.at);
    p.push(a, snapshotKind(p.steps.length, g, a));
  };
  const full = () => p.steps.length >= STEPS;
  const visibleUnits = (): any[] => g.unitlist().filter((u: any) => u.isVisible());
  const visibleUpgrades = (): any[] => g.upgradelist().filter((u: any) => u.isVisible());
  const percent = () => pick(rng, [0.25, 0.5, 1]);

  if (s.importSave !== undefined) push({ do: "importSave", save: s.importSave });
  while (!full()) {
    // make sure swarmwarp appears (twice) even when the dice don't ask for it
    const forceWarp = (p.steps.length === STEPS / 2 && warps === 0) || (p.steps.length === STEPS - 2 && warps < 2);
    const kind = forceWarp
      ? "ability"
      : weighted(rng, [
          [34, "tick"],
          [14, "buyTab"],
          [9, "buyAllUpgrades"],
          [7, "buyUnit"],
          [4, "buyMaxUnit"],
          [5, "buyUpgrade"],
          [3, "buyMaxUpgrade"],
          [9, "ability"],
          [g.ascendCostPercent().gte(1) ? 8 : 1, "ascend"],
          [2, "respec"],
          [1, "respecFree"],
          [3, "undo"],
          [6, "query"],
        ] as [number, string][]);
    switch (kind) {
      case "tick": {
        const secs = TICK_MIN * Math.pow(TICK_MAX / TICK_MIN, rng());
        now += Math.max(1, Math.round(secs * 1000));
        push({ do: "tick", at: iso(now) });
        break;
      }
      case "buyTab": {
        // like oracle/scenarios.ts buyTab, within the step budget and with snapshots
        const tab = g.tabs.byName[pick<string>(rng, g.tabs.list.map((t: any) => t.name))];
        const pct = percent();
        const before = p.steps.length;
        for (const u of [...tab.units].reverse()) {
          if (full()) break;
          if (u.unittype.unbuyable || !u.isVisible() || !u.isBuyable()) continue;
          if (u.maxCostMet(pct).greaterThan(0)) push({ do: "buyMaxUnit", unit: u.name, percent: pct });
        }
        if (p.steps.length === before) push({ do: "buyAllUpgrades", percent: pct });
        break;
      }
      case "buyAllUpgrades":
        push(rng() < 0.5 ? { do: "buyAllUpgrades" } : { do: "buyAllUpgrades", percent: percent() });
        break;
      case "buyUnit": {
        const u = pick(rng, visibleUnits());
        const num = pick(rng, [1, 3, 10, 1000, "1e30", u.maxCostMet().toString()]);
        push({ do: "buyUnit", unit: u.name, num });
        break;
      }
      case "buyMaxUnit":
        push({ do: "buyMaxUnit", unit: pick(rng, visibleUnits()).name, percent: percent() });
        break;
      case "buyUpgrade": {
        const ups = visibleUpgrades();
        if (ups.length) push({ do: "buyUpgrade", upgrade: pick(rng, ups).name, num: pick(rng, [1, 1, 2, 5]) });
        break;
      }
      case "buyMaxUpgrade": {
        const ups = visibleUpgrades();
        if (ups.length) push({ do: "buyMaxUpgrade", upgrade: pick(rng, ups).name, percent: percent() });
        break;
      }
      case "ability": {
        const name = forceWarp || rng() < 0.4 ? "swarmwarp" : pick(rng, ABILITIES);
        push({ do: "buyUpgrade", upgrade: name, num: rng() < 0.8 ? 1 : 2 });
        break;
      }
      case "ascend":
      case "respec":
      case "respecFree":
      case "undo":
        push({ do: kind });
        break;
      case "query": {
        const u = pick(rng, visibleUnits());
        const ups = visibleUpgrades();
        const q: Action = weighted(rng, [
          [3, { do: "estimateUnit", unit: u.name, target: u.count().times(2).plus(1).toString() }],
          [2, ups.length ? { do: "estimateUpgrade", upgrade: pick(rng, ups).name } : { do: "ascendInfo" }],
          [2, { do: "ascendInfo" }],
          [2, { do: "countInSecs", unit: u.name, secs: pick(rng, [1, 60, 3600, 86400]) }],
          [2, ups.length ? { do: "effects", upgrade: pick(rng, ups).name } : { do: "effects", unit: u.name }],
          [1, { do: "parseNumber", input: pick(rng, ["1", "1.5k", "50%", "=10", "@100", "1e3"]), unit: u.name }],
          [1, { do: "save" }],
        ] as [number, Action][]);
        push(q);
        break;
      }
    }
  }
  return p.steps;
}

// ---- corpus ----

export function corpusStarts(): Start[] {
  return [...fixtureStarts(), ...progressStarts()];
}

export function scenarioFor(s: Start, steps: Step[] = planSteps(s)): Scenario {
  return { name: s.name, description: s.description, start: s.start, steps };
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function listFiles(rel: string): string[] {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((f) => listFiles(path.posix.join(rel, f)));
}

/** sha256 over INPUTS (path + content of every file, sorted) */
export function inputsHash(): string {
  const h = crypto.createHash("sha256");
  for (const rel of INPUTS.flatMap(listFiles)) {
    h.update(rel + "\0");
    h.update(fs.readFileSync(path.join(REPO_ROOT, rel)));
    h.update("\0");
  }
  return h.digest("hex");
}

export interface Manifest {
  generator: string;
  inputsHash: string;
  inputs: string[];
  /** harness-relative path -> sha256 */
  files: { [path: string]: string };
}

function main() {
  const t0 = Date.now();
  const starts = corpusStarts();
  console.log(`${starts.length} start saves, ${Date.now() - t0}ms`);
  for (const dir of [CORPUS_DIR, EXPECTED_DIR]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  const files: Manifest["files"] = {};
  let total = 0;
  for (const s of starts) {
    const t = Date.now();
    const scenario = goldenJson(scenarioFor(s));
    // expected: exactly what run.ts prints for the file just written
    const expected = runScenarioJson(JSON.parse(scenario), "ts");
    for (const [dir, text] of [
      ["corpus", scenario],
      ["expected", expected],
    ]) {
      fs.writeFileSync(path.join(HARNESS_DIR, dir, `${s.name}.json`), text);
      files[`${dir}/${s.name}.json`] = sha256(text);
      total += text.length;
    }
    console.log(`${s.name}: ${(expected.length / 1024).toFixed(0)} KiB, ${Date.now() - t}ms`);
  }
  const manifest: Manifest = {
    generator: "pnpm --filter @swarmsim/engine oracle:corpus",
    inputsHash: inputsHash(),
    inputs: INPUTS,
    files,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");
  console.log(`${starts.length} scenarios, ${(total / 1024 / 1024).toFixed(1)} MiB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (require.main === module) main();
