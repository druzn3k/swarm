// Minimal structural interfaces describing what the leaf modules (effect type
// handlers, parseNumber, Tab, seedrand) need from the runtime classes (Game,
// Unit, Upgrade, Effect). The real classes satisfy these (checked in
// test/game.test.ts).
import Decimal from "decimal.js";

/** The slice of a UnitType that Tab uses. */
export interface UnitTypeLike {
  name: string;
  tab?: string;
  disabled?: boolean;
  slug: string;
  [key: string]: any;
}

/** Methods/fields of a runtime Unit that leaf modules call. */
export interface UnitLike {
  name: string;
  unittype: UnitTypeLike;
  /** set by the 'suffix' effect type's calcStats */
  suffix?: string;
  count(): Decimal;
  _addCount(num: Decimal.Value): void;
  velocity(): Decimal;
  isVisible(): boolean;
  isNewlyUpgradable(): boolean;
  /** stat lookup; default is returned when the stat is not set */
  stat(name: string, default_?: Decimal.Value): Decimal;
  // addUnitTimed effect
  isAddUnitTimerReady(durationMillis: number): boolean;
  setAddUnitTimer(): void;
  // parseNumber
  maxCostMet(percent: Decimal): Decimal;
  twinMult(): Decimal;
}

/** Methods of a runtime Upgrade that leaf modules call. */
export interface UpgradeLike {
  name: string;
  _addCount(num: Decimal.Value): void;
  count(): Decimal;
}

/** What effect handlers use of their parent (a Unit or an Upgrade). */
export interface EffectParentLike {
  name: string;
  count(): Decimal;
}

/** A runtime Effect instance, as seen by effect type handlers. */
export interface EffectLike {
  game: GameLike;
  parent: EffectParentLike;
  // row data from the spreadsheet
  val: any;
  val2?: any;
  val3?: any;
  stat: string;
  // resolved by Effect's constructor
  unit: UnitLike;
  unit2?: UnitLike;
  upgrade: UpgradeLike;
  power(): Decimal;
  parentStat(statname: string, default_?: Decimal.Value): Decimal;
}

/** What effect handlers (and Game-level callers of seedrand) use of Game. */
export interface GameLike {
  now: Date;
  cache: { firstSpawn: { [unitName: string]: Date } };
  session: {
    state: {
      date: { started: Date; restarted?: Date; [key: string]: any };
      [key: string]: any;
    };
  };
  unit(name: string): UnitLike;
  upgrade(name: string): UpgradeLike;
  skipTime(num: number, unit: string): void;
  achievementPoints(): Decimal.Value;
}

/** What SeedRand needs from the session. */
export interface SeedSession {
  state: { date: { started: any } };
}
