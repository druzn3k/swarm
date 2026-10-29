// Port of the type-table half of services/effect.coffee: EffectType,
// EffectTypes, romanize, and the effecttypes registry of effect handlers.
// The runtime Effect class is in ./effect.
import Decimal from "decimal.js";
import { assert } from "./util";
import { SeedRand } from "./seedrand";
import { EffectLike, GameLike } from "./interfaces";

export type Stats = { [stat: string]: Decimal };
export type StatSchema = { [stat: string]: string };

/** Handler functions an effect type may define. Called with `this` = the EffectType. */
export interface EffectTypeData {
  name: string;
  onBuy?(effect: EffectLike, game: GameLike, parent?: any, level?: Decimal): void;
  onBuyUnit?(effect: EffectLike, game: GameLike, boughtUnit?: any, num?: any): void;
  calcStats?(effect: EffectLike, stats: Stats, schema: StatSchema, level: Decimal): void;
  bank?(effect: EffectLike, game: GameLike): any;
  cap?(effect: EffectLike, game: GameLike): any;
  // third/fourth args vary by effect type: (num) for addUnit, (parent, level) for addUnitRand
  output?(effect: EffectLike, game?: GameLike, arg3?: any, arg4?: any): any;
}

export class EffectType implements EffectTypeData {
  name!: string;
  onBuy?: EffectTypeData["onBuy"];
  onBuyUnit?: EffectTypeData["onBuyUnit"];
  calcStats?: EffectTypeData["calcStats"];
  bank?: EffectTypeData["bank"];
  cap?: EffectTypeData["cap"];
  output?: EffectTypeData["output"];
  constructor(data: EffectTypeData) {
    Object.assign(this, data);
  }
}

export class EffectTypes {
  list: EffectType[] = [];
  byName: { [name: string]: EffectType } = {};

  constructor(effecttypes: EffectType[] = []) {
    for (const effecttype of effecttypes) {
      this.register(effecttype);
    }
  }

  register(effecttype: EffectType): this {
    this.list.push(effecttype);
    this.byName[effecttype.name] = effecttype;
    return this;
  }
}

// romanize() from http://blog.stevenlevithan.com/archives/javascript-roman-numeral-converter
// MIT licensed, according to a comment from the author - safe to copy here
export function romanize(num: number): string | false {
  if (!+num) return false;
  const digits = String(+num).split("");
  const key = [
    "", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM",
    "", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC",
    "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX",
  ];
  let roman = "";
  let i = 3;
  while (i--) roman = (key[+(digits.pop() as string) + i * 10] || "") + roman;
  return Array(+digits.join("") + 1).join("M") + roman;
}

const ONE = new Decimal(1);

// Decimal.log of spreadsheet constants, worked out once. Decimals are
// immutable, so sharing one is the same as computing it again.
const constantLogs = new Map<string, Decimal>();
function constantLog(val: Decimal.Value): Decimal {
  const key = String(val);
  let ret = constantLogs.get(key);
  if (ret == null) {
    ret = Decimal.log(val);
    constantLogs.set(key, ret);
  }
  return ret;
}

// Decimal.log (base 10) of logStat inputs, by exact value: the same levels
// come up again every time stats are recalculated (after each purchase), and
// the logarithm is the slow part. The key is the full-precision string, so
// equal keys mean equal values, and Decimals are immutable, so a cached
// result is the same as computing it again. Bounded: cleared when full.
const LOG_MEMO_MAX = 4096;
const logMemo = new Map<string, Decimal>();
export function memoLog(val: Decimal): Decimal {
  const key = val.toString();
  let ret = logMemo.get(key);
  if (ret == null) {
    ret = Decimal.log(val);
    if (logMemo.size >= LOG_MEMO_MAX) logMemo.clear();
    logMemo.set(key, ret);
  }
  return ret;
}

// Can't write functions in our spreadsheet :(
// TODO: move this to upgrade parsing. this only asserts at runtime if a conflict happens, we want it to assert at loadtime
function validateSchema(stat: string, schema: StatSchema, operation: string): void {
  if (schema[stat] == null) schema[stat] = operation;
  assert(
    schema[stat] === operation,
    `conflicting stat operations. expected ${operation}, got ${schema[stat]}`,
    stat,
    schema,
    operation
  );
}

type Self = Required<EffectTypeData>;

