// The game for the UI: one wasm engine (a GameHandle) plus the latest View,
// and a version counter React subscribes to (useSyncExternalStore).
//
// Time: on each animation frame the store advances the engine by the
// monotonic time since the last frame (performance.now()), and once a second
// it hands the engine the wall clock (resync_wall), which adds time the
// monotonic clock missed (a suspended laptop). It takes a fresh view at most
// once per frame: every TICK_MILLIS while idle (the old 10 Hz tick), and at
// once after a player action. The view's request covers only what mounted
// components asked for (`need`): every unit's and upgrade's basics and the
// tabs, plus the details of the focused units and the optional sections.
//
// Saves: v2 text under SAVE_ID (see ./saves.ts for the v1 migration), written
// when the engine asks (`save_requested`, after purchases and option
// changes), on a timer in idle time (./autosave.ts), and when the page is
// hidden or closed, which also records the close time (mark_closed) for the
// next welcome back. Framework-agnostic: React bindings are ./GameContext.tsx.
import { GameHandle, detectSaveFormat } from "@swarmsim/engine-wasm";
import type { Command, CommandOutcome, Sections, UiState, UnitStats, View, ViewEvent, ViewRequest, WelcomeBack } from "@swarmsim/engine-wasm";
import { Autosave } from "./autosave";
import type { AutosaveHost } from "./autosave";
import { GameView, Statics } from "./view";
import { SAVE_ID, heartbeatKey, loadGame } from "./saves";
import type { LoadedGame } from "./saves";
import { memoryStorage } from "./storage";
import type { SaveStorage } from "./storage";

export { SAVE_MILLIS } from "./autosave";
export { SAVE_ID, LEGACY_SAVE_ID } from "./saves";
/** the idle view cadence (the old engine's tick) */
export const TICK_MILLIS = 100;
/** how often the wall clock is checked for time the monotonic clock missed */
export const RESYNC_MILLIS = 1000;
/** how often the "game is still open" time is stored, for welcome back (old: 60s) */
export const HEARTBEAT_MILLIS = 60000;

/** Optional parts of the view a component needs while mounted. */
export interface Need {
  /** units (names) whose details (production, stats, effects, upgrade estimates) to compute */
  focus?: readonly string[];
  /** optional sections */
  sections?: readonly ("achievements" | "ascension" | "statistics")[];
  /**
   * units (names) whose stats and production to read even though they are
   * never visible, so focusing them gives nothing (invisiblehatchery)
   */
  hidden?: readonly string[];
  /**
   * units (names) whose upgrades the view should list, or "all"; the focused
   * units' come anyway. Upgrades are most of a view's cost, so a view lists
   * only these (buy-all's lists still cover every upgrade).
   */
  upgrades?: readonly string[] | "all";
}

/** What the store tells listeners about besides re-renders. */
export interface StoreEvents {
  /** a purchase or other command; `unit` is the unit it was for (an upgrade's unit) */
  command: { name: string; unit?: string; upgrade?: string };
  /** an achievement was earned (its index) */
  achieve: number;
  /** a save was written */
  save: undefined;
}

type Listener<T> = (payload: T) => void;

export interface GameStoreOptions {
  storage?: SaveStorage;
  /** wall clock, epoch ms */
  now?: () => number;
  /** monotonic clock, ms (performance.now) */
  perfNow?: () => number;
  saveId?: string;
  legacySaveId?: string;
  /** a save string (v1 or v2) to load instead of the stored one */
  save?: string;
  /** show the welcome-back summary even after a short absence */
  forceWelcomeBack?: boolean;
}

export interface ActResult {
  error?: Error;
  outcome?: CommandOutcome;
}

const welcomeKey = (wb: WelcomeBack) => `${wb.closed_ms}:${wb.away_ms}:${wb.gains.length}`;

/** The bits of `window` start() uses (FakeWindow in tests). */
type Host = Window & { requestAnimationFrame?: Window["requestAnimationFrame"] };

