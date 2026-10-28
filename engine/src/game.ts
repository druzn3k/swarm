// Port of services/game.coffee: Cache, Game.
import * as _ from "lodash";
import Decimal from "decimal.js";
import { assert, sum, utcDateString } from "./util";
import { Tab, BuiltTabs } from "./tab";
import { Unit } from "./unit";
import { Upgrade } from "./upgrade";
import { Achievement } from "./achievement";
import { buildTypes, TypeTables } from "./types";
import type { EngineEventEmitter } from "./engineevents";

/** A clock: returns the current time. Every `new Date()` in the old engine reads this instead. */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

type Dict<T> = { [key: string]: T };

export class Cache {
  /** Never cleared; hacky way to pass messages that get cleared on reload */
  firstSpawn: Dict<any> = {};
  _lastPeriodicClear!: number;

  upgradeIsUpgradable!: Dict<boolean>;
  upgradeEstimateSecsUntilBuyablePeriodic!: Dict<any>;

  tinyUrl!: Dict<any>;
  stats!: Dict<Dict<Decimal>>;
  eachCost!: Dict<any[]>;
  eachProduction!: Dict<Dict<Decimal>>;
  upgradeTotalCost!: Dict<any[]>;
  producerPathProdEach!: Dict<Decimal>;
  producerPathCoefficients!: Dict<Decimal[]>;
  unitRawCount!: Dict<Decimal>;
  unitCap!: Dict<Decimal | undefined>;
  unitCapPercent!: Dict<any>;
  upgradeEstimateSecsUntilBuyableCacheSafe!: Dict<any>;

  unitCount!: Dict<Decimal>;
  velocity!: Dict<Decimal>;
  totalProduction!: Dict<Dict<Decimal>>;
  upgradeMaxCostMet!: Dict<Decimal>;
  unitMaxCostMet!: Dict<Decimal>;
  unitMaxCostMetOfVelocity!: Dict<Decimal>;
  tutorialStep?: any;

  unitVisible!: Dict<boolean>;
  upgradeVisible!: Dict<boolean>;

  constructor(public clock: Clock = systemClock) {
    this.onUpdate();
    this.onRespec();
  }

  onPeriodic(): void {
    this._lastPeriodicClear = this.clock().getTime();
    this.upgradeIsUpgradable = {};
    this.upgradeEstimateSecsUntilBuyablePeriodic = {};
  }

  onUpdate(): void {
    this.onPeriodic();
    this.onTick();
    this.tinyUrl = {};
    this.stats = {};
    this.eachCost = {};
    this.eachProduction = {};
    this.upgradeTotalCost = {};
    this.producerPathProdEach = {};
    this.producerPathCoefficients = {};
    this.unitRawCount = {};
    this.unitCap = {};
    this.unitCapPercent = {};
    this.upgradeEstimateSecsUntilBuyableCacheSafe = {};
  }

  onTick(): void {
    this.unitCount = {};
    this.velocity = {};
    this.totalProduction = {};
    this.upgradeMaxCostMet = {};
    this.unitMaxCostMet = {};
    this.unitMaxCostMetOfVelocity = {};
    delete this.tutorialStep;

    // clear periodic caches every few seconds (of clock time, not game time)
    if (this.clock().getTime() - this._lastPeriodicClear >= 3000) {
      this.onPeriodic();
    }
  }

  onRespec(): void {
    this.unitVisible = {};
    this.upgradeVisible = {};
  }
}

/** The session state; see Session.reset() for the full shape. */
export interface GameState {
  unittypes: Dict<any>;
  upgrades: Dict<any>;
  date: { started: Date; reified: Date; restarted?: Date; [key: string]: any };
  statistics?: any;
  achievements?: any;
  watched?: Dict<boolean | number>;
  skippedMillis?: number;
  [key: string]: any;
}

/** What Game needs from its session. Session implements it; tests may pass a plain object. */
export interface GameSession {
  state: GameState;
  save(): void;
  reset?(): void;
  importSave?(encoded: string, transient?: boolean): void;
  exportSave?(): string;
}

