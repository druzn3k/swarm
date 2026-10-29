// Port of the runtime half of services/unit.coffee: ProducerPath,
// ProducerPaths, Unit. (UnitType/UnitTypes live in ./unittypes.)
import * as _ from "lodash";
import Decimal from "decimal.js";
import { assert, error } from "./util";
import { Effect } from "./effect";
import { UnitType } from "./unittypes";
import type { Game } from "./game";
import type { Upgrade } from "./upgrade";
import type { Tab } from "./tab";

/** app.coffee: `angular.module('swarmApp').value 'UNIT_LIMIT', '1e100000'` */
export const UNIT_LIMIT = "1e100000";
// parsed once: Decimal.min copies its arguments, so the result is the same as passing the string
const UNIT_LIMIT_DECIMAL = new Decimal(UNIT_LIMIT);

/** mathjs 3.8.1 math.factorial for small non-negative integers (exact product). */
export function factorial(n: number): number {
  let ret = 1;
  for (let i = 2; i <= n; i++) ret *= i;
  return ret;
}

export interface ProducerPathLink {
  parent: Unit;
  child: Unit;
  prod: any;
}

export class ProducerPath {
  name: string;
  /**
   * Cache keys of this path's prefixes: prefixNames[k] names the path made of
   * the first k+1 links, the same name that path has as a ProducerPath of its
   * last child. The last one is this.name.
   */
  prefixNames: string[];
  constructor(public unit: Unit, public path: ProducerPathLink[]) {
    // unit.name's in the name twice, just so there's no confusion about where the path ends
    this.prefixNames = this.path.map((link, k) => {
      const pathname = this.path
        .slice(0, k + 1)
        .map((p) => p.parent.name)
        .join(">");
      return `${link.child.name}:${pathname}>${link.child.name}`;
    });
    this.name = this.prefixNames[this.prefixNames.length - 1] ?? `${this.unit.name}:>${this.unit.name}`;
  }
  first(): ProducerPathLink {
    return this.path[0];
  }
  isZero(): boolean {
    return this.first().parent.count().isZero();
  }
  degree(): number {
    return this.path.length;
  }
  degreeOrZero(): number {
    return this.isZero() ? 0 : this.degree();
  }
  prodEach(): Decimal {
    const cache = this.unit.game.cache.producerPathProdEach;
    const cached = cache[this.name];
    if (cached != null) return cached;
    // Bonus for ancestor to produced-child == product of all bonuses along the path
    // (intuitively, if velocity and velocity-changes are doubled, acceleration is doubled too)
    // Quantity of buildings along the path do not matter, they're calculated separately.
    //
    // The product is worked out link by link from the first ancestor, so the
    // product of the first k links is the prodEach of the path made of them
    // (e.g. nest>queen>drone>meat starts with nest>queen>drone). Paths share
    // those prefixes a lot; each one is cached under its own path name, so it
    // is multiplied once. Same operations in the same order: same result.
    const names = this.prefixNames;
    let k = names.length - 1;
    while (k >= 0 && cache[names[k]] == null) k--;
    let ret = k >= 0 ? cache[names[k]] : new Decimal(1);
    for (k++; k < this.path.length; k++) {
      const ancestordata = this.path[k];
      const val = new Decimal(ancestordata.prod.val).plus(ancestordata.parent.stat("base", 0));
      ret = ret.times(val);
      ret = ret.times(ancestordata.parent.stat("prod", 1));
      // Cap ret, just like count(). This prevents Infinity * 0 = NaN problems, too.
      ret = Decimal.min(ret, UNIT_LIMIT_DECIMAL);
      cache[names[k]] = ret;
    }
    return (cache[this.name] = ret);
  }
  coefficient(count: Decimal = this.first().parent.rawCount()): Decimal {
    // floor(): no fractional units. #184
    return count.floor().times(this.prodEach());
  }
  coefficientNow(): Decimal {
    return this.coefficient(this.first().parent.count());
  }
  count(secs: Decimal.Value): Decimal {
    const degree = this.degree();
    const coeff = this.coefficient();
    // c * (t^d)/d!
    return coeff.times(Decimal.pow(secs, degree)).dividedBy(factorial(degree));
  }
}

