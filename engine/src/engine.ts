// Top-level factory: wires the engine together in the same order the old app
// did (session -> game -> statistics -> achievements listener -> commands;
// then reset or load; then backfill).
import Decimal from "decimal.js";
import { spreadsheet as defaultSpreadsheet } from "./data";
import { buildTypes, TypeTables } from "./types";
import { Clock, Game, systemClock } from "./game";
import { MemoryStorage, SaveStorage, Session, DEFAULT_SAVE_ID, DEFAULT_VERSION } from "./session";
import { StatisticsListener } from "./statistics";
import { AchievementsListener } from "./achievement";
import { Commands } from "./command";
import { Backfill } from "./backfill";
import { createEventEmitter, EngineEventEmitter } from "./engineevents";
import { parseNumber } from "./parsenumber";
import type { Unit } from "./unit";

export interface CreateGameOptions {
  /** current time; every `new Date()` of the old engine reads this. Default: system clock */
  now?: Clock;
  /** where saves go. Default: a new MemoryStorage */
  storage?: SaveStorage;
  /**
   * A save string to import (transiently: not written to storage until the
   * next save). If omitted, the save stored under the save id is loaded, if
   * any; otherwise a new game starts.
   */
  save?: string;
  /** event bus; pass your own to subscribe before the engine's listeners */
  events?: EngineEventEmitter;
  /** storage key base (old env.saveId). Default "v0.2" */
  saveId?: string;
  isKongregate?: boolean;
  /** version written to saves. Default "1.1.17" */
  version?: string;
  isOffline?: boolean;
  /** spreadsheet data; default: ./data spreadsheet() */
  spreadsheet?: any;
}

export interface Engine {
  game: Game;
  session: Session;
  commands: Commands;
  statistics: StatisticsListener;
  achievementsListener: AchievementsListener;
  backfill: Backfill;
  events: EngineEventEmitter;
  types: TypeTables;
  /** parse player number input ("1.5k", "50%", "=10", "@100"); see parsenumber.ts */
  parseNumber(value: unknown, unit?: Unit): Decimal | undefined;
  /** If a stored save failed to load, the error (and a fresh game was started instead). */
  loadError?: unknown;
}

export function createGame(opts: CreateGameOptions = {}): Engine {
  const clock = opts.now ?? systemClock;
  const events = opts.events ?? createEventEmitter();
  const session = new Session({
    clock,
    storage: opts.storage ?? new MemoryStorage(),
    events,
    saveId: opts.saveId ?? DEFAULT_SAVE_ID,
    isKongregate: opts.isKongregate,
    version: opts.version ?? DEFAULT_VERSION,
    isOffline: opts.isOffline,
  });
  const types = buildTypes(session, opts.spreadsheet ?? defaultSpreadsheet());
  const game = new Game(session, { types, clock, events });
  // statistics before achievementslistener, so 'command' listeners update statistics first.
  const statistics = new StatisticsListener(session, events);
  statistics.listen(events);
  const achievementsListener = new AchievementsListener(game, events);
  const commands = new Commands(game, events);
  const backfill = new Backfill();

  let loadError: unknown;
  const save = opts.save ?? session.getStoredSaveData();
  if (save != null && save !== "") {
    try {
      game.importSave(save, true);
    } catch (e) {
      if (opts.save != null) throw e;
      // a stored save we couldn't read: start a new game, but don't overwrite the stored save until the player acts
      loadError = e;
      game.reset(true);
    }
  } else {
    game.reset(true);
  }
  backfill.run(game);

  return {
    game,
    session,
    commands,
    statistics,
    achievementsListener,
    backfill,
    events,
    types,
    parseNumber: (value, unit) => parseNumber(value, unit),
    loadError,
  };
}
