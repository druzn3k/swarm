// When to autosave. The engine already saves after every purchase, ability,
// ascension, undo and option change (like the old game, which had no timed
// save at all); this only keeps idle progress fresh. A timed save waits until
// SAVE_MILLIS have passed since the last save of any kind, then runs in idle
// time so it doesn't land in the middle of a tick or a tap.
export const SAVE_MILLIS = 30000;
/** the longest a due save waits for idle time */
export const SAVE_IDLE_TIMEOUT_MILLIS = 5000;

/** The bits of `window` the scheduler uses (injectable for tests). */
export interface AutosaveHost {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  requestIdleCallback?(fn: () => void, opts?: { timeout: number }): number;
  cancelIdleCallback?(id: number): void;
}

export class Autosave {
  private timer: number | null = null;
  private idle: { id: number; ric: boolean } | null = null;
  private lastSave: number;
  private paused = false;

  constructor(
    private readonly save: () => void,
    private readonly host: AutosaveHost,
    private readonly now: () => number = () => Date.now(),
    private readonly every = SAVE_MILLIS
  ) {
    this.lastSave = now();
  }

  /** Start the timed saves. */
  start(): void {
    this.paused = false;
    this.schedule();
  }

  /** Stop the timed saves, e.g. while the page is hidden (nothing changes then). */
  pause(): void {
    this.paused = true;
    this.cancel();
  }

  /** A save happened (any kind, e.g. after a purchase): the next timed save is SAVE_MILLIS from now. */
  saved(): void {
    this.lastSave = this.now();
    if (!this.paused) this.schedule();
  }

  /** Save right now (page hidden or closing), dropping a pending timed save. */
  flush(): void {
    this.cancel();
    this.save();
    // the save's own "save" event normally calls saved(); don't depend on it (a failed write emits none)
    this.lastSave = this.now();
    if (!this.paused) this.schedule();
  }

  private schedule(): void {
    this.cancel();
    const wait = Math.max(0, this.lastSave + this.every - this.now());
    this.timer = this.host.setTimeout(() => {
      this.timer = null;
      this.whenIdle();
    }, wait);
  }

  private whenIdle(): void {
    const run = () => {
      this.idle = null;
      this.flush();
    };
    if (this.host.requestIdleCallback) {
      this.idle = { id: this.host.requestIdleCallback(run, { timeout: SAVE_IDLE_TIMEOUT_MILLIS }), ric: true };
    } else {
      // no requestIdleCallback (Safari): next task, at least not inside a tick or a tap
      this.idle = { id: this.host.setTimeout(run, 1), ric: false };
    }
  }

  private cancel(): void {
    if (this.timer != null) this.host.clearTimeout(this.timer);
    this.timer = null;
    if (this.idle) {
      if (this.idle.ric) this.host.cancelIdleCallback?.(this.idle.id);
      else this.host.clearTimeout(this.idle.id);
    }
    this.idle = null;
  }
}