export class ProducerPaths {
  list: ProducerPath[];
  byDegree: { [degree: number]: ProducerPath[] };

  constructor(public unit: Unit, public raw: Unit[][]) {
    this.list = _.map(this.raw, (path) => {
      const tailpath = path.concat([this.unit]);
      return new ProducerPath(
        this.unit,
        _.map(path, (parent, index) => {
          const child = tailpath[index + 1];
          const prodlink = parent.prodByName[child.name];
          return { parent: parent, child: child, prod: prodlink };
        })
      );
    });
    this.byDegree = _.groupBy(this.list, (path) => path.degree());
  }

  getDegreeCoefficient(degree: number, now: boolean = false): Decimal {
    let ret = new Decimal(0);
    for (const path of this.byDegree[degree] ?? []) {
      ret = ret.plus(now ? path.coefficientNow() : path.coefficient());
    }
    return ret;
  }

  // Highest polynomial degree of this unit's production chain where the ancestor has nonzero count.
  // Or, how many parents it has. Examples of degree:
  //
  // [drone] is degree 0 (constant, rawcount() with no time factor)
  // [drone > meat] is degree 1
  // [queen > drone > meat] is degree 2
  // [nest > queen > drone > meat] is degree 3
  // [nest > queen > drone] is degree 2
  getMaxDegree(): number {
    return this.getCoefficients().length - 1;
  }

  getCoefficients(): Decimal[] {
    return (this.unit.game.cache.producerPathCoefficients[this.unit.name] ??= this._getCoefficients());
  }

  _getCoefficients(now: boolean = false): Decimal[] {
    // array indexes are polynomial degrees, values are coefficients
    // [1, 3, 5, 7] = 7t^3 + 5t^2 + 3t + 1
    const ret: Decimal[] = [now ? this.unit.count() : this.unit.rawCount()];
    for (const pathdata of this.list) {
      const degree = pathdata.degree();
      const coefficient = now ? pathdata.coefficientNow() : pathdata.coefficient();
      if (!coefficient.isZero()) {
        ret[degree] = (ret[degree] ?? new Decimal(0)).plus(coefficient);
      }
    }
    for (let degree = 0; degree < ret.length; degree++) {
      if (ret[degree] == null) {
        ret[degree] = new Decimal(0);
      }
    }
    return ret;
  }

  getCoefficientsNow(): Decimal[] {
    return this._getCoefficients(true);
  }

  count(secs: Decimal.Value): Decimal {
    let ret = new Decimal(0);
    const coeffs = this.getCoefficients();
    for (let degree = 0; degree < coeffs.length; degree++) {
      // c * (t^d)/d!
      ret = ret.plus(coeffs[degree].times(Decimal.pow(secs, degree)).dividedBy(factorial(degree)));
    }
    return ret;
  }
}

/** A cost/prod/cap/requires entry: spreadsheet row data plus resolved unit and Decimal val. */
export interface ResourceSpec {
  unit: Unit;
  val: Decimal;
  [key: string]: any;
}

export class Unit {
  /** Bisection estimates for degree > 2 production (vs. single-degree approximations). */
  static ESTIMATE_BISECTION = true;

  name: string;
  suffix: string = "";
  affectedBy: Effect[] = [];
  // TODO unit.unittype is needlessly long, rename to unit.type
  type: UnitType;

  prod!: ResourceSpec[];
  prodByName!: { [name: string]: ResourceSpec };
  cost!: ResourceSpec[];
  costByName!: { [name: string]: ResourceSpec };
  warnfirst!: any[];
  showparent?: Unit;
  upgrades!: {
    list: Upgrade[];
    byName: { [name: string]: Upgrade };
    byClass: { [klass: string]: Upgrade[] };
  };
  requires!: any[];
  cap!: ResourceSpec[];
  effect!: Effect[];
  tab?: Tab;
  next?: Unit;
  prev?: Unit;
  _producerPath!: ProducerPaths;

  constructor(public game: Game, public unittype: UnitType) {
    this.name = this.unittype.name;
    this.type = this.unittype; // start transitioning now
  }

