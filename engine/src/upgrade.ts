// Port of the runtime half of services/upgrade.coffee: class Upgrade.
// (UpgradeType/UpgradeTypes live in ./upgradetypes.)
import * as _ from "lodash";
import Decimal from "decimal.js";
import { assert, coffeeRange, error } from "./util";
import { Effect } from "./effect";
import { UpgradeType } from "./upgradetypes";
import type { Game } from "./game";
import type { Unit } from "./unit";

const ONE = new Decimal(1);

export interface UpgradeCost {
  unit: Unit;
  val: Decimal;
  factor: Decimal;
  [key: string]: any;
}

/** Result of Upgrade.estimateSecsUntilBuyable(). */
export interface UpgradeEstimate {
  /** seconds until buyable (may be <= 0 if stale, NaN in odd cases) */
  val: Decimal;
  rawVal?: Decimal;
  /** the resource we're waiting for, if any */
  unit?: Unit | null;
  /** millis timestamp when the estimate was computed */
  now?: number;
  /** quirk kept from the old engine: a number (1 or 0), not a boolean */
  cacheSafe?: number | boolean;
}

export class Upgrade {
  name: string;
  unit: Unit;
  costByName!: { [unitname: string]: UpgradeCost };
  cost!: UpgradeCost[];
  requires!: any[];
  effect!: Effect[];
  effectByType!: { [typename: string]: Effect[] };

  constructor(public game: Game, public type: UpgradeType) {
    this.name = this.type.name;
    this.unit = assert(this.game.unit(this.type.unittype));
  }

  _init(): void {
    this.costByName = {};
    this.cost = _.map(this.type.cost, (cost) => {
      assert(cost.unittype, "upgrade cost without a unittype", this.name, "", cost);
      const ret = _.clone(cost);
      ret.unit = assert(this.game.unit(cost.unittype));
      ret.val = new Decimal(ret.val);
      ret.factor = new Decimal(ret.factor);
      this.costByName[ret.unit.name] = ret;
      return ret;
    });
    this.requires = _.map(this.type.requires, (require) => {
      assert(require.unittype, "upgrade require without a unittype", this.name, "", require);
      const ret = _.clone(require);
      ret.unit = assert(this.game.unit(require.unittype));
      ret.val = new Decimal(ret.val);
      return ret;
    });
    this.effect = _.map(this.type.effect, (effect) => new Effect(this.game, this, effect));
    this.effectByType = _.groupBy(this.effect, "type.name");
  }

  // TODO refactor counting to share with unit
  count(): Decimal {
    let ret = this.game.session.state.upgrades[this.name] ?? 0;
    if (_.isNaN(ret)) {
      error(`count is NaN! resetting to zero. ${this.name}`);
      ret = 0;
    }
    // we shouldn't ever exceed maxlevel, but just in case...
    if (this.type.maxlevel) {
      ret = Decimal.min(this.type.maxlevel, ret);
    }
    return new Decimal(ret);
  }
  _setCount(val: Decimal.Value): void {
    this.game.session.state.upgrades[this.name] = new Decimal(val);
    this.game.cache.onUpdate();
  }
  _addCount(val: Decimal.Value): void {
    this._setCount(this.count().plus(val));
  }
  _subtractCount(val: Decimal.Value): void {
    this._addCount(new Decimal(val).negated());
  }

  /**
   * Cached once true (until respec/ascend/import/reset); see Unit.isVisible.
   */
  isVisible(): boolean {
    // disabled: hack for larvae/showparent. We really need to just remove showparent already...
    if (!this.unit.isVisible() && !this.unit.unittype.disabled) {
      return false;
    }
    if (this.type.maxlevel != null && this.count().greaterThanOrEqualTo(this.type.maxlevel)) {
      return false;
    }
    if (this.type.disabled) {
      return false;
    }
    if (this.game.cache.upgradeVisible[this.name]) {
      return true;
    }
    return (this.game.cache.upgradeVisible[this.name] = this._isVisible());
  }
  _isVisible(): boolean {
    if (this.count().greaterThan(0)) {
      return true;
    }
    for (const require of this.requires) {
      if (require.val.greaterThan(require.unit.count())) {
        return false;
      }
    }
    return true;
  }
  totalCost(): UpgradeCost[] {
    return (this.game.cache.upgradeTotalCost[this.name] ??= this._totalCost());
  }
  _totalCost(count: Decimal.Value = this.count().plus(this.unit.stat("upgradecost", 0))): UpgradeCost[] {
    return _.map(this.cost, (cost) => {
      const total = _.clone(cost);
      total.val = total.val
        .times(Decimal.pow(total.factor, count))
        .times(this.unit.stat("upgradecostmult", 1))
        .times(this.unit.stat(`upgradecostmult.${this.name}`, 1));
      return total;
    });
  }
  sumCost(num: Decimal.Value, startCount?: Decimal.Value): UpgradeCost[] {
    return _.map(this._totalCost(startCount), (cost0) => {
      const cost = _.clone(cost0);
      // special case: 1 / (1 - 1) == boom
      if (cost.factor.equals(1)) {
        cost.val = cost.val.times(num);
      } else {
        // see maxCostMet for O(1) summation formula derivation.
        // cost.val *= (1 - Math.pow cost.factor, num) / (1 - cost.factor)
        cost.val = cost.val.times(ONE.minus(Decimal.pow(cost.factor, num)).dividedBy(ONE.minus(cost.factor)));
      }
      return cost;
    });
  }
  isCostMet(): boolean {
    return this.maxCostMet().greaterThan(0);
  }

