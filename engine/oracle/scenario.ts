// Scenario interpreter + snapshotting, shared by the oracle (old CoffeeScript
// engine) and the TS engine's golden tests.
//
// A scenario is a list of plain-JSON actions. `runScenario` replays them
// against a fresh engine instance (by default the old engine, via the oracle)
// and records, for each step, the action, its result (or error) and an
// optional snapshot. The interpreter only talks to a ScenarioEngine, so both
// engines are driven and serialized identically.
//
// Serialization: Decimal -> string (full precision, Decimal#toString()),
// finite JS number -> number, non-finite number -> {"$number": "Infinity"},
// Date -> ISO string, undefined -> omitted / null.
import { createOracle, OLD_VERSION, OracleOptions } from "./oracle";

/** What the interpreter needs from an engine instance (old or new). */
export interface ScenarioEngine {
  game: any;
  session: any;
  commands: any;
  /** Decimal constructor used to build action arguments */
  Decimal: any;
  /** serialize as a Decimal (string)? */
  isDecimal(v: unknown): boolean;
  parseNumber(value: unknown, unit?: any): any;
  /** set the clock to `date` and game.tick() there */
  tick(date: string): void;
  /** backfill.run(game) */
  runBackfill(): void;
  /** every 'command' event emitted, as plain copies (without unit/upgrade object refs), taken before other listeners run */
  commandLog: { [k: string]: unknown }[];
  /** exceptions thrown (and swallowed) by event listeners */
  listenerErrors: { event: string; error: unknown }[];
}
type Oracle = ScenarioEngine;

export type Num = string | number;

export type SnapshotKind = "none" | "counts" | "full";

export type Action =
  /** set the clock to `at` and game.tick() there */
  | { do: "tick"; at: string }
  | { do: "buyUnit"; unit: string; num: Num }
  | { do: "buyMaxUnit"; unit: string; percent: number }
  | { do: "buyUpgrade"; upgrade: string; num: Num }
  | { do: "buyMaxUpgrade"; upgrade: string; percent: number }
  /** like the "buy all upgrades" button: commands.buyAllUpgrades(game.availableAutobuyUpgrades(percent)) */
  | { do: "buyAllUpgrades"; percent?: number }
  | { do: "ascend" }
  | { do: "respec" }
  | { do: "respecFree" }
  | { do: "undo" }
  /** test setup cheat: game.withSave(() => unit._setCount(val)) */
  | { do: "setUnitCount"; unit: string; val: Num }
  /** test setup cheat: game.withSave(() => upgrade._setCount(val)) */
  | { do: "setUpgradeCount"; upgrade: string; val: Num }
  /** game.importSave(save, transient) then backfill.run(game), like the options screen */
  | { do: "importSave"; save: string; transient?: boolean }
  /** result: session.exportSave() */
  | { do: "exportSave" }
  /** game.save(), result: session.exportSave() */
  | { do: "save" }
  /** result: unit.estimateSecsUntilEarned(target) */
  | { do: "estimateUnit"; unit: string; target: Num }
  /** result: upgrade.estimateSecsUntilBuyable() as {val, unit} */
  | { do: "estimateUpgrade"; upgrade: string }
  /** result: ascension/respec cost info */
  | { do: "ascendInfo" }
  /** result: each effect's output for an upgrade (or unit) */
  | { do: "effects"; upgrade?: string; unit?: string }
  /** result: parseNumber(input, unit) */
  | { do: "parseNumber"; input: string; unit?: string }
  /** result: unit.count() in `secs` seconds from now (no state change) */
  | { do: "countInSecs"; unit: string; secs: Num };

export interface Step {
  action: Action;
  snapshot?: SnapshotKind;
}

export interface Scenario {
  name: string;
  description: string;
  /** createOracle options */
  start: { now: string; save?: string };
  /**
   * Steps replayed (with their snapshots taken, then discarded) before
   * recording starts. Used to split one long run across several files.
   */
  prefixSteps?: Step[];
  steps: Step[];
}

