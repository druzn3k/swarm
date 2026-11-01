// Writes the swarm-data crate's test fixtures, rust/crates/data/tests/fixtures/,
// from what this engine builds out of the tables:
//
// - producer-paths.json: every unit's producer paths (unit.ts ProducerPaths,
//   from unittypes.ts _buildProducerPath). One line per unit, in unit order:
//   {"unit", "paths": [{"units", "prod"}]}. `units` runs from the path's first
//   ancestor down to the unit's direct parent (the unit itself is left out);
//   `prod[k]` is the prod.val of link k. Paths are in the engine's order.
// - units.json: per unit, its tab (and next/prev in it), its upgrade list
//   (Unit.upgrades, showparent's included) and affectedBy, the unit effects
//   stats() folds after the upgrades', as "<unit>#<effect index>".
// - tabs.json: Tab.buildTabs, the listed tabs and the magic "all" tab.
//
// Run `pnpm --filter @swarmsim/engine dump:rust-fixtures` after changing the
// tables (and `pnpm --filter @swarmsim/tables gen:json`);
// test/gamedata-json.test.ts fails while these are stale.
import fs from "fs";
import path from "path";
import { createGame, Tab } from "../src";

export const OUTPUT_DIR = path.join(__dirname, "../../rust/crates/data/tests/fixtures");

const lines = (rows: unknown[]): string => `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;

export function rustFixtures(): { [file: string]: string } {
  const { game } = createGame({ now: () => new Date(0) });
  const units = game.unitlist();
  const tab = (t: Tab) => ({
    name: t.name,
    index: t.index,
    lead: t.leadunit.name,
    units: t.units.map((u) => u.name),
    sortedUnits: t.sortedUnits.map((u) => u.name),
  });
  return {
    "producer-paths.json": lines(
      units.map((unit) => ({
        unit: unit.name,
        paths: unit._producerPath.list.map((p) => ({
          units: p.path.map((link) => link.parent.name),
          prod: p.path.map((link) => Number(link.prod.val.valueOf())),
        })),
      })),
    ),
    "units.json": lines(
      units.map((unit) => ({
        unit: unit.name,
        tab: unit.tab?.name ?? null,
        next: unit.next?.name ?? null,
        prev: unit.prev?.name ?? null,
        upgrades: unit.upgrades.list.map((u) => u.name),
        affectedBy: unit.affectedBy.map((e) => `${e.parent.name}#${(e.parent as any).effect.indexOf(e)}`),
      })),
    ),
    "tabs.json": lines([...game.tabs.list.map(tab), tab(game.tabs.byName.all)]),
  };
}

if (require.main === module) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [file, text] of Object.entries(rustFixtures())) {
    fs.writeFileSync(path.join(OUTPUT_DIR, file), text);
  }
}
