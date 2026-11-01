// Reads what the hive scenes draw from the game: log10 of each unit's count,
// rounded so that small changes don't redraw anything.
import { Dec } from "@swarmsim/engine-wasm";
import type { NumString } from "@swarmsim/engine-wasm";
import type { GameView } from "../game/view";
import type { Population } from "./scene";

/** log10 of a Num string, as a float (plenty for 1/50 of a decade). */
export function fastLog10(n: NumString | Dec): number {
  const d = Dec.from(n);
  return d.exponent + Math.log10(d.mantissa);
}

const log10 = (n: NumString): number => {
  const d = Dec.from(n);
  return d.isPositive() ? Math.round(fastLog10(d) * 50) / 50 : -1;
};

export function population(g: GameView): Population {
  const pop: Population = {};
  for (const unit of g.units()) pop[unit.name] = log10(unit.count);
  return pop;
}
