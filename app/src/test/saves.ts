// Test helpers: v1 saves crafted with the TypeScript engine (a dev
// dependency, the parity oracle), loaded into the wasm engine by the store,
// and a controllable clock.
import { createGame } from "@swarmsim/engine";
import { GameStore } from "../game/store";
import type { GameStoreOptions } from "../game/store";
import { memoryStorage } from "../game/storage";

export const T0 = Date.UTC(2024, 0, 1);

export interface CraftOptions {
  units?: Record<string, number | string>;
  upgrades?: Record<string, number>;
  /** the options bag */
  options?: Record<string, unknown>;
  /** upgrade watch levels */
  watched?: Record<string, number>;
  /** when the save was made (epoch ms) */
  at?: number;
}

/** A v1 save (the old engine's format), as if the game was closed at `at`. */
export function craftV1(opts: CraftOptions = {}): string {
  const at = new Date(opts.at ?? T0);
  const { game, session } = createGame({ now: () => at });
  for (const [name, n] of Object.entries(opts.units ?? {})) game.unit(name)._setCount(n);
  for (const [name, n] of Object.entries(opts.upgrades ?? {})) game.upgrade(name)._setCount(n);
  const state = session.state as { options: Record<string, unknown>; watched?: Record<string, number> };
  if (opts.options) Object.assign(state.options, opts.options);
  if (opts.watched) state.watched = { ...state.watched, ...opts.watched };
  game.save();
  return session.exportSave();
}

/** A wall clock and a monotonic clock that tests move by hand. */
export function testClock(start = T0) {
  let wall = start;
  let mono = 1000;
  return {
    now: () => wall,
    perf: () => mono,
    /** both clocks move (the game is running) */
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
    /** only the wall clock moves (a suspended laptop) */
    suspend(ms: number) {
      wall += ms;
    },
  };
}

/** A store on a crafted save, at the save's time, with a test clock. */
export function storeWith(craft: CraftOptions = {}, opts: GameStoreOptions = {}) {
  const clock = testClock(craft.at ?? T0);
  const store = new GameStore({ storage: memoryStorage(), now: clock.now, perfNow: clock.perf, save: craftV1(craft), ...opts });
  return { store, clock };
}
