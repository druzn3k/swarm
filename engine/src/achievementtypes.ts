// Port of the type-table half of services/achievement.coffee: AchievementTypes
// (and the 'achievements' factory). Achievement instances and
// AchievementsListener are NOT ported here (next phase).
import { assert, sum } from "./util";
import { parseRows, resolveList } from "./spreadsheetutil";
import { UnitTypes } from "./unittypes";
import { UpgradeTypes } from "./upgradetypes";
import * as _ from "lodash";

export class AchievementTypes {
  // achievement rows are plain objects from the spreadsheet
  list: any[] = [];
  byName: { [name: string]: any } = {};

  register(achievement: any): void {
    this.list.push(achievement);
    this.byName[achievement.name] = achievement;
  }

  pointsPossible(): number {
    return sum(_.map(this.list, (a) => a.points));
  }

  /** @param data the spreadsheet preload object, i.e. `spreadsheet()` from ./data. */
  static parseSpreadsheet(data: any, unittypes: UnitTypes, upgradetypes: UpgradeTypes): AchievementTypes {
    const rows = parseRows({ name: ["requires", "visible"] }, data.achievements.elements);
    const ret = new AchievementTypes();
    for (const row of rows) {
      ret.register(row);
    }
    for (const row of ret.list) {
      resolveList(row.requires, "unittype", unittypes.byName, { required: false });
      resolveList(row.requires, "upgradetype", upgradetypes.byName, { required: false });
      resolveList(row.visible, "unittype", unittypes.byName, { required: false });
      resolveList(row.visible, "upgradetype", upgradetypes.byName, { required: false });
      assert(row.points >= 0, "achievement must have points", row.name, row);
      assert(_.isNumber(row.points), "achievement points must be number", row.name, row);
    }
    return ret;
  }
}

export function buildAchievementTypes(
  spreadsheet: any,
  unittypes: UnitTypes,
  upgradetypes: UpgradeTypes
): AchievementTypes {
  return AchievementTypes.parseSpreadsheet(spreadsheet, unittypes, upgradetypes);
}
