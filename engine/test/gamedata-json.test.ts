// rust/crates/data/data/gamedata.json (written by the tables' gen:json, read
// by the Rust engine) against what this engine actually parses. The engine
// sees the tables only after an encode -> parseRows round trip, which drops
// "" and some zeros, so the JSON is meant to hold exactly what buildTypes()
// ends up with. This test turns each JSON record back into the engine's row
// (applying the defaults documented in tables/src/json/gen-json.ts and
// rust/PLAN.md section 2) and compares it, every field, with the engine's.
//
// (tables/src/json/gamedata.test.ts checks the file is up to date.)
import fs from "fs";
import path from "path";
import { buildTypes, spreadsheet } from "../src";
import { OUTPUT_DIR, rustFixtures } from "../scripts/dump-rust-fixtures";

const JSON_PATH = path.join(__dirname, "../../rust/crates/data/data/gamedata.json");
const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const types = buildTypes({ state: { date: { started: new Date(0) } } } as any);

type Row = { [k: string]: unknown };

/** A resolved reference (UnitType, UpgradeType, EffectType), as the JSON spells it. */
const ref = (name: unknown): string | undefined => (name == null ? undefined : `@${name}`);

/**
 * An engine object as plain JSON: resolved references become `@name`, and
 * undefined-valued keys (resolveList({required: false}) leaves those) go, like
 * absent ones: nothing in the engine tells them apart.
 */
function plain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(plain);
  if (v !== null && typeof v === "object") {
    if (Object.getPrototypeOf(v) !== Object.prototype) return ref((v as Row).name);
    return defined(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])));
  }
  return v;
}
function defined(o: Row): Row {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));
}
/** the engine's own fields of a UnitType/UpgradeType, without the ones it derives */
function engineRow(t: object, derived: string[]): Row {
  return defined(
    Object.fromEntries(
      Object.entries(t)
        .filter(([k]) => !derived.includes(k))
        .map(([k, x]) => [k, plain(x)]),
    ),
  );
}
/** null -> absent */
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
/** spreadsheet booleans: "TRUE" or absent */
const bool = (b: boolean): string | undefined => (b ? "TRUE" : undefined);

function unitRow(u: any): Row {
  return defined({
    name: u.name,
    ...defined({
      label: opt(u.text.label),
      plural: opt(u.text.plural),
      verb: opt(u.text.verb),
      verbone: opt(u.text.verbone),
      verbing: opt(u.text.verbing),
      description: opt(u.text.description),
      lol: opt(u.text.lol),
    }),
    tab: opt(u.tab),
    column: opt(u.column),
    tier: opt(u.tier),
    init: u.init === 0 ? undefined : u.init,
    ascendPreserve: bool(u.ascendPreserve),
    disabled: bool(u.disabled),
    unbuyable: bool(u.unbuyable),
    isBuyHidden: bool(u.isBuyHidden),
    showparent: ref(u.showparent),
    warnfirst: u.warnfirst
      ? [defined({ unittype: ref(u.warnfirst.unittype), val: opt(u.warnfirst.val), text: opt(u.warnfirst.text) })]
      : [],
    cost: u.cost.map((c: any) => defined({ unittype: ref(c.unittype), val: opt(c.val) })),
    prod: u.prod.map((p: any) => defined({ unittype: ref(p.unittype), val: opt(p.val) })),
    requires: u.requires.map((r: any) =>
      defined({ unittype: ref(r.unittype), upgradetype: ref(r.upgradetype), val: r.val, op: opt(r.op) }),
    ),
    cap: [],
    effect: u.effect.map((e: any) =>
      defined({
        type: ref(e.type),
        unittype: ref(e.unittype),
        unittype2: opt(e.unittype2),
        stat: opt(e.stat),
        val: e.val,
        val2: opt(e.val2),
        val3: opt(e.val3),
      }),
    ),
    slug: opt(u.slug),
  });
}

