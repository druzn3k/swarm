// The game's spreadsheet data, in the same shape the old CoffeeScript engine
// loads as its 'spreadsheetPreload-v0.2' Angular value.
//
// The tables (@swarmsim/tables) are the source of truth; their io-ts codecs
// turn them into this shape. That is done once, at build time
// (tables/src/spreadsheet/gen-static.ts), not at every launch: the app then
// loads neither the codecs nor io-ts/fp-ts. A tables test fails if the
// static copy is out of date.
import type { Schema } from "@swarmsim/tables/src/spreadsheet/original";
import data from "@swarmsim/tables/src/spreadsheet/static";
import { inflate } from "@swarmsim/tables/src/spreadsheet/compact";

export type Spreadsheet = Schema;

let cached: Spreadsheet | null = null;
export function spreadsheet(): Spreadsheet {
  return (cached ??= inflate<Spreadsheet>(data));
}