export interface GameOptions {
  /** type tables; built from the session (and default spreadsheet) if omitted */
  types?: TypeTables;
  /** current time; defaults to the system clock */
  clock?: Clock;
  /** event bus for 'achieve' events */
  events?: EngineEventEmitter;
}

const UNIT_MILLIS: Dict<number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1e3,
  second: 1e3,
  seconds: 1e3,
  m: 6e4,
  minute: 6e4,
  minutes: 6e4,
  h: 36e5,
  hour: 36e5,
  hours: 36e5,
  d: 864e5,
  day: 864e5,
  days: 864e5,
};

export class Game {
  types: TypeTables;
  clock: Clock;
  events?: EngineEventEmitter;

  _units!: { list: Unit[]; byName: Dict<Unit>; bySlug: Dict<Unit> };
  _upgrades!: { list: Upgrade[]; byName: Dict<Upgrade> };
  _achievements!: { list: Achievement[]; byName: Dict<Achievement> };
  achievementPointsPossible!: number;
  tabs!: BuiltTabs;
  skippedMillis!: number;
  gameSpeed!: number;
  cache!: Cache;
  now!: Date;
  respecCostRate: number = 0.3;

  constructor(public session: GameSession, opts: GameOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.events = opts.events;
    this.types = opts.types ?? buildTypes(session as any);
    this._init();
  }

  _init(): void {
    const { unittypes, upgradetypes, achievements } = this.types;
    const unitlist = _.map(unittypes.list, (unittype) => new Unit(this, unittype));
    this._units = {
      list: unitlist,
      byName: _.keyBy(unitlist, "name"),
      bySlug: _.keyBy(unitlist, (u) => u.unittype.slug),
    };

    const upgradelist = _.map(upgradetypes.list, (upgradetype) => new Upgrade(this, upgradetype));
    this._upgrades = { list: upgradelist, byName: _.keyBy(upgradelist, "name") };

    const achievementlist = _.map(achievements.list, (achievementtype) => new Achievement(this, achievementtype));
    this._achievements = { list: achievementlist, byName: _.keyBy(achievementlist, "name") };
    this.achievementPointsPossible = achievements.pointsPossible();

    this.tabs = Tab.buildTabs(this._units.list);

    this.skippedMillis = 0;
    this.gameSpeed = 1;
    this.session.state.skippedMillis ??= 0;

    for (const item of ([] as { _init(): void }[]).concat(this._units.list, this._upgrades.list, this._achievements.list)) {
      item._init();
    }
    for (const item of this._units.list) {
      item._init2();
    }

    this.cache = new Cache(this.clock);

    // tick to reified-time, then to now. this ensures things explode here, instead of later, if they've gone back in time since saving
    delete (this as any).now;
    this.tick(this.session?.state?.date?.reified);
    this.tick();
  }

  diffMillis(): number {
    return this._realDiffMillis() * this.gameSpeed + this.skippedMillis;
  }
  _realDiffMillis(): number {
    const ret = this.now.getTime() - this.session.state.date.reified.getTime();
    return Math.max(0, ret);
  }
  diffSeconds(): number {
    return this.diffMillis() / 1000;
  }

  skipMillis(millis: number): void {
    millis = Math.floor(millis);
    this.skippedMillis += millis;
    this.session.state.skippedMillis! += millis;
  }
  /**
   * Skip `num` units of time. Replaces the old `skipTime(args...)`, which took
   * moment.duration() arguments; supported units are ms/seconds/minutes/hours/days.
   */
  skipTime(num: number, unit: string = "ms"): void {
    const mult = UNIT_MILLIS[unit];
    assert(mult != null, "skipTime: unsupported unit", unit);
    this.skipMillis(num * mult);
  }

  setGameSpeed(speed: number): void {
    this.reify();
    this.gameSpeed = speed;
  }

