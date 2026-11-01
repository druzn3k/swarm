// Save keys and the one-time v1 -> v2 migration.
//
// The TypeScript engine stored its save (format v1, the old game's) under
// `swarmhive-v1`, with a heartbeat under `swarmhive-v1:heartbeat`. The wasm
// engine stores format v2 under `swarmhive-v2`. On the first load with no v2
// save, a v1 save is converted (convert_save: the state is unchanged, no
// backfill, no new dates), stored as v2, and loaded from there, so the game
// plays on from exactly where the old engine left it. The v1 copy is never
// written or removed: it stays as a rollback for the old app.
import { GameHandle, convertSave, detectSaveFormat } from "@swarmsim/engine-wasm";
import type { SaveStorage } from "./storage";

export const SAVE_ID = "swarmhive-v2";
export const LEGACY_SAVE_ID = "swarmhive-v1";
export const heartbeatKey = (saveId: string) => `${saveId}:heartbeat`;

export interface LoadedGame {
  handle: GameHandle;
  /** what was loaded */
  source: "v2" | "migrated" | "new" | "given";
  /** the v2 text written by a migration */
  migrated?: string;
}

/** The time the game was last seen running (heartbeat), if stored. */
export function readHeartbeat(storage: SaveStorage, saveId: string): number | undefined {
  const raw = storage.getItem(heartbeatKey(saveId));
  if (!raw) return undefined;
  // v2 stores epoch ms; v1 stored an ISO date
  const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Loads the game: the v2 save; else a migrated v1 save; else a new game. A
 * save that fails to load is kept under `<key>:unreadable` and a new game
 * starts, rather than overwriting it.
 */
export function loadGame(storage: SaveStorage, now: number, saveId = SAVE_ID, legacyId = LEGACY_SAVE_ID): LoadedGame {
  const v2 = storage.getItem(saveId);
  if (v2) {
    try {
      return { handle: GameHandle.load(v2, now, readHeartbeat(storage, saveId)), source: "v2" };
    } catch (e) {
      console.warn("couldn't load the saved game; starting a new one", e);
      storage.setItem(`${saveId}:unreadable`, v2);
      return { handle: GameHandle.newGame(now), source: "new" };
    }
  }
  const v1 = storage.getItem(legacyId);
  if (v1 && detectSaveFormat(v1)) {
    try {
      const migrated = convertSave(v1, "v2");
      const handle = GameHandle.load(migrated, now, readHeartbeat(storage, legacyId));
      storage.setItem(saveId, migrated);
      return { handle, source: "migrated", migrated };
    } catch (e) {
      console.warn("couldn't convert the old saved game; starting a new one (the old save is kept)", e);
    }
  }
  return { handle: GameHandle.newGame(now), source: "new" };
}
