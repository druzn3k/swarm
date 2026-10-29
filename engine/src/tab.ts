// Port of services/tab.coffee
import * as _ from "./lodash";
import Decimal from "decimal.js";
import { UnitLike } from "./interfaces";

export interface BuiltTabs {
  list: Tab[];
  byName: { [name: string]: Tab };
  byUnit: { [unitName: string]: Tab };
}

export class Tab {
  units: UnitLike[] = [];
  sortedUnits: UnitLike[] = [];
  indexByUnitName: { [unitName: string]: number } = {};
  /** set by the UI (controllers/main.coffee) */
  lastselected?: UnitLike;

  constructor(
    public leadunit: UnitLike,
    public index: number,
    public name: string = leadunit.name
  ) {
    this.push(this.leadunit);
  }

  push(unit: UnitLike): void {
    this.indexByUnitName[unit.name] = this.units.length;
    this.units.push(unit);
    // usually this is reverse order, highest tier first
    this.sortedUnits.unshift(unit);
  }

  // TODO rename nextunit, prevunit
  next(unit: UnitLike | string | undefined): UnitLike | undefined {
    const index = this.indexByUnitName[this._key(unit)];
    return this.units[index + 1];
  }
  prev(unit: UnitLike | string | undefined): UnitLike | undefined {
    const index = this.indexByUnitName[this._key(unit)];
    return this.units[index - 1];
  }
  // coffee: `unit?.name ? unit`
  private _key(unit: UnitLike | string | undefined): string {
    return ((unit as any)?.name ?? unit) as string;
  }

  isVisible(): boolean {
    return this.leadunit.isVisible();
  }

  isNewlyUpgradable(): boolean {
    return _.some(this.units, (unit) => unit.isVisible() && unit.isNewlyUpgradable());
  }

  sortUnits(): UnitLike[] {
    if (this.name === "all") {
      return this.sortedUnits;
    }
    return _.sortBy(this.sortedUnits, (u) => {
      // default ascending, hack for descending sort
      // (coffee multiplied the Decimal directly, coercing via valueOf)
      return -1 * Number((u.stat("empower", 0) as Decimal).valueOf());
    });
  }

  static buildTabs(unitlist: UnitLike[]): BuiltTabs {
    const ret: BuiltTabs = {
      list: [],
      byName: {},
      byUnit: {},
    };
    // a magic tab with all the units. Deliberately not listed/displayed.
    let all: Tab | null = null;

    for (const unit of unitlist) {
      if (unit.unittype.tab && !unit.unittype.disabled) {
        let tab = ret.byName[unit.unittype.tab];
        if (tab != null) {
          tab.push(unit);
        } else {
          // tab leader comes first in the spreadsheet
          tab = ret.byName[unit.unittype.tab] = new Tab(unit, ret.list.length);
          ret.list.push(tab);
        }
        ret.byUnit[unit.name] = tab;
        if (!all) {
          all = ret.byName.all = new Tab(unit, 1, "all");
        } else {
          all.push(unit);
        }
      }
    }
    // the magic 'all' tab is the exception, don't reverse its units
    all!.sortedUnits.reverse();
    return ret;
  }

  // TODO should probably centralize url building in its own factory, instead of a method
  // @lastselected set by /controllers/main.coffee
  url(unit: UnitLike | undefined | null = this.lastselected): string {
    const u = unit ?? this.lastselected;
    const unitsuffix = u ? `/unit/${u.unittype.slug}` : "";
    return `/tab/${this.name}${unitsuffix}`;
  }
}
