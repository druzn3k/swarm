// Port of the type-table half of services/unit.coffee: UnitType, UnitTypes.
// The runtime Unit class is in ./unit.
import * as _ from "./lodash";
import { assert } from "./util";
import { parseRows, resolveList } from "./spreadsheetutil";
import { EffectTypes } from "./effecttypes";

export class UnitType {
  // spreadsheet row data (see tables/): name, label, tab, cost, prod, ...
  name!: string;
  label!: string;
  slug!: string;
  tab?: string;
  disabled?: boolean;
  unbuyable?: boolean;
  showparent?: any;
  cost!: any[];
  prod!: any[];
  warnfirst!: any[];
  requires!: any[];
  cap!: any[];
  effect!: any[];
  producerPath: { [name: string]: UnitType[][] };
  producerPathList: UnitType[][];
  /** unittypes that produce this one; set by UnitTypes.parseSpreadsheet */
  producedBy!: UnitType[];
  /** unit effects that affect this one; filled in by the runtime */
  affectedBy!: any[];
  [key: string]: any;

  constructor(data: any) {
    Object.assign(this, data);
    this.producerPath = {};
    this.producerPathList = [];
  }

  producerNames(): { [name: string]: string[][] } {
    return _.mapValues(this.producerPath, (paths) =>
      _.map(paths, (path) => _.map(path, "name") as string[])
    );
  }
}

export class UnitTypes {
  list: UnitType[] = [];
  byName: { [name: string]: UnitType } = {};

  constructor(unittypes: UnitType[] = []) {
    for (const unittype of unittypes) {
      this.register(unittype);
    }
  }

  register(unittype: UnitType): void {
    this.list.push(unittype);
    this.byName[unittype.name] = unittype;
  }

  static _buildProducerPath(unittype: UnitType, producer: UnitType, path: UnitType[]): void {
    path = [producer].concat(path);
    unittype.producerPathList.push(path);
    if (unittype.producerPath[producer.name] == null) unittype.producerPath[producer.name] = [];
    unittype.producerPath[producer.name].push(path);
    for (const nextgen of producer.producedBy) {
      UnitTypes._buildProducerPath(unittype, nextgen, path);
    }
  }

  /**
   * @param data the spreadsheet preload object, i.e. `spreadsheet()` from
   * ./data. (The old app wrapped this as `{data: preload}`; we take preload.)
   */
  static parseSpreadsheet(effecttypes: EffectTypes, data: any): UnitTypes {
    const rows = parseRows(
      { name: ["cost", "prod", "warnfirst", "requires", "cap", "effect"] },
      data.unittypes.elements
    );
    const ret = new UnitTypes(rows.map((row) => new UnitType(row)));
    for (const unittype of ret.list) {
      unittype.producedBy = [];
      unittype.affectedBy = [];
    }
    for (const unittype of ret.list) {
      //unittype.tick = if unittype.tick then moment.duration unittype.tick else null
      //unittype.cooldown = if unittype.cooldown then moment.duration unittype.cooldown else null
      // replace names with refs
      if (unittype.showparent) {
        resolveList([unittype], "showparent", ret.byName);
      }
      resolveList(unittype.cost, "unittype", ret.byName);
      resolveList(unittype.prod, "unittype", ret.byName);
      resolveList(unittype.warnfirst, "unittype", ret.byName);
      resolveList(unittype.requires, "unittype", ret.byName, { required: false });
      resolveList(unittype.cap, "unittype", ret.byName, { required: false });
      resolveList(unittype.effect, "unittype", ret.byName);
      resolveList(unittype.effect, "type", effecttypes.byName);
      // oops - we haven't parsed upgradetypes yet! done in upgradetypes.ts.
      //resolveList unittype.require, 'upgradetype', ret.byName
      unittype.slug = unittype.label;
      for (const prod of unittype.prod) {
        prod.unittype.producedBy.push(unittype);
        assert(prod.val > 0, "unittype prod.val must be positive", prod);
      }
      for (const cost of unittype.cost) {
        assert(
          cost.val > 0 || (unittype.unbuyable && unittype.disabled),
          "unittype cost.val must be positive",
          cost
        );
      }
    }
    for (const unittype of ret.list) {
      for (const producer of unittype.producedBy) {
        UnitTypes._buildProducerPath(unittype, producer, []);
      }
    }
    return ret;
  }
}

export function buildUnitTypes(effecttypes: EffectTypes, spreadsheet: any): UnitTypes {
  return UnitTypes.parseSpreadsheet(effecttypes, spreadsheet);
}
