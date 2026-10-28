import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import _ from "lodash";
import { spreadsheet } from "../src/data";
import { goldenJson, GOLDEN_DIR } from "./generate";
import { createOracle, loadOriginalSpreadsheet, utcDateString } from "./oracle";
import { runScenario } from "./scenario";
import { scenarios, T0 } from "./scenarios";

describe("oracle", () => {
  test("boots a fresh old-engine game", () => {
    const o = createOracle({ now: T0 });
    const g = o.game;
    expect(g.unit("meat").count().toString()).toBe("35");
    expect(g.unit("larva").count().toString()).toBe("10");
    expect(g.now.toISOString()).toBe(T0);
    o.tick("2020-01-01T00:01:00.000Z");
    expect(g.unit("larva").count().toString()).toBe("70");
    o.commands.buyUnit({ unit: g.unit("drone"), num: new o.Decimal(3) });
    expect(g.unit("drone").count().toString()).toBe("3");
    expect(g.achievement("drone1").isEarned()).toBe(true);
    expect(o.session.state.statistics.byUnit.drone.twinnum.toString()).toBe("3");
  });

  test("the clock is controlled: new Date() inside the old engine reads it", () => {
    const o = createOracle({ now: "2021-05-05T05:05:05.000Z" });
    expect(o.session.state.date.started.toISOString()).toBe("2021-05-05T05:05:05.000Z");
    expect(() => o.tick("2021-05-05T04:00:00.000Z")).toThrow(/back in time/);
  });

  test("tables/ spreadsheet matches the old app's preloaded v0.2 spreadsheet, except known text edits", () => {
    const ours: any = JSON.parse(JSON.stringify(spreadsheet()));
    const orig: any = JSON.parse(JSON.stringify(loadOriginalSpreadsheet()));
    const diffs: string[] = [];
    for (const sheet of Object.keys(orig)) {
      expect(ours[sheet].column_names).toEqual(orig[sheet].column_names);
      expect(ours[sheet].elements.length).toBe(orig[sheet].elements.length);
      orig[sheet].elements.forEach((row: any, i: number) => {
        for (const col of _.union(Object.keys(row), Object.keys(ours[sheet].elements[i]))) {
          if (!_.isEqual(row[col], ours[sheet].elements[i][col])) diffs.push(`${sheet}.${row.name}.${col}`);
        }
      });
    }
    // flavor-text only; no numbers differ
    expect(diffs.sort()).toEqual([
      "achievements.therightquestion.label",
      "achievements.therightquestion.longdesc",
      "unittypes.meat.description",
      "unittypes.meat.lol",
    ]);
  });

  describe("goldens are reproducible", () => {
    for (const s of scenarios()) {
      test(
        s.name,
        () => {
          const file = path.join(GOLDEN_DIR, `${s.name}.json`);
          const expected = fs.readFileSync(file, "utf8");
          const actual = goldenJson(runScenario(s));
          // compare parsed first for a readable diff, then the exact text
          expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
          expect(actual).toBe(expected);
        },
        60000,
      );
    }
  });
});

test("utcDateString matches V8's Date#toString in UTC", () => {
  const times = [0, 1577836800000, 1670960631893, 86400000 * 365 * 300, -1e12];
  // a child process, since TZ can't reliably be changed inside a running jest worker
  const out = execFileSync(process.execPath, ["-e", `console.log(JSON.stringify(${JSON.stringify(times)}.map((t) => new Date(t).toString())))`], {
    env: { ...process.env, TZ: "UTC" },
  });
  expect(times.map((t) => utcDateString(new Date(t)))).toEqual(JSON.parse(out.toString()));
});