  maxCostMet(percent: Decimal.Value = 1): Decimal {
    return (this.game.cache.upgradeMaxCostMet[`${this.name}:${percent}`] ??= (() => {
      // https://en.wikipedia.org/wiki/Geometric_progression#Geometric_series
      //
      // been way too long since my math classes... given from wikipedia:
      // > cost.unit.count = cost.val (1 - cost.factor ^ maxAffordable) / (1 - cost.factor)
      // solve the equation for maxAffordable to get the formula below.
      let max = new Decimal(Infinity);
      if (this.type.maxlevel) {
        max = new Decimal(this.type.maxlevel).minus(this.count());
      }
      for (const cost of this.totalCost()) {
        assert(cost.val.greaterThan(0), "upgrade cost <= 0", this.name, this);
        let m: Decimal;
        if (cost.factor.equals(1)) {
          //special case: math.log(1) == 0; x / math.log(1) == boom
          m = cost.unit.count().dividedBy(cost.val);
        } else {
          //m = Math.log(1 - (cost.unit.count() * percent) * (1 - cost.factor) / cost.val) / Math.log cost.factor
          m = ONE.minus(cost.unit.count().times(percent).times(ONE.minus(cost.factor)).dividedBy(cost.val))
            .log()
            .dividedBy(cost.factor.log());
        }
        max = Decimal.min(max, m);
      }
      // sumCost is sometimes more precise than maxCostMet, leading to buy() breaking - #290.
      // Compare our result here with sumCost, and adjust if precision's a problem.
      max = max.floor();
      if (max.greaterThanOrEqualTo(0)) {
        // just in case
        for (const cost of this.sumCost(max)) {
          // maxCostMet is supposed to guarantee we have more units than the cost of this many upgrades!
          // if that's not true, it must be a precision error.
          if (cost.unit.count().lessThan(cost.val)) {
            return max.minus(1);
          }
        }
      }
      return max;
    })());
  }

  isMaxAffordable(): boolean {
    return this.type.maxlevel != null && this.maxCostMet().greaterThanOrEqualTo(this.type.maxlevel);
  }

  costMetPercent(): Decimal {
    const costOfMet = _.keyBy(this.sumCost(this.maxCostMet()), (c) => c.unit.name);
    let max = new Decimal(Infinity);
    if (this.isMaxAffordable()) {
      return ONE;
    }
    for (const cost of this.sumCost(this.maxCostMet().plus(1))) {
      const count = cost.unit.count().minus(costOfMet[cost.unit.name].val);
      const val = cost.val.minus(costOfMet[cost.unit.name].val);
      max = Decimal.min(max, count.dividedBy(val));
    }
    return Decimal.min(1, Decimal.max(0, max));
  }

  /**
   * Cached: cacheSafe estimates until the next update, others for up to ~3
   * seconds of clock time (Cache.onPeriodic), so this can be stale.
   */
  estimateSecsUntilBuyable(noRecurse?: boolean): UpgradeEstimate {
    if (this.isMaxAffordable()) {
      return { val: new Decimal(Infinity) };
    }
    // tricky caching - take the estimated when it was cached, then subtract time that's passed since then.
    let cached: any = this.game.cache.upgradeEstimateSecsUntilBuyableCacheSafe[this.name];
    if (cached == null) {
      cached = this.game.cache.upgradeEstimateSecsUntilBuyablePeriodic[this.name] ??= this._estimateSecsUntilBuyable();
      // Some estimates can be cached more permanently (until update)
      if (cached.cacheSafe) {
        this.game.cache.upgradeEstimateSecsUntilBuyableCacheSafe[this.name] = cached;
      }
    }
    if (cached.rawVal == null) {
      // the old engine crashed here the same way (_estimateSecsUntilBuyable returned 0)
      throw new TypeError("Cannot read properties of undefined (reading 'plus')");
    }
    let ret: UpgradeEstimate = _.extend(
      { val: cached.rawVal.plus((cached.now - this.game.now.getTime()) / 1000) },
      cached
    );
    // we can now afford the cached upgrade! clear cache, pick another one.
    if (ret.val.lessThanOrEqualTo(0) && !noRecurse) {
      delete this.game.cache.upgradeEstimateSecsUntilBuyableCacheSafe[this.name];
      delete this.game.cache.upgradeEstimateSecsUntilBuyablePeriodic[this.name];
      ret = this.estimateSecsUntilBuyable(true);
    }
    return ret;
  }