  _init(): void {
    this.prod = _.map(this.unittype.prod, (prod) => {
      const ret = _.clone(prod);
      ret.unit = this.game.unit(prod.unittype);
      ret.val = new Decimal(ret.val);
      return ret;
    });
    this.prodByName = _.keyBy(this.prod, (prod) => prod.unit.name);
    this.cost = _.map(this.unittype.cost, (cost) => {
      const ret = _.clone(cost);
      ret.unit = this.game.unit(cost.unittype);
      ret.val = new Decimal(ret.val);
      return ret;
    });
    this.costByName = _.keyBy(this.cost, (cost) => cost.unit.name);
    this.warnfirst = _.map(this.unittype.warnfirst, (warnfirst) => {
      const ret = _.clone(warnfirst);
      ret.unit = this.game.unit(warnfirst.unittype);
      return ret;
    });
    this.showparent = this.game.unit(this.unittype.showparent);
    const list = this.game
      .upgradelist()
      .filter(
        (upgrade) =>
          this.unittype === upgrade.type.unittype ||
          this.showparent?.unittype === upgrade.type.unittype
      );
    this.upgrades = {
      list,
      byName: _.keyBy(list, "name"),
      byClass: _.groupBy(list, (u) => u.type.class),
    };

    this.requires = _.map(this.unittype.requires, (require) => {
      assert(require.unittype || require.upgradetype, "unit require without a unittype or upgradetype", this.name, "", require);
      assert(!(require.unittype && require.upgradetype), "unit require with both unittype and upgradetype", this.name, "", require);
      const ret = _.clone(require);
      ret.val = new Decimal(ret.val);
      if (require.unittype != null) {
        ret.resource = ret.unit = assert(this.game.unit(require.unittype));
      }
      if (require.upgradetype != null) {
        ret.resource = ret.upgrade = assert(this.game.upgrade(require.upgradetype));
      }
      return ret;
    });
    this.cap = _.map(this.unittype.cap, (capspec) => {
      const ret = _.clone(capspec);
      ret.unit = this.game.unit(ret.unittype);
      ret.val = new Decimal(ret.val);
      return ret;
    });
    this.effect = _.map(this.unittype.effect, (effect) => {
      const ret = new Effect(this.game, this, effect);
      ret.unit.affectedBy.push(ret);
      return ret;
    });

    this.tab = this.game.tabs.byName[this.unittype.tab as string];
    if (this.tab) {
      this.next = this.tab.next(this) as Unit | undefined;
      this.prev = this.tab.prev(this) as Unit | undefined;
    }
  }

  // hacky, but we need two stages of init() for our object graph: all unit->unittype, all prod->unit, all producerpath->prod
  _init2(): void {
    // copy all the inter-unittype references, replacing the type references with units
    this._producerPath = new ProducerPaths(
      this,
      _.map(this.unittype.producerPathList, (path) =>
        _.map(path, (unittype) => assert(this.game.unit(unittype)))
      )
    );
  }

  isCountInitialized(): boolean {
    return this.game.session.state.unittypes[this.name] != null;
  }
  rawCount(): Decimal {
    return (this.game.cache.unitRawCount[this.name] ??= (() => {
      // caching's helpful to avoid re-parsing session strings
      let ret = this.game.session.state.unittypes[this.name] ?? 0;
      if (_.isNaN(ret)) {
        error("NaN count. oops.", this.name, ret);
        ret = 0;
      }
      // toPrecision avoids Decimal errors when converting old saves
      if (_.isNumber(ret)) {
        ret = ret.toPrecision(15);
      }
      return new Decimal(ret);
    })());
  }
  _setCount(val: Decimal.Value): void {
    this.game.session.state.unittypes[this.name] = new Decimal(val);
    this.game.cache.onUpdate();
  }
  _addCount(val: Decimal.Value): void {
    this._setCount(this.rawCount().plus(val));
  }
  _subtractCount(val: Decimal.Value): void {
    this._addCount(new Decimal(val).times(-1));
  }