/**
 * Builds the effect type registry. The old Angular `effecttypes` factory
 * injected `seedrand`; pass a SeedRand here instead.
 */
export function buildEffectTypes(seedrand: SeedRand): EffectTypes {
  const effecttypes = new EffectTypes();
  const register = (data: EffectTypeData & ThisType<Self>): void => {
    effecttypes.register(new EffectType(data));
  };

  register({
    name: "addUnit",
    onBuy(effect, game) {
      effect.unit._addCount(this.output(effect, game));
    },
    onBuyUnit(effect, game, boughtUnit, num) {
      effect.unit._addCount(this.output(effect, game, num));
    },
    output(effect, game, num: Decimal.Value = 1) {
      return effect.power().times(effect.val).times(num);
    },
  });
  register({
    name: "addUnitByVelocity",
    onBuy(effect, game) {
      effect.unit._addCount(this.output(effect, game));
    },
    output(effect, game) {
      return effect.unit.velocity().times(effect.val).times(effect.power());
    },
  });
  register({
    name: "addUnitTimed",
    onBuy(effect, game, parent, level) {
      const thresholdMillis = effect.val2 * 1000;
      if (effect.unit2 == null || effect.unit2.isVisible()) {
        if (effect.unit.isAddUnitTimerReady(thresholdMillis)) {
          // TODO this should be @output
          effect.unit._addCount(effect.val);
          effect.unit.setAddUnitTimer();
        }
      }
    },
  });
  register({
    name: "addUnitRand",
    onBuy(effect, game, parent, level) {
      const out = this.output(effect, game, parent, level);
      if (out.spawned) {
        if (effect.unit.count().isZero()) {
          // first spawn. Show tutorial text, this session only. This is totally hacky.
          game.cache.firstSpawn[effect.unit.name] = game.now;
        }
        effect.unit._addCount(out.qty);
      }
    },
    output(effect, game, parent: any = effect.parent, level: Decimal = parent.count()) {
      // minimum level needed to spawn units. Also, guarantees a spawn at exactly this level.
      const minlevel = effect.parentStat(`random.minlevel.${parent.name}`);
      if (level.greaterThanOrEqualTo(minlevel)) {
        const stat_each = effect.parentStat("random.each", 1);
        // chance of any unit spawning at all. base chance set in spreadsheet with statinit.
        const prob = effect.parentStat("random.freq");
        // quantity of units spawned, if any spawn at all.
        const minqty = 0.9;
        const maxqty = 1.1;
        const qtyfactor = effect.val;
        const baseqty = stat_each.times(Decimal.pow(qtyfactor, level));
        // consistent random seed. No savestate scumming.
        const date = game!.session.state.date;
        if (date.restarted == null) date.restarted = date.started;
        const seed = `[${date.restarted.getTime()}, ${effect.parent.name}, ${level}]`;
        const rng = seedrand.rng(seed);
        // at exactly minlevel, a free spawn is guaranteed, no random roll
        // guarantee a spawn every 8 levels too, so people don't get long streaks of bad rolls
        // TODO: remove the 8-levels guaranteed spawns, inspect previous spawns to look for failing streaks and increase odds based on that.
        const roll = rng();
        const isspawned =
          level.equals(minlevel) ||
          level.modulo(8).equals(0) ||
          new Decimal(roll + "").lessThan(prob);
        const roll2 = rng();
        const modqty = minqty + roll2 * (maxqty - minqty);
        // toPrecision: decimal.js insists on this precision, and it'll parse the string output.
        // decimal.js would rather we use Decimal.random(), but we can't seed that.
        const qty = baseqty.times(modqty + "").ceil();
        return { spawned: isspawned, baseqty: baseqty, qty: qty };
      }
      return { spawned: false, baseqty: new Decimal(0), qty: new Decimal(0) };
    },
  });
  register({
    name: "compoundUnit",
    bank(effect, game) {
      let base = effect.unit.count();
      if (effect.unit2 != null) {
        base = base.plus(effect.unit2.count());
      }
      return base;
    },
    cap(effect, game) {
      // empty, not zero
      if (effect.val2 === "" || effect.val2 == null) {
        return undefined;
      }
      let velocity = effect.unit.velocity();
      if (effect.unit2 != null) {
        velocity = velocity.plus(effect.unit2.velocity());
      }
      return velocity.times(effect.val2).times(effect.power());
    },
    output(effect, game) {
      const base = this.bank(effect, game!);
      let ret = base.times(effect.val - 1);
      const cap = this.cap(effect, game!);
      if (cap != null) {
        ret = Decimal.min(ret, cap);
      }
      return ret;
    },
    onBuy(effect, game) {
      effect.unit._addCount(this.output(effect, game));
    },
  });
  register({
    name: "addUpgrade",
    onBuy(effect, game) {
      effect.upgrade._addCount(this.output(effect, game));
    },
    output(effect, game) {
      return effect.power().times(effect.val);
    },
  });
  register({
    name: "skipTime",
    onBuy(effect) {
      effect.game.skipTime(this.output(effect).toNumber(), "seconds");
    },
    output(effect) {
      return effect.power().times(effect.val);
    },
  });

  register({
    name: "multStat",
    calcStats(effect, stats, schema, level) {
      validateSchema(effect.stat, schema, "mult");
      stats[effect.stat] = (stats[effect.stat] ?? ONE).times(Decimal.pow(effect.val, level));
    },
  });
  register({
    name: "expStat",
    calcStats(effect, stats, schema, level) {
      validateSchema(effect.stat, schema, "mult");
      stats[effect.stat] = (stats[effect.stat] ?? ONE).times(
        Decimal.pow(level, effect.val).times(effect.val2).plus(1)
      );
    },
  });
  register({
    name: "asympStat",
    calcStats(effect, stats, schema, level) {
      // val: asymptote max; val2: 1/x weight
      // asymptote min: 1, max: effect.val
      validateSchema(effect.stat, schema, "mult"); // this isn't multstat, but it's commutative with it
      const weight = level.times(effect.val2);
      assert(!weight.isNegative(), "negative asympStat weight");
      //stats[effect.stat] *= 1 + (effect.val-1) * (1 - 1 / (1 + weight))
      stats[effect.stat] = (stats[effect.stat] ?? ONE).times(
        ONE.plus(new Decimal(effect.val).minus(1).times(ONE.minus(ONE.dividedBy(weight.plus(1)))))
      );
    },
  });
  register({
    name: "logStat",
    calcStats(effect, stats, schema, level) {
      // val: log multiplier; val2: log base
      // minimum value is 1.
      validateSchema(effect.stat, schema, "mult"); // this isn't multstat, but it's commutative with it
      //stats[effect.stat] *= (effect.val3 ? 1) * (Math.log(effect.val2 + effect.val * level)/Math.log(effect.val2) - 1) + 1
      stats[effect.stat] = (stats[effect.stat] ?? ONE).times(
        new Decimal(effect.val3 ?? 1)
          .times(
            memoLog(level.times(effect.val).plus(effect.val2))
              .dividedBy(constantLog(effect.val2))
              .minus(1)
          )
          .plus(1)
      );
    },
  });
  register({
    name: "addStat",
    calcStats(effect, stats, schema, level) {
      validateSchema(effect.stat, schema, "add");
      stats[effect.stat] = (stats[effect.stat] ?? new Decimal(0)).plus(
        new Decimal(effect.val).times(level)
      );
    },
  });
  // multStat by a constant, level independent
  register({
    name: "initStat",
    calcStats(effect, stats, schema, level) {
      validateSchema(effect.stat, schema, "mult");
      stats[effect.stat] = (stats[effect.stat] ?? ONE).times(effect.val);
    },
  });
  register({
    name: "multStatPerAchievementPoint",
    calcStats(effect, stats, schema, level) {
      validateSchema(effect.stat, schema, "mult");
      const points = effect.game.achievementPoints();
      stats[effect.stat] = (stats[effect.stat] ?? ONE).times(
        Decimal.pow(ONE.plus(new Decimal(effect.val).times(points)), level)
      );
    },
  });
  register({
    name: "suffix",
    calcStats(effect, stats, schema, level) {
      // using calcstats for this is so hacky....
      let suffix: string | undefined;
      if (level.isZero()) {
        suffix = "";
      } else if (level.lessThan(3999)) {
        // should be safe to assume suffix levels are below 1e308
        suffix = romanize(level.plus(1).toNumber()) as string;
      }
      if (suffix == null) {
        // romanize lists a bunch of Ms past this point; just use regular numbers instead
        suffix = level.plus(1).toString();
      }
      effect.unit.suffix = suffix;
      stats.empower = (stats.empower ?? new Decimal(0)).plus(level);
    },
  });
  return effecttypes;
}
