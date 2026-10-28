// Reads what the hive scenes draw from the game: log10 of each unit's count,
// rounded so that small changes don't redraw anything.
import type { Game, Decimal } from "@swarmsim/engine";
import type { Population } from "./scene";

// decimal.js's arbitrary-precision log is slow, and this runs for every unit
// on every tick; float math is plenty for 1/50 of a decade.
export function fastLog10(d: Decimal): number {
  if (d.e < 300) return Math.log10(d.toNumber());
  // beyond float range: exponent plus the log of the leading digits
  const [mantissa, exp] = d.toExponential(6).split("e");
  return Number(exp) + Math.log10(Number(mantissa));
}

const log10 = (d: Decimal): number => (d.greaterThan(0) ? Math.round(fastLog10(d) * 50) / 50 : -1);

export function population(game: Game): Population {
  const pop: Population = {};
  for (const unit of game.unitlist()) pop[unit.name] = log10(unit.count());
  return pop;
}
