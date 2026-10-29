// A compact form of the decoded spreadsheet (toSpreadsheet() in ./data.ts),
// for shipping it as static data: every row of a sheet has the same keys in
// the same order, so rows are stored as arrays of values plus one list of
// keys. inflate() rebuilds exactly the objects toSpreadsheet() returns, keys
// in the same order. No io-ts or fp-ts here: the app loads this at startup.

export interface CompactSheet {
  /** the sheet's own properties, in order; `elements` holds the rows */
  [prop: string]: unknown;
  elements: { keys: string[]; rows: unknown[][] };
}
export type CompactSpreadsheet = { [sheet: string]: CompactSheet };

type Row = { [key: string]: unknown };
type Sheet = { [prop: string]: unknown; elements: Row[] };

export function compact(spreadsheet: { [sheet: string]: Sheet }): CompactSpreadsheet {
  const ret: CompactSpreadsheet = {};
  for (const [name, sheet] of Object.entries(spreadsheet)) {
    const out: { [prop: string]: unknown } = {};
    for (const [prop, val] of Object.entries(sheet)) {
      if (prop !== "elements") {
        out[prop] = val;
        continue;
      }
      const rows = val as Row[];
      const keys = rows.length ? Object.keys(rows[0]) : [];
      for (const row of rows) {
        if (Object.keys(row).join("\n") !== keys.join("\n")) {
          throw new Error(`sheet ${name}: rows don't all have the same keys in the same order`);
        }
      }
      out.elements = { keys, rows: rows.map((row) => keys.map((k) => row[k])) };
    }
    ret[name] = out as CompactSheet;
  }
  return ret;
}

export function inflate<T>(data: CompactSpreadsheet): T {
  const ret: { [sheet: string]: { [prop: string]: unknown } } = {};
  for (const name of Object.keys(data)) {
    const sheet = data[name];
    const out: { [prop: string]: unknown } = {};
    for (const prop of Object.keys(sheet)) {
      if (prop !== "elements") {
        out[prop] = sheet[prop];
        continue;
      }
      const { keys, rows } = sheet.elements;
      out.elements = rows.map((vals) => {
        const row: Row = {};
        for (let i = 0; i < keys.length; i++) row[keys[i]] = vals[i];
        return row;
      });
    }
    ret[name] = out;
  }
  return ret as unknown as T;
}
