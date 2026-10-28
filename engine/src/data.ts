// The game's spreadsheet data, in the same shape the old CoffeeScript engine
// loads as its 'spreadsheetPreload-v0.2' Angular value.
import toSpreadsheet from "@swarmsim/tables/src/spreadsheet/data";

export type Spreadsheet = ReturnType<typeof toSpreadsheet>;

let cached: Spreadsheet | null = null;
export function spreadsheet(): Spreadsheet {
  return (cached ??= toSpreadsheet());
}