function upgradeRow(u: any): Row {
  return defined({
    name: u.name,
    label: opt(u.text.label),
    description: opt(u.text.description),
    lol: opt(u.text.lol),
    class: u.class,
    unittype: ref(u.unittype),
    maxlevel: opt(u.maxlevel),
    cost: u.cost.map((c: any) =>
      defined({
        unittype: ref(c.unittype),
        val: c.val,
        // the engine's one default: upgradetypes.ts, maxlevel 1 without a factor
        factor: c.factor === null && u.maxlevel === 1 ? 1 : opt(c.factor),
      }),
    ),
    requires: u.requires.map((r: any) => ({ unittype: ref(r.unittype), val: r.val })),
    effect: u.effect.map((e: any) =>
      defined({
        type: ref(e.type),
        unittype: ref(e.unittype),
        upgradetype: ref(e.upgradetype),
        unittype2: opt(e.unittype2),
        stat: opt(e.stat),
        val: opt(e.val),
        val2: opt(e.val2),
      }),
    ),
  });
}

function achievementRow(a: any): Row {
  return defined({
    name: a.name,
    label: opt(a.text.label),
    description: opt(a.text.description),
    longdesc: opt(a.text.longdesc),
    points: a.points,
    requires: a.requires.map((r: any) =>
      "event" in r
        ? defined({ event: r.event, val: r.params === null ? undefined : JSON.stringify(r.params) })
        : defined({ unittype: ref(r.unittype), upgradetype: ref(r.upgradetype), val: r.val }),
    ),
    visible: a.visible.map((v: any) =>
      defined({ unittype: ref(v.unittype), upgradetype: ref(v.upgradetype), val: v.val }),
    ),
  });
}

describe("gamedata.json matches the engine's buildTypes()", () => {
  it("has the schema version and every table", () => {
    expect(data.schema).toBe(1);
    expect(Object.keys(data)).toEqual(["schema", "unittypes", "upgrades", "achievements", "mtx"]);
  });

  it("unittypes, in order, every field", () => {
    expect(data.unittypes.map((u: any) => u.name)).toEqual(types.unittypes.list.map((u) => u.name));
    for (let i = 0; i < data.unittypes.length; i++) {
      const engine = engineRow(types.unittypes.list[i], [
        "producerPath",
        "producerPathList",
        "producedBy",
        "affectedBy",
      ]);
      expect([i, unitRow(data.unittypes[i])]).toStrictEqual([i, engine]);
    }
  });

  it("upgrades, in order, every field", () => {
    expect(data.upgrades.map((u: any) => u.name)).toEqual(types.upgradetypes.list.map((u) => u.name));
    for (let i = 0; i < data.upgrades.length; i++) {
      const engine = engineRow(types.upgradetypes.list[i], []);
      expect([i, upgradeRow(data.upgrades[i])]).toStrictEqual([i, engine]);
    }
  });

  it("achievements, in order, every field", () => {
    expect(data.achievements.map((a: any) => a.name)).toEqual(types.achievements.list.map((a) => a.name));
    for (let i = 0; i < data.achievements.length; i++) {
      const engine = engineRow(types.achievements.list[i], []);
      expect([i, achievementRow(data.achievements[i])]).toStrictEqual([i, engine]);
    }
  });

  it("event params are what AchievementsListener parses from the spreadsheet's val", () => {
    const events = types.achievements.list.flatMap((a) => a.requires.filter((r: any) => r.event));
    const fromJson = data.achievements.flatMap((a: any) => a.requires.filter((r: any) => "event" in r));
    expect(fromJson.map((r: any) => r.params)).toEqual(events.map((r: any) => (r.val ? JSON.parse(r.val) : null)));
  });

  it("mtx, in order, matches the spreadsheet rows (the engine doesn't use them)", () => {
    const rows = (spreadsheet() as any).mtx.elements;
    const enc = (v: number | null) => (v === null ? "" : v);
    expect(
      data.mtx.map((m: any) => ({
        name: m.name,
        label: m.label ?? "",
        description: m.description ?? "",
        price_kreds: enc(m.price_kreds),
        price_usd_paypal: enc(m.price_usd_paypal),
        uses: enc(m.uses),
        "pack.unittype": m.pack.unittype,
        "pack.val": enc(m.pack.val),
        bulkbonus: enc(m.bulkbonus),
      })),
    ).toEqual(
      rows.map((r: Row) =>
        defined({
          ...r,
          paypalSandboxUrl: undefined,
          paypalLegacyGithubUrl: undefined,
          paypalSwarmsimDotComUrl: undefined,
        }),
      ),
    );
  });

  it.each(Object.keys(rustFixtures()))(
    "the Rust fixture %s is up to date (else run `pnpm --filter @swarmsim/engine dump:rust-fixtures`)",
    (file) => {
      expect(fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8")).toBe(rustFixtures()[file]);
    },
  );
});
