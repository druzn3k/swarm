// Port of services/spreadsheetutil.coffee
import * as _ from "lodash";
import { assert } from "./util";

export type FilterFn = (val: any) => boolean;

export function defaultFilter(val: any): boolean {
  // zero, or any truthy value
  return !!val || _.isNumber(val);
}

export function setNested(object: any, props: string[], val: any): any {
  const lastprop = props[props.length - 1];
  const init = props.slice(0, -1);
  let cur = object;
  for (const prop of init) {
    if (cur[prop] == null) cur[prop] = {};
    cur = cur[prop];
  }
  cur[lastprop] = val;
  return object;
}

export function getNested(object: any, props: string[]): any {
  let cur = object;
  for (const prop of props) {
    cur = cur[prop];
  }
  return cur;
}

export function normalizeRow(row: any, filterFn: FilterFn | null = defaultFilter): any {
  const filter = filterFn ?? defaultFilter;
  const ret: any = {};
  for (const col in row) {
    const val = row[col];
    if (filter(val)) {
      const props = col.split(".");
      setNested(ret, props, val);
    }
  }
  return ret;
}

export function normalizeRows(rows: any[], filterFn: FilterFn | null = defaultFilter): any[] {
  return rows.map((row) => normalizeRow(row, filterFn));
}

// Group row properties as lists, given a spec saying how to group them.
// {a:['list']}, [{a:'bob',list:1},{a:'bob',list:2}] -> [{a:'bob',list:[1,2]}]
// In the example above, 'a' is the primary key. Different primary keys aren't
// grouped. See the unittest for more examples.
// Empty values filtered by default.
export function groupRows(
  groupSpec: { [key: string]: string | string[] },
  rows: any[],
  filterFn: FilterFn | null = defaultFilter
): any[] {
  const filter = filterFn ?? defaultFilter;
  const ret: any[] = [];
  for (const key in groupSpec) {
    let listProps: any = groupSpec[key];
    const groups = _.groupBy(rows, key);
    const orderedKeyvals = _.uniq(_.map(rows, key));
    if (_.isString(listProps)) {
      listProps = [listProps];
    }
    if (!_.isArray(listProps)) {
      // TODO nested groupings
      throw new Error("groupRows: nested groupings not supported yet");
    }
    for (const keyval of orderedKeyvals) {
      const group = groups[keyval];
      const mainrow: any = _.clone(group[0]);
      ret.push(mainrow);
      for (const listProp of listProps) {
        const listvals = _.map(group, listProp);
        mainrow[listProp] = _.filter(listvals, filter);
      }
    }
  }
  return ret;
}

export function parseRows(
  groupSpec: { [key: string]: string | string[] },
  rows: any[],
  filterFn: FilterFn | null = defaultFilter
): any[] {
  const normalized = normalizeRows(rows, filterFn);
  return groupRows(groupSpec, normalized, filterFn);
}

export function resolveList(
  objects: any[],
  field: string,
  targets: { [name: string]: any },
  opts: { required?: boolean } = {}
): void {
  if (opts.required == null) opts.required = true;
  for (const obj of objects) {
    const name = obj[field];
    obj[field] = targets[name];
    assert(
      obj[field] || !opts.required,
      `couldn't resolve ref: ${obj}.${field}=${name}`,
      obj,
      field,
      name,
      targets[name],
      objects
    );
  }
}

export const spreadsheetUtil = {
  defaultFilter,
  setNested,
  getNested,
  normalizeRow,
  normalizeRows,
  groupRows,
  parseRows,
  resolveList,
};
