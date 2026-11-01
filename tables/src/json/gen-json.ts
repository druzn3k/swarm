// Writes rust/crates/data/data/gamedata.json: the game data for the Rust
// engine (crate swarm-data), which embeds it at compile time. See
// rust/PLAN.md section 2. Run `pnpm --filter @swarmsim/tables gen:json` after
// editing the tables; gamedata.test.ts fails until you do.
//
// The JSON holds what the TypeScript engine actually sees, not the typed
// records as written: the engine reads the tables only after an
// encode (toSpreadsheet()) -> parseRows round trip, and that round trip drops
// "" and turns some zeros into "absent" (see S.number in
// ../spreadsheet/original.ts). So:
//
// - Arrays keep the tables' order, which is significant.
// - Optional values are null, never "" and never left out. Booleans are
//   true/false.
// - `init` is 0 when absent: the round trip can't tell 0 from absent, and the
//   engine reads it as `init || 0`.
// - Numbers that S.number encodes (0 -> "") are null when 0: unit cost/prod
//   val, warnfirst val, upgrade maxlevel and cost factor. The engine then
//   applies its own defaults (e.g. factor 1 when maxlevel is 1).
// - Achievement event requirements carry `params`, the parsed JSON of the
//   spreadsheet's `val` string (null when there is none).
// - mtx is emitted for completeness only, without the PayPal URLs.
//
// engine/test/gamedata-json.test.ts checks all of this, field by field,
// against the engine's buildTypes().
import fs from "fs";
import path from "path";
import * as Un from "../unittype/codec";
import unittypes from "../unittype/data";
import * as Up from "../upgrade/codec";
import upgrades from "../upgrade/data";
import * as A from "../achievement/codec";
import achievements from "../achievement/data";
import * as M from "../mtx/codec";
import mtx from "../mtx/data";

/** Bump when the shape of the JSON changes incompatibly. */
export const SCHEMA_VERSION = 1;

export const OUTPUT = path.join(
  __dirname,
  "../../../rust/crates/data/data/gamedata.json"
);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** "" (and absent) -> null */
function str(s: string | undefined): string | null {
  return s === undefined || s === "" ? null : s;
}
/** absent -> null; 0 kept */
function num(n: number | undefined): number | null {
  return n === undefined ? null : n;
}
/** S.number's encoding: 0 and absent -> null */
function snum(n: number | "" | undefined): number | null {
  return n === undefined || n === "" || n === 0 ? null : n;
}

export function unittypeJson(u: Un.Unittype): Json {
  const label = str(u.l.label);
  return {
    name: u.name,
    slug: label,
    text: {
      label,
      plural: str(u.l.plural),
      verb: str(u.l.verb),
      verbone: str(u.l.verbone),
      verbing: str(u.l.verbing),
      description: str(u.l.description),
      lol: str(u.l.lol),
    },
    tab: str(u.tab),
    column: num(u.column),
    tier: num(u.tier),
    init: u.init ?? 0,
    ascendPreserve: !!u.ascendPreserve,
    disabled: !!u.disabled,
    unbuyable: !!u.unbuyable,
    isBuyHidden: !!u.isBuyHidden,
    showparent: str(u.showparent),
    warnfirst: u.warnfirst
      ? {
          unittype: u.warnfirst.unittype,
          val: snum(u.warnfirst.val),
          text: str(u.warnfirst.text),
        }
      : null,
    cost: (u.cost ?? []).map((c) => ({
      unittype: c.unittype,
      val: snum(c.val),
    })),
    prod: (u.prod ?? []).map((p) => ({
      unittype: p.unittype,
      val: snum(p.val),
    })),
    requires: (u.requires ?? []).map(
      (r): Json =>
        "unittype" in r
          ? { unittype: r.unittype, val: r.val, op: str(r.op) }
          : { upgradetype: r.upgrade, val: r.val, op: str(r.op) }
    ),
    effect: (u.effect ?? []).map((e) => ({
      type: e.type,
      unittype: e.unittype,
      unittype2: str(e.unittype2),
      stat: str(e.stat),
      val: e.val,
      val2: num(e.val2),
      val3: num(e.val3),
    })),
  };
}

export function upgradeJson(u: Up.Upgrade): Json {
  return {
    name: u.name,
    text: {
      label: str(u.l.label),
      description: str(u.l.description),
      lol: str(u.l.lol),
    },
    class: u.class,
    unittype: u.unittype,
    maxlevel: snum(u.maxlevel),
    cost: (u.cost ?? []).map((c) => ({
      unittype: c.unittype,
      val: c.val,
      factor: snum(c.factor),
    })),
    requires: (u.requires ?? []).map((r) => ({
      unittype: r.unittype,
      val: r.val,
    })),
    effect: (u.effect ?? []).map((e) => ({
      type: e.type,
      unittype: str(e.unittype),
      upgradetype: str(e.upgradetype),
      unittype2: str(e.unittype2),
      stat: str(e.stat),
      val: num(e.val),
      val2: num(e.val2),
    })),
  };
}

export function achievementJson(a: A.Achievement): Json {
  return {
    name: a.name,
    text: {
      label: str(a.l.label),
      description: str(a.l.description),
      longdesc: str(a.l.longdesc),
    },
    points: a.points,
    requires: a.requires.map(
      (r): Json =>
        "event" in r
          ? {
              event: r.event,
              params: r.val === "" ? null : (JSON.parse(r.val) as Json),
            }
          : "unittype" in r
          ? { unittype: r.unittype, val: r.val }
          : { upgradetype: r.upgradetype, val: r.val }
    ),
    visible: a.visible.map(
      (v): Json =>
        "unittype" in v
          ? { unittype: v.unittype, val: v.val }
          : { upgradetype: v.upgradetype, val: v.val }
    ),
  };
}

export function mtxJson(m: M.Mtx): Json {
  return {
    name: m.name,
    label: str(m.label),
    description: str(m.description),
    price_kreds: snum(m.price_kreds),
    price_usd_paypal: snum(m.price_usd_paypal),
    uses: snum(m.uses),
    pack: { unittype: m["pack.unittype"], val: snum(m["pack.val"]) },
    bulkbonus: snum(m.bulkbonus),
  };
}

export function gameData(sheets?: {
  unittypes?: Un.Unittype[];
  upgrades?: Up.Upgrade[];
  achievements?: A.Achievement[];
  mtx?: M.Mtx[];
}): { [k: string]: Json } {
  return {
    schema: SCHEMA_VERSION,
    unittypes: (sheets?.unittypes ?? unittypes).map(unittypeJson),
    upgrades: (sheets?.upgrades ?? upgrades).map(upgradeJson),
    achievements: (sheets?.achievements ?? achievements).map(achievementJson),
    mtx: (sheets?.mtx ?? mtx).map(mtxJson),
  };
}

/**
 * The file's text: one record per line, so diffs show which unit, upgrade or
 * achievement changed while the file stays small (it is embedded in the wasm
 * build).
 */
export function gameDataSource(
  data: { [k: string]: Json } = gameData()
): string {
  const lines = Object.entries(data).map(([key, val]) => {
    const head = `  ${JSON.stringify(key)}: `;
    if (!Array.isArray(val)) return head + JSON.stringify(val);
    return `${head}[\n${val
      .map((v) => `    ${JSON.stringify(v)}`)
      .join(",\n")}\n  ]`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, gameDataSource());
}
