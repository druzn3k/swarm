// The hive's animation clock. Scenes move one step per frame and were tuned
// at 60 frames a second; drawing all 60 is wasted battery for pixel art that
// moves a pixel at a time. The animator draws about 20 times a second and
// advances the scene by the number of 60 Hz steps that really passed, so
// creatures move at the same speed in wall-clock time (also on 120 Hz
// screens, where they used to run twice as fast). It stops while the canvas
// is off screen or the page is hidden, and starts again from the current
// moment (no burst of catch-up steps).

/** one scene step: the scenes were tuned for 60 frames a second */
export const STEP_MILLIS = 1000 / 60;
/** time between redraws: about 20 frames a second */
export const DRAW_MILLIS = 50;
/** after a long stall (a busy main thread), skip ahead at most this many steps */
export const MAX_STEPS = 30;

export interface AnimatorHost {
  now(): number;
  requestAnimationFrame(fn: () => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export type PauseReason = "offscreen" | "hidden" | "reduced";

export class Animator {
  private raf = 0;
  private timer = 0;
  private last = 0;
  private acc = 0;
  private lastDraw = -Infinity;
  private reasons = new Set<PauseReason>();
  private running = false;
  private started = false;

  /** `draw(steps)` advances the scene `steps` steps and draws the last one. */
  constructor(
    private readonly draw: (steps: number) => void,
    private readonly host: AnimatorHost
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Pause for a reason (or clear it); the animation runs while no reason is set. */
  set(reason: PauseReason, paused: boolean): void {
    if (paused) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.update();
  }

  /** Start (now, or once no pause reason is left). */
  start(): void {
    this.started = true;
    this.update();
  }

  stop(): void {
    this.started = false;
    this.update();
  }

  private update(): void {
    const run = this.started && this.reasons.size === 0;
    if (run === this.running) return;
    if (!run) {
      this.running = false;
      this.cancel();
      return;
    }
    this.running = true;
    this.last = this.host.now();
    this.lastDraw = -Infinity;
    // the first frame comes at once, one step on
    this.acc = STEP_MILLIS;
    this.raf = this.host.requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    this.raf = 0;
    if (!this.running) return;
    const now = this.host.now();
    // on a fast screen the timer can end a display frame early: wait for the next one
    if (now - this.lastDraw < DRAW_MILLIS - 2) {
      this.raf = this.host.requestAnimationFrame(this.frame);
      return;
    }
    this.lastDraw = now;
    this.acc += now - this.last;
    this.last = now;
    // a hair of slack, so a frame that lands a fraction of a millisecond early still counts its step
    let steps = Math.floor(this.acc / STEP_MILLIS + 1e-6);
    this.acc = Math.max(0, this.acc - steps * STEP_MILLIS);
    if (steps > MAX_STEPS) {
      steps = MAX_STEPS;
      this.acc = 0;
    }
    if (steps > 0) this.draw(steps);
    // wait most of the interval in a timer (the main thread sleeps), then draw on the next display frame
    this.timer = this.host.setTimeout(() => {
      this.timer = 0;
      if (this.running) this.raf = this.host.requestAnimationFrame(this.frame);
    }, DRAW_MILLIS - STEP_MILLIS);
  };

  private cancel(): void {
    if (this.raf) this.host.cancelAnimationFrame(this.raf);
    if (this.timer) this.host.clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }
}

/** A drawing context that draws nothing, for the steps between two redraws. */
export const NULL_CONTEXT = {
  fillStyle: "",
  globalAlpha: 1,
  imageSmoothingEnabled: false,
  fillRect() {},
  drawImage() {},
  save() {},
  restore() {},
  beginPath() {},
  rect() {},
  clip() {},
} as unknown as CanvasRenderingContext2D;
