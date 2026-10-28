// Port of the type-table half of services/upgrade.coffee: UpgradeType, UpgradeTypes.
// The runtime Upgrade class is in ./upgrade.
import { assert } from "./util";
import { parseRows, resolveList } from "./spreadsheetutil";
import { EffectTypes } from "./effecttypes";
import { UnitTypes } from "./unittypes";

export class UpgradeType {
  name!: string;
  unittype!: any;
  maxlevel?: number;
  cost!: any[];
  requires!: any[];
  effect!: any[];
  [key: string]: any;

  constructor(data: any) {
    Object.assign(this, data);
  }
}

export class UpgradeTypes {
  list: UpgradeType[] = [];
  byName: { [name: string]: UpgradeType } = {};

  constructor(public unittypes: UnitTypes, upgrades: UpgradeType[] = []) {
    for (const upgrade of upgrades) {
      this.register(upgrade);
    }
  }

  register(upgrade: UpgradeType): void {
    assert(upgrade.name, "upgrade without a name", upgrade);
    this.list.push(upgrade);
    this.byName[upgrade.name] = upgrade;
  }

  /** @param data the spreadsheet preload object, i.e. `spreadsheet()` from ./data. */
  static parseSpreadsheet(unittypes: UnitTypes, effecttypes: EffectTypes, data: any): UpgradeTypes {
    const rows = parseRows({ name: ["requires", "cost", "effect"] }, data.upgrades.elements);
    const ret = new UpgradeTypes(
      unittypes,
      rows.filter((row) => row.name).map((row) => new UpgradeType(row))
    );
    for (const upgrade of ret.list) {
      resolveList([upgrade], "unittype", unittypes.byName);
      resolveList(upgrade.cost, "unittype", unittypes.byName);
      resolveList(upgrade.requires, "unittype", unittypes.byName);
      resolveList(upgrade.effect, "unittype", unittypes.byName, { required: false });
      resolveList(upgrade.effect, "upgradetype", ret.byName, { required: false });
      resolveList(upgrade.effect, "type", effecttypes.byName);
      for (const cost of upgrade.cost) {
        assert(cost.val > 0, "upgradetype cost.val must be positive", cost);
        if (upgrade.maxlevel === 1 && !cost.factor) {
          cost.factor = 1;
        }
        assert(cost.factor > 0, "upgradetype cost.factor must be positive", cost);
      }
    }
    // resolve unittype.require.upgradetype, since upgrades weren't available when it was parsed. kinda hacky.
    for (const unittype of unittypes.list) {
      resolveList(unittype.requires, "upgradetype", ret.byName, { required: false });
    }
    return ret;
  }
}

export function buildUpgradeTypes(
  unittypes: UnitTypes,
  effecttypes: EffectTypes,
  spreadsheet: any
): UpgradeTypes {
  return UpgradeTypes.parseSpreadsheet(unittypes, effecttypes, spreadsheet);
}