  // direct parents, not grandparents/etc. Drone is parent of meat; queen is parent of drone; queen is not parent of meat.
  _parents(): Unit[] {
    return this._producerPath.list
      .filter((pathdata) => pathdata.first().parent.prodByName[this.name])
      .map((pathdata) => pathdata.first().parent);
  }

  _getCap(): Decimal | undefined {
    return (this.game.cache.unitCap[this.name] ??= (() => {
      if (this.hasStat("capBase")) {
        let ret = this.stat("capBase");
        ret = ret.times(this.stat("capMult", 1));
        ret = ret.plus(this.stat("capFlat", 0));
        return ret;
      }
      return undefined;
    })());
  }
  capValue(): Decimal | undefined;
  capValue(val: Decimal.Value): Decimal;
  capValue(val?: Decimal.Value): Decimal | undefined {
    const cap = this._getCap();
    if (cap == null) {
      // if both are undefined, prefer undefined to NaN, mostly for legacy
      if (val == null) {
        return val as undefined;
      }
      return Decimal.min(val, UNIT_LIMIT_DECIMAL);
    }
    if (val == null) {
      // no value supplied - return just the cap
      return cap;
    }
    return Decimal.min(val, cap);
  }

  capPercent(): Decimal | undefined {
    const cap = this.capValue();
    if (cap != null) {
      return this.count().dividedBy(cap);
    }
    return undefined;
  }
  capDurationSeconds(): number | undefined {
    const cap = this.capValue();
    if (cap != null) {
      // coffee: `@estimateSecsUntilEarned(cap).toNumber?() ? 0`
      const est = this.estimateSecsUntilEarned(cap);
      return typeof est === "number" ? 0 : est.toNumber();
    }
    return undefined;
  }

  isEstimateExact(): boolean {
    // Bisection estimates are precise enough to not say "or less" next to, too.
    return this._producerPath.getMaxDegree() <= 2 || Unit.ESTIMATE_BISECTION;
  }
  isEstimateCacheable(): boolean {
    // Bisection estimates are precise enough to cache. 50 iterations is quick and covers estimates up to like 10 years.
    return this._producerPath.getMaxDegree() <= 2 || Unit.ESTIMATE_BISECTION;
  }
  /**
   * Seconds until this unit's count reaches `num`.
   *
   * Quirk kept from the old engine: returns the JS number 0 (not a Decimal)
   * when `num` is already reached; otherwise a Decimal (Infinity when nothing
   * produces this unit).
   */
  estimateSecsUntilEarned(num0: Decimal.Value): Decimal | 0 {
    const count = this.count();
    const num = new Decimal(num0);
    const remaining = num.minus(count);
    if (remaining.lessThanOrEqualTo(0)) {
      return 0;
    }
    const degree = this._producerPath.getMaxDegree();
    const coeffs = this._producerPath.getCoefficientsNow();
    let ret = new Decimal(Infinity);
    let linear: Decimal | undefined;
    if (degree > 0) {
      // TODO this is exact, don't clear the cache periodically
      if (!coeffs[1].isZero()) {
        linear = ret = Decimal.min(ret, remaining.dividedBy(coeffs[1]));
      }
      if (degree > 1) {
        // quadratic formula: (-b +/- (b^2 - 4ac)^0.5) / 2a
        // TODO this is exact, don't clear the cache periodically
        const b = coeffs[1];
        let a = coeffs[2];
        if (!a.isZero()) {
          const c = remaining.negated();
          a = a.dividedBy(2); // for the "/2!" in "c * t^2/2!"
          // a > 0, b >= 0, c < 0: `root` is always positive/non-imaginary, and + is the correct choice for +/- because - will always be a negative root which doesn't make sense for this problem
          const disc = b.times(b).minus(a.times(c).times(4)).sqrt();
          ret = Decimal.min(ret, b.negated().plus(disc).dividedBy(a.times(2)));
          // TODO there's an exact cubic formula, isn't there? implement it.
        }
        if (degree > 2) {
          if (Unit.ESTIMATE_BISECTION) {
            // Bisection method - slower/more complex, but more precise
            // if we couldn't pick a starting point, pretend a second's passed and try again, possibly quitting if we finished in a second or less. This basically only happens in unit tests.
            const maxSec = linear ?? remaining.dividedBy(this._countInSecsFromNow(new Decimal(1)).minus(count));
            if (!maxSec.greaterThan(0)) {
              ret = new Decimal(1);
            } else {
              ret = this.estimateSecsUntilEarnedBisection(num, maxSec);
            }
          } else {
            // Estimate from minimum degree - faster/simpler, but less precise
            // http://www.kongregate.com/forums/4545-swarm-simulator/topics/473244-time-remaining-suggestion?page=1#posts-8985615
            const rest = coeffs.slice(3);
            for (let i = 0; i < rest.length; i++) {
              const coeff = rest[i];
              // remaining (r) = c * (t^d)/d!
              // solve for t: r * d! / c = t^d
              // solve for t: (r * d! / c) ^ (1/d) = t
              if (!coeff.isZero()) {
                const deg = i + 3;
                ret = Decimal.min(
                  ret,
                  remaining.dividedBy(coeff).times(factorial(deg)).pow(new Decimal(1).dividedBy(deg))
                );
              }
            }
          }
        }
      }
    }
    return ret;
  }

