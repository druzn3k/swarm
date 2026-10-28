// Which tutorial hint to show: a port of tutStep() from
// swarmsim-coffee/app/scripts/directives/tutorial.coffee. 0 means none.
// The step numbers are the old ones (11 sits between 3 and 4; 100 follows the
// first ascension).
import type { Decimal, Game } from "@swarmsim/engine";

export function tutorialStep(game: Game): number {
  return (game.cache.tutorialStep ??= computeStep(game));
}

function computeStep(game: Game): number {
  // only a few counts matter; game.countUnits() would count every unit each tick
  const units = lazyCounts((n) => game.unit(n).count());
  const upgrades = lazyCounts((n) => game.upgrade(n).count());
  if (!units.ascension.isZero()) {
    // (almost) no tutorial messages after the first ascension
    return game.cache.firstSpawn.ascension ? 100 : 0;
  }
  if (game.cache.firstSpawn.premutagen && units.ascension.isZero()) return 10;
  if (upgrades.expansion.greaterThanOrEqualTo(5)) return 0;
  if (upgrades.expansion.greaterThan(0)) return 9;
  if (upgrades.hatchery.greaterThan(0)) {
    if (units.queen.greaterThanOrEqualTo(5)) {
      if (units.territory.greaterThan(5)) return 8;
      if (units.territory.greaterThan(0)) return 7;
      return 6;
    }
    if (units.queen.greaterThan(0)) return 5;
  }
  if (units.drone.greaterThanOrEqualTo(10)) {
    if (upgrades.hatchery.greaterThan(0)) return 4;
    if (units.meat.greaterThanOrEqualTo(300)) return 11;
    return 3;
  }
  if (units.drone.greaterThan(0)) return 2;
  return 1;
}

function lazyCounts(count: (name: string) => Decimal): Record<string, Decimal> {
  return new Proxy({} as Record<string, Decimal>, { get: (cache, name: string) => (cache[name] ??= count(name)) });
}