export interface StepResult {
  action: Action;
  /** ISO time of game.now after the action */
  now: string;
  result?: unknown;
  /** thrown error message, if any (state changes before the throw are kept, as in the old game) */
  error?: string;
  /** 'command' events emitted during this step (commands.coffee params, minus object refs) */
  commands?: unknown[];
  snapshot?: unknown;
}

export interface ScenarioResult {
  name: string;
  description: string;
  oldEngineVersion: string;
  start: Scenario["start"];
  prefixSteps?: Step[];
  /** full snapshot before the first recorded step (after prefixSteps, if any) */
  initial: unknown;
  steps: StepResult[];
}

// ----- serialization -----

export function ser(o: Oracle, v: unknown, depth = 0): unknown {
  if (depth > 20) throw new Error("ser: too deep");
  if (v === undefined || v === null) return null;
  if (o.isDecimal(v)) return (v as { toString(): string }).toString();
  if (typeof v === "number") return Number.isFinite(v) ? v : { $number: String(v) };
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => ser(o, x, depth + 1));
  if (typeof v === "object") {
    const ret: { [k: string]: unknown } = {};
    for (const k of Object.keys(v as object)) {
      const x = (v as { [k: string]: unknown })[k];
      if (x !== undefined && typeof x !== "function") ret[k] = ser(o, x, depth + 1);
    }
    return ret;
  }
  throw new Error(`ser: unsupported ${typeof v}`);
}