  estimateSecsUntilEarnedBisection(num: Decimal, origMaxSec: Decimal): Decimal {
    // https://en.wikipedia.org/wiki/Bisection_method#Algorithm
    const f = (sec: Decimal) => num.minus(this._countInSecsFromNow(sec));
    const isInThresh = (min: Decimal, max: Decimal) => {
      // Different thresholds for different search spaces
      // (We don't care about seconds if the result's in days)
      const thresh = new Decimal(0.2);
      return max.minus(min).dividedBy(2).lessThan(thresh);
    };

    let minSec = new Decimal(0);
    // No estimates longer than two years, because seriously, why?
    // Because endgame swarmwarps, that's why.
    let maxSec = origMaxSec;
    let minVal = f(minSec);
    f(maxSec); // maxVal: unused, but evaluated like the original
    let iteration = 0;
    let done = false;
    let midSec!: Decimal;
    // 40 iterations gives 0.1-second precision for any estimate that starts below 3000 years. Should be plenty.
    // ...swarmwarp demands some damn big iterations. *50* should be plenty.
    while (iteration < 50 && !done) {
      iteration += 1;
      midSec = maxSec.plus(minSec).dividedBy(2);
      const midVal = f(midSec);
      if (midVal.isZero() || isInThresh(minSec, maxSec)) {
        done = true;
      } else if (midVal.isNegative() === minVal.isNegative()) {
        minSec = midSec;
        minVal = f(minSec);
      } else {
        maxSec = midSec;
        f(maxSec);
      }
    }
    return midSec;
  }

  count(): Decimal {
    return (this.game.cache.unitCount[this.name] ??= this._countInSecsFromNow());
  }

  _countInSecsFromNow(secs: Decimal = new Decimal(0)): Decimal {
    return this._countInSecsFromReified(secs.plus(this.game.diffSeconds()));
  }
  _countInSecsFromReified(secs: Decimal.Value = 0): Decimal {
    return this.capValue(this._producerPath.count(secs));
  }

  // All units that cost this unit.
  spentResources(): (Unit | Upgrade)[] {
    return ([] as (Unit | Upgrade)[])
      .concat(this.game.unitlist(), this.game.upgradelist())
      .filter((u) => u.costByName[this.name] != null);
  }
  spent(ignores: { [name: string]: any } = {}): Decimal {
    let ret = new Decimal(0);
    for (const u of this.game.unitlist()) {
      const costeach = u.costByName[this.name]?.val ?? 0;
      ret = ret.plus(u.count().times(costeach));
    }
    for (const u of this.game.upgradelist()) {
      if (u.costByName[this.name] && ignores[u.name] == null) {
        // cost for $count upgrades starting from level 1
        const costs = u.sumCost(u.count(), 0);
        const cost = _.find(costs, (c) => c.unit.name === this.name);
        ret = ret.plus(cost?.val ?? 0);
      }
    }
    return ret;
  }

