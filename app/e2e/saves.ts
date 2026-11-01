// Crafted saves for the e2e tests, made with the TypeScript engine (a dev
// dependency: the app runs the Rust engine as wasm). They are format v1, the
// old game's, which the app migrates to v2 on its first load: every spec
// that seeds a save also exercises that migration.
import * as engine from "@swarmsim/engine";

// Playwright loads the engine's TypeScript source as CommonJS; its named exports sit on the default export.
const { createGame } = ((engine as { default?: typeof engine }).default ?? engine) as typeof engine;

/** where the v1 save is seeded (the app migrates it to V2_SAVE_KEY) */
export const SAVE_KEY = "swarmhive-v1";
export const V2_SAVE_KEY = "swarmhive-v2";

export interface CraftOptions {
  /** unit counts */
  units?: Record<string, number | string>;
  /** upgrade levels */
  upgrades?: Record<string, number>;
  /** pretend the game was last open this many seconds ago */
  awaySecs?: number;
  /** player options, stored in the save like the old game (e.g. showAdvancedUnitData) */
  options?: Record<string, unknown>;
}

/** A save string, exported as if the game was closed `awaySecs` ago. */
export function craftSave(opts: CraftOptions = {}): string {
  const at = new Date(Date.now() - (opts.awaySecs ?? 0) * 1000);
  const { game, session } = createGame({ now: () => at });
  for (const [name, n] of Object.entries(opts.units ?? {})) game.unit(name)._setCount(n);
  for (const [name, n] of Object.entries(opts.upgrades ?? {})) game.upgrade(name)._setCount(n);
  if (opts.options) (session.state as { options?: object }).options = { ...(session.state as { options?: object }).options, ...opts.options };
  game.save();
  return session.exportSave();
}