  totalSkippedMillis(): number {
    return this.session.state.skippedMillis!;
  }
  dateStarted(): Date {
    return this.session.state.date.started;
  }

  /**
   * Advance the game clock (default: the injected clock's now).
   *
   * Going back in time by up to 120 seconds is silently ignored (game.now is
   * not updated); further back throws "tick tried to go back in time".
   */
  tick(now: Date = this.clock(), skipExpire: boolean = false): void {
    assert(now, "can't tick to undefined time", now);
    if (!this.now || this.now.getTime() <= now.getTime()) {
      this.now = now;
      this.cache.onTick();
    } else {
      // system clock problem! don't whine for small timing errors, but don't update the clock either.
      // TODO I hope this accounts for DST
      const diffMillis = this.now.getTime() - now.getTime();
      assert(
        diffMillis <= 120 * 1000,
        "tick tried to go back in time. System clock problem?",
        utcDateString(this.now),
        utcDateString(now),
        diffMillis
      );
    }
  }

  elapsedStartMillis(): number {
    return this.now.getTime() - this.session.state.date.started.getTime();
  }
  timestampMillis(): number {
    return this.elapsedStartMillis() + this.totalSkippedMillis();
  }

  unit(unitname: any): Unit {
    if (_.isUndefined(unitname)) {
      return undefined as any;
    }
    if (!_.isString(unitname)) {
      // it's a unittype?
      unitname = unitname.name;
    }
    return this._units.byName[unitname];
  }
  unitBySlug(unitslug: string): Unit | undefined {
    if (unitslug) {
      return this._units.bySlug[unitslug];
    }
    return undefined;
  }
  units(): Dict<Unit> {
    return _.clone(this._units.byName);
  }
  unitlist(): Unit[] {
    return _.clone(this._units.list);
  }

  // TODO deprecated, remove in favor of unit(name).count()
  count(unitname: string): Decimal {
    return this.unit(unitname).count();
  }

  counts(): Dict<Decimal> {
    return this.countUnits();
  }
  countUnits(): Dict<Decimal> {
    return _.mapValues(this.units(), (unit) => unit.count());
  }
  countUpgrades(): Dict<Decimal> {
    return _.mapValues(this.upgrades(), (upgrade) => upgrade.count());
  }
  getNewlyUpgradableUnits(): Unit[] {
    return this.unitlist().filter((u) => u.isNewlyUpgradable() && u.isVisible());
  }

  upgrade(name: any): Upgrade {
    if (!_.isString(name)) {
      name = name.name;
    }
    return this._upgrades.byName[name];
  }
  upgrades(): Dict<Upgrade> {
    return _.clone(this._upgrades.byName);
  }
  upgradelist(): Upgrade[] {
    return _.clone(this._upgrades.list);
  }
  availableUpgrades(costPercent?: Decimal.Value): Upgrade[] {
    return this.upgradelist().filter((u) => u.isVisible() && u.isUpgradable(costPercent, true));
  }
  availableAutobuyUpgrades(costPercent?: Decimal.Value): Upgrade[] {
    return this.availableUpgrades(costPercent).filter((u) => u.isAutobuyable());
  }
  /** Broken in the old engine too: Upgrade has no isIgnored(), so these throw. Kept for parity. */
  ignoredUpgrades(): Upgrade[] {
    return this.upgradelist().filter((u) => u.isVisible() && (u as any).isIgnored());
  }
  unignoredUpgrades(): Upgrade[] {
    return this.upgradelist().filter((u) => u.isVisible() && !(u as any).isIgnored());
  }

  resourcelist(): (Unit | Upgrade)[] {
    return ([] as (Unit | Upgrade)[]).concat(this.unitlist(), this.upgradelist());
  }