  _costMetPercent(): Decimal {
    let max = new Decimal(Infinity);
    for (const cost of this.eachCost()) {
      if (cost.val.greaterThan(0)) {
        max = Decimal.min(max, cost.unit.count().dividedBy(cost.val));
      }
    }
    return max;
  }

  _costMetPercentOfVelocity(): Decimal {
    let max = new Decimal(Infinity);
    for (const cost of this.eachCost()) {
      if (cost.val.greaterThan(0)) {
        max = Decimal.min(max, cost.unit.velocity().dividedBy(cost.val));
      }
    }
    return max;
  }

  /**
   * Cached once true: stays visible until the cache's onRespec() (respec,
   * ascend, import, reset), even if the requirements are no longer met.
   */
  isVisible(): boolean {
    if (this.unittype.disabled) {
      return false;
    }
    if (this.game.cache.unitVisible[this.name]) {
      return true;
    }
    return (this.game.cache.unitVisible[this.name] = this._isVisible());
  }

  _isVisible(): boolean {
    if (this.count().greaterThan(0)) {
      return true;
    }
    assert(this.requires.length > 0, "unit without visibility requirements", this.name);
    for (const require of this.requires) {
      if (require.val.greaterThan(require.resource.count())) {
        if (require.op !== "OR") {
          // most requirements are ANDed, any one failure fails them all
          return false;
        }
        // req-not-met for OR requirements: no-op
      } else if (require.op === "OR") {
        // single necessary requirement is met
        return true;
      }
    }
    return true;
  }

  isBuyButtonVisible(): boolean {
    const eachCost = this.eachCost();
    if (this.unittype.unbuyable || eachCost.length === 0) {
      return false;
    }
    for (const cost of eachCost) {
      if (!cost.unit.isVisible()) {
        return false;
      }
    }
    return true;
  }

  maxCostMet(percent: Decimal.Value = 1): Decimal {
    return (this.game.cache.unitMaxCostMet[`${this.name}:${percent}`] ??= this._costMetPercent()
      .times(percent)
      .floor());
  }

  maxCostMetOfVelocity(): Decimal {
    return (this.game.cache.unitMaxCostMetOfVelocity[`${this.name}`] ??= this._costMetPercentOfVelocity());
  }

  maxCostMetOfVelocityReciprocal(): Decimal {
    return new Decimal(1).dividedBy(this.maxCostMetOfVelocity());
  }

  isCostMet(): boolean {
    return this.maxCostMet().greaterThan(0);
  }

  isBuyable(ignoreCost: boolean = false): boolean {
    return (this.isCostMet() || ignoreCost) && this.isBuyButtonVisible() && !this.unittype.unbuyable;
  }

  buyMax(percent?: Decimal.Value): { num: Decimal; twinnum: Decimal } {
    return this.buy(this.maxCostMet(percent));
  }

  twinMult(): Decimal {
    let ret = new Decimal(1);
    ret = ret.plus(this.stat("twinbase", 0));
    ret = ret.times(this.stat("twin", 1));
    return ret;
  }
  buy(num0: Decimal.Value = 1): { num: Decimal; twinnum: Decimal } {
    if (!this.isCostMet()) {
      throw new Error("We require more resources");
    }
    if (!this.isBuyable()) {
      throw new Error("Cannot buy that unit");
    }
    const num = Decimal.min(num0, this.maxCostMet());
    return this.game.withSave(() => {
      for (const cost of this.eachCost()) {
        cost.unit._subtractCount(cost.val.times(num));
      }
      const twinnum = num.times(this.twinMult());
      this._addCount(twinnum);
      for (const effect of this.effect) {
        effect.onBuyUnit(twinnum);
      }
      // This is a hideous hack that really should be an addUnits effect, but it starts an infinite loop (energy -> mtxEnergy -> energy-cap -> energy...) that I really can't be arsed to debug this late into swarmsim's life.
      if (this.name === "energy") {
        this.game.unit("mtxEnergy")._addCount(twinnum);
      }
      return { num: num, twinnum: twinnum };
    });
  }

