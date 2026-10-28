import { spreadsheet } from "../src";

test("spreadsheet data loads", () => {
  const s = spreadsheet() as any;
  expect(Object.keys(s).sort()).toEqual(
    ["achievements", "mtx", "unittypes", "upgrades"]
  );
});