function attempt<T>(fn: () => T): T | { error: string } {
  try {
    return fn();
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function costList(o: Oracle, costs: any[]) {
  return costs.map((c: any) => ({ unit: c.unit.name, val: ser(o, c.val), ...(c.factor ? { factor: ser(o, c.factor) } : {}) }));
}

// ----- snapshots -----
//
// IMPORTANT for replays: snapshot queries go through the old engine's caches,
// and some of those caches are sticky (unit/upgrade visibility is cached once
// true until respec/ascend/import). Snapshots always query, in this order:
// every unit (unitlist order), then every upgrade (upgradelist order), then
// achievements. The TS replay should snapshot the same way.

export function snapshotCounts(o: Oracle) {
  const units: { [name: string]: unknown } = {};
  for (const u of o.game.unitlist()) {
    units[u.name] = { count: ser(o, u.count()), velocity: ser(o, u.velocity()) };
  }
  return { units };
}

export function snapshotUnit(o: Oracle, u: any) {
  const visible = u.isVisible();
  const ret: { [k: string]: unknown } = {
    count: ser(o, u.count()),
    velocity: ser(o, u.velocity()),
    isVisible: visible,
  };
  if (visible) {
    Object.assign(ret, {
      eachCost: costList(o, u.eachCost()),
      maxCostMet: ser(o, attempt(() => u.maxCostMet())),
      maxCostMet25: ser(o, attempt(() => u.maxCostMet(0.25))),
      isCostMet: ser(o, attempt(() => u.isCostMet())),
      isBuyButtonVisible: u.isBuyButtonVisible(),
      isBuyable: ser(o, attempt(() => u.isBuyable())),
      twinMult: ser(o, u.twinMult()),
      capValue: ser(o, u.capValue()),
      eachProduction: ser(o, u.eachProduction()),
      totalProduction: ser(o, u.totalProduction()),
      stats: ser(o, u.stats()),
      suffix: u.suffix,
    });
  }
  return ret;
}

export function snapshotUpgrade(o: Oracle, up: any) {
  const visible = up.isVisible();
  const ret: { [k: string]: unknown } = {
    count: ser(o, up.count()),
    isVisible: visible,
    totalCost: costList(o, up.totalCost()),
    isUpgradable: ser(o, attempt(() => up.isUpgradable())),
  };
  if (visible) {
    Object.assign(ret, {
      maxCostMet: ser(o, attempt(() => up.maxCostMet())),
      isCostMet: ser(o, attempt(() => up.isCostMet())),
      isBuyable: ser(o, attempt(() => up.isBuyable())),
      isAutobuyable: up.isAutobuyable(),
      isNewlyUpgradable: ser(o, attempt(() => up.isNewlyUpgradable())),
      costMetPercent: ser(o, attempt(() => up.costMetPercent())),
      estimateSecsUntilBuyable: ser(o, attempt(() => estimateUpgrade(up))),
    });
  }
  return ret;
}

function estimateUpgrade(up: any) {
  const est = up.estimateSecsUntilBuyable();
  return { val: est.val, unit: est.unit ? est.unit.name : null, cacheSafe: est.cacheSafe };
}

export function snapshotAchievements(o: Oracle) {
  const earned: { [name: string]: unknown } = {};
  for (const a of o.game.achievementlist()) {
    if (a.isEarned()) earned[a.name] = a.earnedAtMillisElapsed();
  }
  return { earned: ser(o, earned), points: o.game.achievementPoints() };
}

export function snapshotFull(o: Oracle) {
  const units: { [name: string]: unknown } = {};
  for (const u of o.game.unitlist()) units[u.name] = snapshotUnit(o, u);
  const upgrades: { [name: string]: unknown } = {};
  for (const up of o.game.upgradelist()) upgrades[up.name] = snapshotUpgrade(o, up);
  return {
    units,
    upgrades,
    achievements: snapshotAchievements(o),
    ascendInfo: ascendInfo(o),
    // the raw session state (counts at last reify, dates, statistics, ...)
    state: JSON.parse(o.session.exportJson()),
  };
}

export function snapshot(o: Oracle, kind: SnapshotKind | undefined) {
  switch (kind) {
    case "counts":
      return snapshotCounts(o);
    case "full":
      return snapshotFull(o);
    default:
      return undefined;
  }
}

function ascendInfo(o: Oracle) {
  const g = o.game;
  return ser(o, {
    ascendEnergySpent: attempt(() => g.ascendEnergySpent()),
    ascendCost: attempt(() => g.ascendCost()),
    ascendCostPercent: attempt(() => g.ascendCostPercent()),
    ascendCostDurationSecs: attempt(() => g.ascendCostDurationSecs()),
    respecCost: attempt(() => g.respecCost()),
    respecCostPercent: attempt(() => g.respecCostPercent()),
    isRespecCostMet: attempt(() => g.isRespecCostMet()),
    respecSpent: attempt(() => g.respecSpent()),
  });
}

// ----- interpreter -----

function unit(o: Oracle, name: string) {
  const u = o.game.unit(name);
  if (!u) throw new Error(`oracle: no such unit ${name}`);
  return u;
}
function upgrade(o: Oracle, name: string) {
  const u = o.game.upgrade(name);
  if (!u) throw new Error(`oracle: no such upgrade ${name}`);
  return u;
}

export function applyAction(o: Oracle, a: Action): unknown {
  const g = o.game;
  const D = o.Decimal;
  switch (a.do) {
    case "tick":
      o.tick(a.at);
      return undefined;
    case "buyUnit":
      o.commands.buyUnit({ unit: unit(o, a.unit), num: new D(a.num) });
      return undefined;
    case "buyMaxUnit":
      o.commands.buyMaxUnit({ unit: unit(o, a.unit), percent: a.percent });
      return undefined;
    case "buyUpgrade":
      o.commands.buyUpgrade({ upgrade: upgrade(o, a.upgrade), num: new D(a.num) });
      return undefined;
    case "buyMaxUpgrade":
      o.commands.buyMaxUpgrade({ upgrade: upgrade(o, a.upgrade), percent: a.percent });
      return undefined;
    case "buyAllUpgrades": {
      const ups = a.percent == null ? g.availableAutobuyUpgrades() : g.availableAutobuyUpgrades(a.percent);
      // the tabs directive skips empty lists ("don't buy zero upgrades, it would invalidate undo")
      if (ups.length > 0) o.commands.buyAllUpgrades({ upgrades: ups, percent: a.percent ?? 1 });
      return { upgrades: ups.map((u: any) => u.name) };
    }
    case "ascend":
      o.commands.ascend({ game: g });
      return undefined;
    case "respec":
      o.commands.respec({ game: g });
      return undefined;
    case "respecFree":
      o.commands.respecFree({ game: g });
      return undefined;
    case "undo":
      o.commands.undo();
      return undefined;
    case "setUnitCount":
      g.withSave(() => unit(o, a.unit)._setCount(a.val));
      return undefined;
    case "setUpgradeCount":
      g.withSave(() => upgrade(o, a.upgrade)._setCount(a.val));
      return undefined;
    case "importSave":
      g.importSave(a.save, a.transient ?? true);
      o.runBackfill();
      return undefined;
    case "exportSave":
      return o.session.exportSave();
    case "save":
      g.save();
      return o.session.exportSave();
    case "estimateUnit":
      return unit(o, a.unit).estimateSecsUntilEarned(a.target);
    case "estimateUpgrade":
      return estimateUpgrade(upgrade(o, a.upgrade));
    case "ascendInfo":
      return ascendInfo(o);
    case "effects": {
      const parent = a.upgrade ? upgrade(o, a.upgrade) : unit(o, a.unit!);
      return parent.effect.map((e: any) => ({
        type: e.type.name,
        unit: e.unit?.name ?? null,
        upgrade: e.upgrade?.name ?? null,
        stat: e.stat ?? null,
        power: attempt(() => e.power()),
        output: attempt(() => e.output()),
        outputNext: attempt(() => e.outputNext()),
        bank: attempt(() => e.bank()),
        cap: attempt(() => e.cap()),
      }));
    }
    case "parseNumber":
      return o.parseNumber(a.input, a.unit ? unit(o, a.unit) : undefined);
    case "countInSecs":
      return unit(o, a.unit)._countInSecsFromNow(new D(a.secs));
  }
}

export function runScenario(
  s: Scenario,
  opts: Partial<OracleOptions> = {},
  /** engine to run on; default: the old engine (oracle) */
  create: (start: Scenario["start"]) => ScenarioEngine = (start) =>
    createOracle({ now: start.now, save: start.save, ...opts })
): ScenarioResult {
  const o = create(s.start);
  let initial = snapshotFull(o);
  if (s.prefixSteps?.length) {
    for (const step of s.prefixSteps) runStep(o, step);
    initial = snapshotFull(o);
  }
  const steps = s.steps.map((step) => runStep(o, step));
  return {
    name: s.name,
    description: s.description,
    oldEngineVersion: "swarmsim-coffee " + OLD_VERSION,
    start: s.start,
    ...(s.prefixSteps?.length ? { prefixSteps: s.prefixSteps } : {}),
    initial,
    steps,
  };
}

/** Apply one step and take its snapshot. */
export function runStep(o: Oracle, step: Step): StepResult {
  const errorsBefore = o.listenerErrors.length;
  const commandsBefore = o.commandLog.length;
  const r: StepResult = { action: step.action, now: "" };
  try {
    const result = applyAction(o, step.action);
    if (result !== undefined) r.result = ser(o, result);
  } catch (e) {
    r.error = (e as Error).message;
  }
  const listenerErrors = o.listenerErrors.slice(errorsBefore);
  if (listenerErrors.length) {
    const msgs = listenerErrors.map((l) => `listener ${l.event}: ${(l.error as Error).message}`);
    r.error = [r.error, ...msgs].filter(Boolean).join("; ");
  }
  const commands = o.commandLog.slice(commandsBefore);
  if (commands.length) r.commands = ser(o, commands) as unknown[];
  r.now = o.game.now.toISOString();
  const snap = snapshot(o, step.snapshot);
  if (snap !== undefined) r.snapshot = snap;
  return r;
}
