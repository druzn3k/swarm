// One engine instance plus a version counter that React subscribes to
// (useSyncExternalStore). The counter bumps after every tick and every
// command, so components re-read the game then. Framework-agnostic: React
// bindings live in ./GameContext.tsx.
import { createGame } from "@swarmsim/engine";
import type { Clock, Engine, SaveStorage } from "@swarmsim/engine";
import { computeWelcomeBack } from "./welcomeback";
import type { WelcomeBack } from "./welcomeback";
import { Autosave } from "./autosave";
import type { AutosaveHost } from "./autosave";

export { SAVE_MILLIS } from "./autosave";
export const SAVE_ID = "swarmhive-v1";
export const TICK_MILLIS = 100;
/** how often the "game is still open" time is stored, for welcome back (old: 60s) */
export const HEARTBEAT_MILLIS = 60000;

export interface GameStoreOptions {
  storage?: SaveStorage;
  now?: Clock;
  saveId?: string;
  /** a save string to import instead of loading the stored one */
  save?: string;
  /** show the welcome-back summary even after a short absence */
  forceWelcomeBack?: boolean;
}

export class GameStore {
  readonly engine: Engine;
  private version = 0;
  /** Counts player actions (act), so throttled readers can catch up at once. */
  actions = 0;
  private listeners = new Set<() => void>();
  /** offline gains since the game was last closed; null when there's nothing to show or it was dismissed */
  welcomeBack: WelcomeBack | null = null;

  constructor(opts: GameStoreOptions = {}) {
    this.engine = createGame({
      storage: opts.storage,
      now: opts.now,
      save: opts.save,
      saveId: opts.saveId ?? SAVE_ID,
    });
    const { events } = this.engine;
    // commands, achievements and resets all change what's on screen
    events.on("command", () => this.bump());
    events.on("achieve", () => this.bump());
    events.on("reset", () => this.bump());
    // computed before the first heartbeat, which would make it look like we never left
    this.welcomeBack = computeWelcomeBack(this.game, this.engine.session, { force: opts.forceWelcomeBack });
    events.on("import", (args: { success?: boolean } | undefined) => {
      if (args?.success) {
        this.welcomeBack = computeWelcomeBack(this.game, this.engine.session, { force: true, ignoreHeartbeat: true });
        this.bump();
      }
    });
    events.on("reset", () => {
      this.welcomeBack = null;
    });
  }

  dismissWelcomeBack(): void {
    this.welcomeBack = null;
    this.bump();
  }

  get game() {
    return this.engine.game;
  }
  get commands() {
    return this.engine.commands;
  }
  get events() {
    return this.engine.events;
  }

  // --- external store protocol (useSyncExternalStore) ---
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = (): number => this.version;

  /** Tell subscribers the game changed. Call after mutating the game outside commands. */
  bump(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  /** Advance the game clock to now. */
  tick(): void {
    try {
      this.game.tick();
    } catch (e) {
      // the clock went backwards by more than the engine tolerates; keep the old time
      console.warn("tick failed", e);
    }
    this.bump();
  }

  save(): void {
    try {
      this.game.save();
    } catch (e) {
      console.warn("save failed", e);
    }
  }

  /**
   * Run a player action (usually a `commands.*` call). Returns the error
   * instead of throwing, e.g. when the player can't afford it any more.
   */
  act(fn: (engine: Engine) => void): unknown {
    this.actions++;
    try {
      fn(this.engine);
      return undefined;
    } catch (e) {
      return e ?? new Error("action failed");
    } finally {
      this.bump();
    }
  }

  /**
   * Start ticking and autosaving in the browser. Returns a stop function.
   * Saves: the engine's own after player actions, a timed one in idle time
   * (see ./autosave.ts), and one when the page is hidden or closed. Ticks
   * stop while the page is hidden and catch up with one tick on return.
   */
  start(win: Window = window): () => void {
    // no ticks while the page is hidden: idle progress comes from elapsed
    // time, so one tick on return catches up exactly
    let tick = 0;
    const startTicking = () => {
      if (!tick) tick = win.setInterval(() => this.tick(), TICK_MILLIS);
    };
    const stopTicking = () => {
      if (tick) win.clearInterval(tick);
      tick = 0;
    };
    const autosave = new Autosave(() => this.save(), win as unknown as AutosaveHost);
    const offSaved = this.events.on("save", () => autosave.saved());
    const heartbeat = win.setInterval(() => this.engine.session.onHeartbeat(), HEARTBEAT_MILLIS);
    this.engine.session.onHeartbeat();
    const hidden = () => win.document.visibilityState === "hidden";
    const onVisibility = () => {
      if (hidden()) {
        stopTicking();
        autosave.flush();
        // nothing changes while hidden; the next timed save is 30s after coming back
        autosave.pause();
      } else {
        this.tick();
        startTicking();
        autosave.start();
      }
    };
    const onPageHide = () => {
      autosave.flush();
      this.engine.session.onClose();
    };
    win.document.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("pagehide", onPageHide);
    if (!hidden()) {
      startTicking();
      autosave.start();
    }
    this.tick();
    return () => {
      stopTicking();
      win.clearInterval(heartbeat);
      autosave.pause();
      offSaved();
      win.document.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("pagehide", onPageHide);
      this.save();
    };
  }
}
