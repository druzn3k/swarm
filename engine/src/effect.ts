// Port of the runtime half of services/effect.coffee: class Effect.
// (EffectType/EffectTypes and the handler registry live in ./effecttypes.)
import Decimal from "decimal.js";
import { assert } from "./util";
import { EffectType } from "./effecttypes";
import type { Game } from "./game";
import type { Unit } from "./unit";
import type { Upgrade } from "./upgrade";

export class Effect {
  // spreadsheet row data, copied onto the effect (coffee: _.extend this, data)
  type!: EffectType;
  val: any;
  val2?: any;
  val3?: any;
  stat!: string;
  unittype?: any;
  unittype2?: any;
  upgradetype?: any;
  [key: string]: any;

  /** resolved from data.unittype */
  unit!: Unit;
  /** resolved from data.unittype2 */
  unit2?: Unit;
  /** resolved from data.upgradetype */
  upgrade!: Upgrade;

  constructor(public game: Game, public parent: Unit | Upgrade, data: any) {
    Object.assign(this, data);
    if (data.unittype != null) {
      this.unit = assert(this.game.unit(data.unittype));
    }
    if (data.unittype2 != null) {
      this.unit2 = assert(this.game.unit(data.unittype2));
    }
    if (data.upgradetype != null) {
      this.upgrade = assert(this.game.upgrade(data.upgradetype));
    }
  }

  parentUnit(): Unit {
    // parent can be a unit or an upgrade
    const p: any = this.parent;
    return p.unittype != null ? p : p.unit;
  }
  parentUpgrade(): Upgrade | null {
    const p: any = this.parent;
    return p.unittype != null ? null : p;
  }
  hasParentStat(statname: string, _default?: Decimal.Value): boolean {
    return this.parentUnit().hasStat(statname, _default);
  }
  parentStat(statname: string, _default?: Decimal.Value): Decimal {
    return this.parentUnit().stat(statname, _default);
  }

  onBuy(level: Decimal): void {
    this.type.onBuy?.(this as any, this.game as any, this.parent, level);
  }
  onBuyUnit(twinnum: Decimal): void {
    this.type.onBuyUnit?.(this as any, this.game as any, this.parent, twinnum);
  }

  calcStats(stats: any = {}, schema: any = {}, level: Decimal = this.parent.count()): any {
    this.type.calcStats?.(this as any, stats, schema, level);
    return stats;
  }

  bank(): any {
    return this.type.bank?.(this as any, this.game as any);
  }
  cap(): any {
    return this.type.cap?.(this as any, this.game as any);
  }
  output(level?: Decimal): any {
    return this.type.output?.(this as any, this.game as any, undefined, level);
  }
  outputNext(): any {
    return this.output(this.parent.count().plus(1));
  }
  power(): Decimal {
    let ret = this.parentStat("power", 1);
    // include, for example, "power.swarmwarp"
    const upname = this.parentUpgrade()?.name;
    if (upname) {
      ret = ret.times(this.parentStat(`power.${upname}`, 1));
    }
    return ret;
  }
}
