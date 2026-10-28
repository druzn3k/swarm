// Reads what the hive scenes draw from the game: log10 of each unit's count,
// rounded so that small changes don't redraw anything.
import type { Game, Decimal } from "@swarmsim/engine";
import type { Population } from "./scene";

const log10 = (d: Decimal): number => (d.greaterThan(0) ? Math.round(d.log(10).toNumber() * 50) / 50 : -1);

export function population(game: Game): Population {
  const pop: Population = {};
  for (const unit of game.unitlist()) pop[unit.name] = log10(unit.count());
  return pop;
}