export class GameStore {
  private handleRef: GameHandle;
  readonly statics: Statics;
  /** the latest view, and its facade */
  view!: View;
  g!: GameView;
  /** how the game was loaded (migration, new game...) */
  readonly loaded: LoadedGame["source"];
  private version = 0;
  /** Counts player actions (act), so throttled readers can catch up at once. */
  actions = 0;
  private listeners = new Set<() => void>();
  private eventListeners: Partial<Record<keyof StoreEvents, Set<Listener<never>>>> = {};
  /** offline gains since the game was last closed; null when there's nothing to show or it was dismissed */
  welcomeBack: WelcomeBack | null = null;
  /** a report that arrived while a modal was open; shown when the last one closes */
  private pendingWelcome: WelcomeBack | null = null;
  /** reports already shown (or dismissed), so one is never shown twice */
  private seenWelcome = new Set<string>();
  /** open modals (import/ascension confirms) that hold the welcome back back */
  private welcomeHolds = new Set<object>();
  /** the options bag and other UI state kept in the save */
  ui: UiState;
  /** the unit last opened on each tab (the old tab.lastselected) */
  readonly lastSelected = new Map<string, string>();
  readonly storage: SaveStorage;
  readonly saveId: string;
  private readonly now: () => number;
  readonly perfNow: () => number;
  private needs = new Map<object, Need>();
  private request: ViewRequest | null = null;
  private hiddenUnits: string[] = [];
  /** a view is due on the next frame (an action, a new need) */
  private dirty = false;
  private flushQueued = false;
  /** the request of the last view taken */
  private takenKey = "";
  private savedHook: (() => void) | null = null;
  /** the last swarmwarp length seen (velocity unit "warp") */
  warpSecs = 1;

  constructor(opts: GameStoreOptions = {}) {
    this.storage = opts.storage ?? memoryStorage();
    this.saveId = opts.saveId ?? SAVE_ID;
    this.now = opts.now ?? (() => Date.now());
    this.perfNow = opts.perfNow ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    const loaded: LoadedGame = opts.save
      ? { handle: GameHandle.load(opts.save, this.now()), source: "given" }
      : loadGame(this.storage, this.now(), this.saveId, opts.legacySaveId);
    this.handleRef = loaded.handle;
    this.loaded = loaded.source;
    this.statics = new Statics(this.handle.staticView());
    this.ui = this.handle.uiState();
    // one full view first: it fills in what never changes (achievement requirements)
    this.take({ detail_all: false });
    this.statics.learn(this.view);
    // computed at load, before the first heartbeat, which would make it look like we never left
    const first = opts.forceWelcomeBack ? this.handle.welcomeBack(true) : (this.view.welcome_back ?? null);
    this.welcomeBack = first;
    if (first) this.seenWelcome.add(welcomeKey(first));
    // the engine keeps the startup report in every view until dismissed
    if (this.view.welcome_back) this.seenWelcome.add(welcomeKey(this.view.welcome_back));
  }

  /**
   * Keep the welcome back from appearing while a modal (a confirm dialog) is
   * open; a report that arrives meanwhile shows when the last hold is released.
   */
  holdWelcome(key: object): () => void {
    this.welcomeHolds.add(key);
    return () => {
      if (!this.welcomeHolds.delete(key) || this.welcomeHolds.size > 0) return;
      const p = this.pendingWelcome;
      this.pendingWelcome = null;
      if (p && !this.welcomeBack) {
        this.welcomeBack = p;
        this.bump();
      }
    };
  }

  /** A report carried by a view: show it once, unless a modal is open or another is showing. */
  private offerWelcome(wb: WelcomeBack | undefined): void {
    if (!wb) return;
    const key = welcomeKey(wb);
    if (this.seenWelcome.has(key)) return;
    if (this.welcomeBack) return; // the one showing stays; this one is shown after its dismissal's view
    if (this.welcomeHolds.size > 0) {
      this.pendingWelcome = wb;
      return;
    }
    this.seenWelcome.add(key);
    this.welcomeBack = wb;
  }

