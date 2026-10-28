// Reads what the hive scene draws from the game: log10 of each creature count.
import type { Game, Decimal } from "@swarmsim/engine";
import type { Population } from "./scene";

const BEYOND = ["overmind6", "overmind5", "overmind4", "overmind3", "overmind2", "overmind", "pantheon5", "pantheon4", "pantheon3", "pantheon2", "pantheon", "goddess", "prophet", "empress", "hivequeen"];

const log10 = (d: Decimal): number => (d.greaterThan(0) ? d.log(10).toNumber() : -1);

export function population(game: Game): Population {
  const c = (n: string) => log10(game.unit(n).count());
  return {
    meat: c("meat"),
    larva: c("larva"),
    drone: c("drone"),
    queen: c("queen"),
    nest: c("nest"),
    greaterqueen: c("greaterqueen"),
    hive: c("hive"),
    beyond: BEYOND.find((n) => game.unit(n).count().greaterThan(0)) ?? null,
  };
}