  isNewlyUpgradable(): boolean {
    const upgrades = this.showparent?.upgrades?.list ?? this.upgrades.list;
    return _.some(upgrades, (upgrade) => upgrade.isVisible() && upgrade.isNewlyUpgradable());
  }

  totalProduction(): { [unitname: string]: Decimal } {
    return (this.game.cache.totalProduction[this.name] ??= (() => {
      const ret: { [unitname: string]: Decimal } = {};
      const count = this.count().floor();
      const each = this.eachProduction();
      for (const key of Object.keys(each)) {
        ret[key] = each[key].times(count);
      }
      return ret;
    })());
  }

  eachProduction(): { [unitname: string]: Decimal } {
    return (this.game.cache.eachProduction[this.name] ??= (() => {
      const ret: { [unitname: string]: Decimal } = {};
      for (const prod of this.prod) {
        ret[prod.unit.unittype.name] = prod.val.plus(this.stat("base", 0)).times(this.stat("prod", 1));
      }
      return ret;
    })());
  }

  eachCost(): ResourceSpec[] {
    return (this.game.cache.eachCost[this.name] ??= _.map(this.cost, (cost0) => {
      const cost = _.clone(cost0);
      cost.val = cost.val.times(this.stat("cost", 1)).times(this.stat(`cost.${cost.unit.unittype.name}`, 1));
      return cost;
    }));
  }

  // speed at which other units are producing this unit.
  velocity(): Decimal {
    return (this.game.cache.velocity[this.name] ??= Decimal.min(
      UNIT_LIMIT_DECIMAL,
      this._producerPath.getDegreeCoefficient(1, true)
    ));
  }

  /**
   * Broken in the old engine too: ProducerPaths has no getMaxCoefficient(),
   * so this always throws a TypeError. Kept for parity; nothing calls it.
   */
  isVelocityConstant(): boolean {
    return (this._producerPath as any).getMaxCoefficient() <= 1;
  }

  // TODO rework this - shouldn't have to pass a default
  hasStat(key: string, default_?: Decimal.Value): boolean {
    // (a Decimal stat never `!=` a number default, so this is just "is the stat set")
    const s: any = this.stats()[key];
    return s != null && s != default_;
  }
  stat(key: string, default_?: Decimal.Value): Decimal {
    assert(key != null);
    let def: Decimal | undefined;
    if (default_ != null) {
      def = new Decimal(default_);
    }
    const ret = this.stats()[key] ?? def;
    assert(ret != null, "no such stat", this.name, key);
    return new Decimal(ret as Decimal);
  }
  stats(): { [stat: string]: Decimal } {
    return (this.game.cache.stats[this.name] ??= (() => {
      const stats = {};
      const schema = {};
      for (const upgrade of this.upgrades.list) {
        upgrade.calcStats(stats, schema);
      }
      for (const uniteffect of this.affectedBy) {
        uniteffect.calcStats(stats, schema, uniteffect.parent.count());
      }
      return stats;
    })());
  }

  statistics(): any {
    return this.game.session.state.statistics?.byUnit?.[this.name] ?? {};
  }

  // TODO centralize url handling
  url(): string {
    return this.tab!.url(this);
  }

  // for the addUnitTimed effect
  addUnitTimer(): Date {
    const key = `addUnitTimed-${this.name}`;
    return this.game.session.state.date[key] ?? new Date(0);
  }
  addUnitTimerElapsedMillis(now: Date = this.game.now): number {
    return now.getTime() - this.addUnitTimer().getTime();
  }
  addUnitTimerRemainingMillis(durationMillis: number, now: Date = this.game.now): number {
    return Math.max(0, durationMillis - this.addUnitTimerElapsedMillis(now));
  }
  isAddUnitTimerReady(durationMillis: number, now: Date = this.game.now): boolean {
    return this.addUnitTimerRemainingMillis(durationMillis) === 0;
  }
  setAddUnitTimer(now: Date = this.game.now): void {
    const key = `addUnitTimed-${this.name}`;
    this.game.session.state.date[key] = now;
    assert(this.addUnitTimerElapsedMillis(now) === 0);
  }
}