  /** The engine. Replaced by an import: don't keep it. */
  get handle(): GameHandle {
    return this.handleRef;
  }

  // --- external store protocol (useSyncExternalStore) ---
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = (): number => this.version;

  /** Tell subscribers the game changed. */
  bump(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  on<K extends keyof StoreEvents>(name: K, fn: Listener<StoreEvents[K]>): () => void {
    const set = (this.eventListeners[name] ??= new Set()) as Set<Listener<StoreEvents[K]>>;
    set.add(fn);
    return () => void set.delete(fn);
  }
  private emit<K extends keyof StoreEvents>(name: K, payload: StoreEvents[K]): void {
    const set = this.eventListeners[name] as Set<Listener<StoreEvents[K]>> | undefined;
    for (const fn of [...(set ?? [])]) fn(payload);
  }

  // --- what the view covers ---

  /**
   * Ask for parts of the view while `key` holds them; returns the release.
   * A view covering new needs is taken in a microtask (before the browser
   * paints), once for all the components that mounted together.
   */
  need(key: object, need: Need): () => void {
    this.needs.set(key, need);
    this.request = null;
    // components mount together: one view for all of them, before the browser paints
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        if (JSON.stringify(this.viewRequest()) + this.hiddenUnits.join(",") !== this.takenKey) this.refresh();
      });
    }
    return () => {
      if (this.needs.get(key) === need) {
        this.needs.delete(key);
        this.request = null;
      }
    };
  }

  /** The request for the mounted components' needs. */
  viewRequest(): ViewRequest {
    if (this.request) return this.request;
    const focus = new Set<number>();
    const upgradesOf = new Set<number>();
    let allUpgrades = false;
    const sections: Partial<Sections> = { units: true, upgrades: true, tabs: true, achievements: false, ascension: false, statistics: false };
    const index = (names: readonly string[], into: Set<number>) => {
      for (const name of names) {
        const i = this.statics.unitIndex(name);
        if (i !== undefined) into.add(i);
      }
    };
    for (const n of this.needs.values()) {
      index(n.focus ?? [], focus);
      if (n.upgrades === "all") allUpgrades = true;
      else index(n.upgrades ?? [], upgradesOf);
      for (const s of n.sections ?? []) sections[s] = true;
    }
    const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);
    this.request = { focus: sorted(focus), sections, ...(allUpgrades ? {} : { upgrades_of: sorted(upgradesOf) }) };
    this.hiddenUnits = [...new Set([...this.needs.values()].flatMap((n) => n.hidden ?? []))];
    return this.request;
  }

  /** Take a view now (needs: the mounted components'); tells subscribers. */
  refresh(): void {
    this.take(this.viewRequest());
    this.bump();
  }

  private take(req: ViewRequest): void {
    this.dirty = false;
    this.takenKey = JSON.stringify(req) + this.hiddenUnits.join(",");
    const view = this.handle.view(req);
    this.view = view;
    const hidden = new Map<number, UnitStats>();
    for (const name of this.hiddenUnits) {
      const i = this.statics.unitIndex(name);
      if (i !== undefined) hidden.set(i, this.handle.unitStats(name));
    }
    this.g = new GameView(this.statics, view, hidden);
    this.offerWelcome(view.welcome_back);
    const warp = this.g.upgrade("swarmwarp").effects[0]?.v?.output;
    if (warp !== undefined) this.warpSecs = Number(warp) || 1;
    // one save for however many the commands asked for
    let save = false;
    for (const e of view.events ?? []) {
      if (e === "save_requested") save = true;
      else this.handleEvent(e);
    }
    if (save) this.save();
  }

  private handleEvent(e: Exclude<ViewEvent, "save_requested">): void {
    if ("command" in e) {
      const c = e.command;
      const upgrade = c.upgrade === undefined ? undefined : this.statics.upgrades[c.upgrade];
      const unit = c.unit !== undefined ? this.statics.units[c.unit]?.name : upgrade ? this.statics.units[upgrade.unit]?.name : undefined;
      this.emit("command", { name: c.name, unit, upgrade: upgrade?.name });
    } else if ("achieved" in e) {
      this.emit("achieve", e.achieved);
    } else if ("command_failed" in e) {
      console.warn("command failed:", e.command_failed);
    }
  }

  // --- time ---

  /** Move the engine's clock forward by a monotonic delta (ms). */
  advance(dtMs: number): void {
    if (dtMs > 0) this.handle.advance(dtMs);
  }

  /** Add wall-clock time the monotonic clock missed (suspend). True if there was some. */
  resync(): boolean {
    try {
      return this.handle.resyncWall(this.now()) != null;
    } catch (e) {
      console.warn("resync failed", e);
      return false;
    }
  }

  // --- saving ---

  /** Write the save (v2) now. */
  save(): void {
    try {
      this.storage.setItem(this.saveId, this.handle.exportV2(this.now()));
      this.emit("save", undefined);
      this.savedHook?.();
    } catch (e) {
      console.warn("save failed", e);
    }
  }

  /** Store the "still running" time, for welcome back after a crash or a missed pagehide. */
  heartbeat(): void {
    try {
      this.storage.setItem(heartbeatKey(this.saveId), String(Math.round(this.now())));
    } catch {
      /* heartbeats aren't critical */
    }
  }

  /** The page is going away or hidden: record when, and save. */
  close(): void {
    try {
      this.handle.markClosed(this.now());
    } catch (e) {
      console.warn("markClosed failed", e);
    }
    this.heartbeat();
  }

  /** The current game as a save: v2 by default, or the old game's format. */
  exportSave(format: "v2" | "v1" = "v2"): string {
    return format === "v1" ? this.handle.exportLegacy(this.now()) : this.handle.exportV2(this.now());
  }

  // --- player actions ---

  /**
   * Run player commands, in order, stopping at the first that fails (e.g.
   * the player can't afford it any more). Returns the error instead of
   * throwing, and the last outcome. Takes a fresh view at once (which writes
   * the save the commands asked for); subscribers hear about it once.
   */
  act(cmds: Command | readonly Command[]): ActResult {
    this.actions++;
    const list = Array.isArray(cmds) ? cmds : [cmds as Command];
    const result: ActResult = {};
    try {
      for (const cmd of list) result.outcome = this.handle.apply(cmd);
    } catch (e) {
      result.error = e instanceof Error ? e : new Error(String(e ?? "action failed"));
    }
    // options change by set_option, and come back with undo and reset
    if (list.some((c) => c.do === "set_option" || c.do === "reset" || c.do === "undo")) this.ui = this.handle.uiState();
    this.refresh();
    return result;
  }

  /** Set a key of the UI's options bag (saved with the game). */
  setOption(key: string, value: unknown): void {
    this.act({ do: "set_option", key, value });
  }

  dismissWelcomeBack(): void {
    if (this.welcomeBack) this.seenWelcome.add(welcomeKey(this.welcomeBack));
    this.welcomeBack = null;
    this.pendingWelcome = null;
    this.act({ do: "dismiss_welcome_back" });
  }

  /** Is this text a save we can load? Throws the reason if not. */
  checkSave(text: string): void {
    if (!detectSaveFormat(text)) throw new Error("not a Swarm Simulator save");
    GameHandle.load(text, this.now()).free();
  }

  /**
   * Replace the game with an imported save (v1 or v2): loaded like at
   * startup (backfill, offline time since it was saved), with a welcome back
   * for that time, and the old game's `import` event for its achievement.
   */
  importSave(text: string): ActResult {
    let next: GameHandle;
    try {
      next = GameHandle.load(text.trim(), this.now());
    } catch (e) {
      this.handle.apply({ do: "ui_event", name: "import", params: { source: "options", success: false } });
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
    const old = this.handleRef;
    this.handleRef = next;
    old.free();
    this.ui = next.uiState();
    this.lastSelected.clear();
    this.welcomeBack = next.welcomeBack(true);
    this.pendingWelcome = null;
    if (this.welcomeBack) this.seenWelcome.add(welcomeKey(this.welcomeBack));
    const result = this.act({ do: "ui_event", name: "import", params: { source: "options", success: true } });
    this.save();
    return result;
  }

  /** Start over: the stored save is deleted and a new game saved in its place. */
  reset(): void {
    this.storage.removeItem?.(this.saveId);
    this.welcomeBack = null;
    this.pendingWelcome = null;
    this.lastSelected.clear();
    this.act({ do: "reset" });
    this.save();
  }

  // --- the loop ---

  /** One animation frame: advance, now and then resync, and take a view when due. */
  frame(state: { last: number; lastView: number; lastResync: number }): void {
    const p = this.perfNow();
    this.advance(p - state.last);
    state.last = p;
    if (p - state.lastResync >= RESYNC_MILLIS) {
      state.lastResync = p;
      if (this.resync()) this.dirty = true;
    }
    // (a few ms early is on time: 100ms is six 60 Hz frames, give or take)
    if (this.dirty || p - state.lastView >= TICK_MILLIS - 4) {
      state.lastView = p;
      if (typeof globalThis !== "undefined" && (globalThis as { __SWARM_BENCH__?: boolean }).__SWARM_BENCH__) console.timeStamp?.("tick");
      this.refresh();
    }
  }

  /**
   * Start the frame loop, autosaving and heartbeats in the browser. Returns a
   * stop function. Frames stop while the page is hidden (browsers pause
   * animation frames anyway); on return the first frame advances by the
   * whole time away and resyncs, so the game catches up at once.
   */
  start(win: Host = window): () => void {
    const raf = win.requestAnimationFrame ? (fn: () => void) => win.requestAnimationFrame(fn) : (fn: () => void) => win.setTimeout(fn, 16);
    const caf = win.cancelAnimationFrame ? (id: number) => win.cancelAnimationFrame(id) : (id: number) => win.clearTimeout(id);
    const state = { last: this.perfNow(), lastView: -Infinity, lastResync: this.perfNow() };
    let id = 0;
    const loop = () => {
      id = 0;
      this.frame(state);
      id = raf(loop);
    };
    const startLoop = () => {
      if (!id) id = raf(loop);
    };
    const stopLoop = () => {
      if (id) caf(id);
      id = 0;
    };
    const autosave = new Autosave(() => this.save(), win as unknown as AutosaveHost, this.now);
    this.savedHook = () => autosave.saved();
    const heartbeat = win.setInterval(() => this.heartbeat(), HEARTBEAT_MILLIS);
    this.heartbeat();
    const hidden = () => win.document.visibilityState === "hidden";
    const onVisibility = () => {
      if (hidden()) {
        stopLoop();
        this.close();
        autosave.flush();
        // nothing changes while hidden; the next timed save is 30s after coming back
        autosave.pause();
      } else {
        this.frame(state);
        startLoop();
        autosave.start();
      }
    };
    const onPageHide = () => {
      this.close();
      autosave.flush();
    };
    win.document.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("pagehide", onPageHide);
    if (!hidden()) {
      startLoop();
      autosave.start();
    }
    this.frame(state);
    return () => {
      stopLoop();
      win.clearInterval(heartbeat);
      autosave.pause();
      this.savedHook = null;
      win.document.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("pagehide", onPageHide);
      this.save();
    };
  }
}