  achievement(name: any): Achievement {
    if (!_.isString(name)) {
      name = name.name;
    }
    return this._achievements.byName[name];
  }
  achievements(): Dict<Achievement> {
    return _.clone(this._achievements.byName);
  }
  achievementlist(): Achievement[] {
    return _.clone(this._achievements.list);
  }
  achievementsSorted(): Achievement[] {
    return _.sortBy(this.achievementlist(), (a) => a.earnedAtMillisElapsed());
  }
  achievementPoints(): number {
    return sum(_.map(this.achievementlist(), (a) => a.pointsEarned()));
  }
  achievementPercent(): number {
    return this.achievementPoints() / this.achievementPointsPossible;
  }

  // Store the 'real' counts, and the time last counted, in the session.
  // Usually, counts are calculated as a function of last-reified-count and time,
  // see count().
  // You must reify before making any changes to unit counts or effectiveness!
  // (So, units that increase the effectiveness of other units AND are produced
  // by other units - ex. derivative clicker mathematicians - can't be supported.)
  reify(skipSeconds: number = 0): void {
    const counts = this.counts();
    _.extend(this.session.state.unittypes, counts);
    this.skippedMillis = 0;
    this.session.state.skippedMillis! += this.diffMillis() - this._realDiffMillis();
    this.session.state.date.reified = this.now;
    this.cache.onUpdate();
    assert(0 === this.diffSeconds(), "diffseconds != 0 after reify!");
  }

  save(): void {
    this.withSave(() => undefined);
  }

  importSave(encoded: string, transient?: boolean): void {
    this.session.importSave!(encoded, transient);
    // Force-clear various caches.
    this._init();
  }

  // A common pattern: change something (reifying first), then save the changes.
  // Use game.withSave(myFunctionThatChangesSomething) to do that.
  withSave<T>(fn: () => T): T {
    this.reify();
    const ret = fn();
    // reify a second time for swarmwarp; https://github.com/erosson/swarm/issues/241
    // Unnecessary for other things, but mostly harmless.
    this.reify();
    this.session.save();
    this.cache.onUpdate();
    return ret;
  }

  withUnreifiedSave<T>(fn: () => T): T {
    const ret = fn();
    this.session.save();
    return ret;
  }

  reset(transient: boolean = false): void {
    this.session.reset!();
    this._init();
    for (const unit of this.unitlist()) {
      unit._setCount(unit.unittype.init || 0);
    }
    if (!transient) {
      this.save();
    }
  }

  ascendEnergySpent(): Decimal {
    const energy = this.unit("energy");
    return energy.spent();
  }
  ascendCost(opts: { spent?: Decimal.Value } = {}): Decimal {
    let spent: Decimal;
    if (opts.spent != null) {
      spent = new Decimal(opts.spent);
    } else {
      spent = this.ascendEnergySpent();
    }
    const ascends = this.unit("ascension").count();
    const ascendPenalty = Decimal.pow(1.12, ascends);
    //return Math.ceil 999999 / (1 + spent/50000)
    // initial cost 5 million, halved every 50k spent, increases 20% per past ascension
    const costVelocity = new Decimal(50000).times(this.unit("mutagen").stat("ascendCost", 1));
    return ascendPenalty.times(5e6).dividedBy(Decimal.pow(2, spent.dividedBy(costVelocity))).ceil();
  }
  ascendCostCapDiff(cost: Decimal = this.ascendCost()): Decimal {
    return cost.minus(this.unit("energy").capValue()!);
  }
  ascendCostPercent(cost: Decimal = this.ascendCost()): Decimal {
    return Decimal.min(1, this.unit("energy").count().dividedBy(cost));
  }
  /**
   * Quirk kept from the old engine: once energy already covers the cost,
   * estimateSecsUntilEarned returns the number 0, and this throws a TypeError
   * ("energy.estimateSecsUntilEarned(...).toNumber is not a function").
   * Returns undefined if the cost exceeds the energy cap.
   */
  ascendCostDurationSecs(cost: Decimal = this.ascendCost()): number | undefined {
    const energy = this.unit("energy");
    if (cost.lessThan(energy.capValue()!)) {
      const est = energy.estimateSecsUntilEarned(cost);
      if (typeof est === "number") {
        throw new TypeError("energy.estimateSecsUntilEarned(...).toNumber is not a function");
      }
      return est.toNumber();
    }
    return undefined;
  }
  ascend(free: boolean = false): void {
    // coffee compared the Decimal to 1 with `<` (valueOf)
    if (!free && (this.ascendCostPercent() as any) < 1) {
      throw new Error("We require more resources (ascension cost)");
    }
    this.withSave(() => {
      // hardcode ascension bonuses. TODO: spreadsheetify
      const premutagen = this.unit("premutagen");
      const mutagen = this.unit("mutagen");
      const ascension = this.unit("ascension");
      mutagen._addCount(premutagen.count());
      premutagen._setCount(0);
      ascension._addCount(1);
      this.session.state.date.restarted = this.now;
      // grant a free respec every 3 ascensions
      if (ascension.count().modulo(3).isZero()) {
        this.unit("freeRespec")._addCount(1);
      }
      // do not use @reset(): we don't want achievements, etc. reset
      this._init();
      // show tutorial message for first ascension. must go after @_init, or cache is cleared
      if (ascension.count().equals(1)) {
        this.cache.firstSpawn.ascension = true;
      }
      for (const unit of this.unitlist()) {
        if (!unit.unittype.ascendPreserve) {
          unit._setCount(unit.unittype.init || 0);
        }
      }
      for (const upgrade of this.upgradelist()) {
        if (upgrade.unit.tab?.name !== "mutagen") {
          upgrade._setCount(0);
        }
      }
    });
  }