  _estimateSecsUntilBuyable(): any {
    let cacheSafe: any = true;
    let max: any = { rawVal: new Decimal(0), unit: null };
    if (this.type.maxlevel != null && this.maxCostMet().plus(1).greaterThan(this.type.maxlevel)) {
      return 0;
    }
    for (const cost of this.sumCost(this.maxCostMet().plus(1))) {
      const secs = cost.unit.estimateSecsUntilEarned(cost.val);
      if (max.rawVal.lessThan(secs)) {
        max = { rawVal: secs, unit: cost.unit, now: this.game.now.getTime() };
      }
      // coffee `&=`: yields a number (1/0), not a boolean
      cacheSafe = (cacheSafe as any) & (cost.unit.isEstimateCacheable() as any);
    }
    max.cacheSafe = cacheSafe;
    return max;
  }

  /**
   * Results are cached and updated only once every few seconds of clock time
   * (Cache.onPeriodic); may be out of date.
   */
  isUpgradable(costPercent?: Decimal.Value, useWatchedAt: boolean = false): boolean {
    // This function's used for the upgrade-available arrows, and without caching it'd be called once per
    // frame for every upgrade in the game.
    if (useWatchedAt) {
      costPercent = new Decimal(costPercent ?? 1).dividedBy(this.watchedDivisor());
    }
    return (this.game.cache.upgradeIsUpgradable[`${this.name}:${costPercent}`] ??=
      this.type.class === "upgrade" && this.isBuyable() && this.maxCostMet(costPercent).greaterThan(0));
  }
  isAutobuyable(): boolean {
    return this.watchedAt() > 0;
  }
  // default should match the default for maxCostMet
  isNewlyUpgradable(costPercent: number = 1): boolean {
    return this.watchedAt() > 0 && this.isUpgradable(costPercent / this.watchedDivisor());
  }

  // TODO maxCostMet, buyMax that account for costFactor
  isBuyable(): boolean {
    return this.isCostMet() && this.isVisible();
  }

  buy(num0: Decimal.Value = 1): Decimal {
    if (!this.isCostMet()) {
      throw new Error("We require more resources");
    }
    if (!this.isBuyable()) {
      throw new Error("Cannot buy that upgrade");
    }
    const num = Decimal.min(num0, this.maxCostMet());
    return this.game.withSave(() => {
      for (const cost of this.sumCost(num)) {
        assert(cost.unit.count().greaterThanOrEqualTo(cost.val), "tried to buy more than we can afford. upgrade.maxCostMet is broken!", this.name, "", cost);
        assert(cost.val.greaterThan(0), "zero cost from sumCost, yet cost was met?", this.name, "", cost);
        cost.unit._subtractCount(cost.val);
      }
      const count = this.count();
      this._addCount(num);
      // limited to buying less than 1e300 upgrades at once. cost-factors, etc. ensure this is okay.
      // (not to mention 1e300 onBuy()s would take forever)
      for (const i of coffeeRange(num.toNumber())) {
        for (const effect of this.effect) {
          effect.onBuy(count.plus(i + 1));
        }
      }
      return num;
    });
  }

  buyMax(percent?: Decimal.Value): Decimal {
    return this.buy(this.maxCostMet(percent));
  }

  calcStats(stats: any = {}, schema: any = {}): any {
    const count = this.count();
    for (const effect of this.effect) {
      effect.calcStats(stats, schema, count);
    }
    return stats;
  }

  statistics(): any {
    return this.game.session.state.statistics?.byUpgrade?.[this.name] ?? {};
  }

  _watchedAtDefault(): boolean {
    // watch everything by default - except mutagen
    return this.unit.tab?.name !== "mutagen";
  }
  isManuallyHidden(): boolean {
    return this.watchedAt() < 0;
  }
  watchedAt(): number {
    const state = this.game.session.state;
    state.watched ??= {};
    const watched = state.watched[this.name] ?? this._watchedAtDefault();
    if (typeof watched === "boolean") {
      return watched ? 1 : 0;
    }
    return watched;
  }
  watchedDivisor(): number {
    return Math.max(this.watchedAt(), 1);
  }
  watch(state: boolean | number): void {
    this.game.withUnreifiedSave(() => {
      const s = this.game.session.state;
      s.watched ??= {};
      // make savestates a little smaller
      if (state !== this._watchedAtDefault()) {
        s.watched[this.name] = state;
      } else {
        delete s.watched[this.name];
      }
    });
  }
}
