import fs from "fs";
import { gameData, gameDataSource, OUTPUT } from "./gen-json";
import unittypes from "../unittype/data";
import upgrades from "../upgrade/data";
import achievements from "../achievement/data";
import mtx from "../mtx/data";

describe("gamedata.json (rust/crates/data/data/gamedata.json)", () => {
  it("is up to date with the tables (else run `pnpm --filter @swarmsim/tables gen:json`)", () => {
    expect(fs.readFileSync(OUTPUT, "utf8")).toBe(gameDataSource());
  });

  it("parses back to exactly gameData()", () => {
    expect(JSON.parse(gameDataSource())).toStrictEqual(gameData());
  });

  it("has one record per table row, in table order", () => {
    const d = gameData() as any;
    expect(d.unittypes.map((u: any) => u.name)).toEqual(
      unittypes.map((u) => u.name)
    );
    expect(d.upgrades.map((u: any) => u.name)).toEqual(
      upgrades.map((u) => u.name)
    );
    expect(d.achievements.map((a: any) => a.name)).toEqual(
      achievements.map((a) => a.name)
    );
    expect(d.mtx.map((m: any) => m.name)).toEqual(mtx.map((m) => m.name));
  });

  it("holds no empty strings, undefineds or non-finite numbers", () => {
    const bad: string[] = [];
    const walk = (v: unknown, p: string): void => {
      if (v === null || typeof v === "boolean") return;
      if (typeof v === "string") return void (v === "" && bad.push(`${p}: ""`));
      if (typeof v === "number")
        return void (!Number.isFinite(v) && bad.push(`${p}: ${v}`));
      if (typeof v !== "object") return void bad.push(`${p}: ${typeof v}`);
      for (const [k, x] of Object.entries(v as object)) {
        if (x === undefined) bad.push(`${p}.${k}: undefined`);
        else walk(x, `${p}.${k}`);
      }
    };
    walk(gameData(), "");
    expect(bad).toEqual([]);
  });

  it("leaves out the mtx PayPal URLs", () => {
    expect(gameDataSource()).not.toMatch(/paypal\.com/);
  });
});
