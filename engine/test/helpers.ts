// Shared helpers for the ported Jasmine specs.
import { Game, GameOptions } from "../src";

/**
 * The specs' `mkgame`: a Game on a minimal fake session. Like the old specs,
 * game.now is then forced to new Date(0). The clock is pinned to the epoch
 * (the old specs used the real clock; they only relied on it being "now-ish").
 */
export function mkgame(unittypes: { [name: string]: any }, reified: Date = new Date(0), opts: GameOptions = {}): Game {
  const game = new Game(
    {
      state: { unittypes: unittypes, upgrades: {}, date: { reified: reified, started: reified, restarted: reified } },
      save: () => {},
    },
    { clock: () => new Date(0), ...opts }
  );
  game.now = new Date(0);
  return game;
}
