import { spreadsheet } from "../src";
import toSpreadsheet from "@swarmsim/tables/src/spreadsheet/data";

test("spreadsheet data loads", () => {
  const s = spreadsheet() as any;
  expect(Object.keys(s).sort()).toEqual(
    ["achievements", "mtx", "unittypes", "upgrades"]
  );
});

test("the static spreadsheet is what the tables' codecs produce", () => {
  // (tables/src/spreadsheet/static.test.ts checks the generated file itself)
  expect(JSON.stringify(spreadsheet())).toBe(JSON.stringify(toSpreadsheet()));
  expect(spreadsheet()).toStrictEqual(toSpreadsheet());
});
