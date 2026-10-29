import fs from "fs";
import path from "path";
import toSpreadsheet from "./data";
import compiled from "./static";
import { compact, inflate } from "./compact";
import { staticSource } from "./gen-static";

describe("static spreadsheet (static.ts)", () => {
  it("is up to date with the tables (else run `pnpm --filter @swarmsim/tables gen:static`)", () => {
    expect(fs.readFileSync(path.join(__dirname, "static.ts"), "utf8")).toBe(staticSource());
  });

  it("inflates to exactly what toSpreadsheet() returns, key order included", () => {
    const want = toSpreadsheet();
    const got = inflate<typeof want>(compiled);
    expect(JSON.stringify(got)).toBe(JSON.stringify(want));
    expect(got).toStrictEqual(want);
  });

  it("toSpreadsheet() holds only plain JSON values, so the static copy loses nothing", () => {
    const bad: string[] = [];
    const walk = (v: unknown, p: string): void => {
      if (v === null || typeof v === "string" || typeof v === "boolean") return;
      if (typeof v === "number") {
        if (!Number.isFinite(v) || Object.is(v, -0)) bad.push(`${p}: ${v}`);
        return;
      }
      if (typeof v !== "object") return void bad.push(`${p}: ${typeof v}`);
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== Array.prototype) bad.push(`${p}: not a plain object`);
      if (Array.isArray(v)) for (let i = 0; i < v.length; i++) if (!(i in v)) bad.push(`${p}[${i}]: hole`);
      for (const [k, x] of Object.entries(v as object)) {
        if (x === undefined) bad.push(`${p}.${k}: undefined`);
        else walk(x, `${p}.${k}`);
      }
    };
    walk(toSpreadsheet(), "");
    expect(bad).toEqual([]);
  });

  it("compact refuses rows with different keys", () => {
    expect(() => compact({ s: { elements: [{ a: 1, b: 2 }, { b: 2, a: 1 }] } })).toThrow(/same keys/);
  });
});