  respecRate(): number {
    return 1.0;
  }
  respecCost(): Decimal {
    return this.ascendCost().times(this.respecCostRate).ceil();
  }
  respecCostCapDiff(): Decimal {
    return this.ascendCostCapDiff(this.respecCost());
  }
  respecCostPercent(): Decimal {
    return this.ascendCostPercent(this.respecCost());
  }
  respecCostDurationSecs(): number | undefined {
    return this.ascendCostDurationSecs(this.respecCost());
  }
  isRespecCostMet(): boolean {
    return this.unit("energy").count().greaterThanOrEqualTo(this.respecCost());
  }
  respecSpent(): Decimal {
    const mutagen = this.unit("mutagen");
    // upgrade costs are weird - upgrade costs rely on other upgrades, which breaks spending tracking.
    // ignore them, relying on the mutateHidden upgrade for the true cost.
    const ignores: Dict<boolean> = {};
    for (const up of mutagen.upgrades.list) {
      ignores[up.name] = true;
    }
    // Upgrades come with a free(ish) unit too, so remove their cost. (Mostly for unit tests, doesn't really matter.)
    return mutagen.spent(ignores).minus(this.upgrade("mutatehidden").count());
  }
  respec(): void {
    this.withSave(() => {
      if (!this.isRespecCostMet()) {
        throw new Error("We require more resources");
      }
      const cost = this.respecCost();
      this.unit("energy")._subtractCount(cost);
      // respeccing wipes spent-energy. energy cost of respeccing counts toward spent-energy *after* spent-energy is wiped
      const spent = this.ascendEnergySpent().minus(cost);
      this.unit("respecEnergy")._addCount(spent);
      this._respec();
    });
  }

  respecFree(): void {
    this.withSave(() => {
      if (!this.unit("freeRespec").count().greaterThan(0)) {
        throw new Error("We require more resources");
      }
      this.unit("freeRespec")._subtractCount(1);
      this._respec();
    });
  }

  _respec(): void {
    const mutagen = this.unit("mutagen");
    const spent = this.respecSpent();
    for (const resource of mutagen.spentResources()) {
      resource._setCount(0);
    }
    mutagen._addCount(spent.times(this.respecRate()).floor());
    this.cache.onRespec();
    assert(mutagen.spent().isZero(), "respec didn't refund all mutagen!");
  }
}
