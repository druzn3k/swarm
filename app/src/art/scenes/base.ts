// Shared machinery for the per-tab hive scenes: background caching, a fixed
// particle pool (no allocation per frame), counts on a log scale, and frame
// timing for two-frame idle animations.
import type { Sprite } from "../pixels";
import { framesFor } from "../units";
import { drawSprite } from "../draw";
import type { DrawOpts } from "../draw";

export const W = 160;
export const H = 84;

/** log10 of each unit's count (by unit name); -1 or missing when there are none */
export type Population = Record<string, number>;

export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** how many sprites to draw for a unit, given log10(count) */
export function shown(log10: number | undefined, perDecade: number, cap: number): number {
  if (log10 === undefined || !isFinite(log10) || log10 < 0) return 0;
  return Math.min(cap, 1 + Math.floor(log10 * perDecade));
}

/** the actual count for small numbers (e.g. 5 nexus), from log10 */
export function smallCount(log10: number | undefined): number {
  if (log10 === undefined || !isFinite(log10) || log10 < 0) return 0;
  return Math.round(Math.pow(10, log10));
}

const MAX_PARTICLES = 160;

export abstract class Scene {
  protected bg: HTMLCanvasElement;
  protected t = 0;
  protected pop: Population = {};
  /** prefers-reduced-motion: creatures stand still and no particles fly */
  reduced = false;

  private px = new Float32Array(MAX_PARTICLES);
  private py = new Float32Array(MAX_PARTICLES);
  private pvx = new Float32Array(MAX_PARTICLES);
  private pvy = new Float32Array(MAX_PARTICLES);
  private pg = new Float32Array(MAX_PARTICLES); // gravity
  private plife = new Float32Array(MAX_PARTICLES);
  private pcolor: string[] = new Array<string>(MAX_PARTICLES).fill("#fff");
  private pnext = 0;

  /** colours for this scene's buy bursts */
  protected burstColors = ["#f2b33d", "#e2ecc0", "#b67ad0", "#efe3d2"];

  constructor() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    this.paintBackground(c.getContext("2d")!, rng(7));
    this.bg = c;
  }

  protected abstract paintBackground(g: CanvasRenderingContext2D, r: () => number): void;
  protected abstract draw(ctx: CanvasRenderingContext2D, slow: number): void;
  /** where a unit of this kind lives in the scene, for its buy burst */
  protected abstract burstPoint(unit: string): [number, number];
  /** rebuild walkers etc. after the population changed */
  protected layout(): void {}

  setPopulation(pop: Population): void {
    this.pop = pop;
    this.layout();
  }

  protected log(name: string): number {
    const v = this.pop[name];
    return v === undefined ? -1 : v;
  }

  burst(unit: string): void {
    if (this.reduced) return;
    const [x, y] = this.burstPoint(unit);
    const colors = this.burstColors;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 1.2;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s - 0.8, 0.06, 30 + Math.random() * 20, colors[i % colors.length]);
    }
  }

  protected spawn(x: number, y: number, vx: number, vy: number, gravity: number, life: number, color: string): void {
    const i = this.pnext;
    this.pnext = (i + 1) % MAX_PARTICLES;
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.pg[i] = gravity;
    this.plife[i] = life;
    this.pcolor[i] = color;
  }

  frame(ctx: CanvasRenderingContext2D): void {
    this.t++;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0);
    const slow = this.reduced ? 0 : 1;
    this.draw(ctx, slow);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.plife[i] <= 0) continue;
      this.px[i] += this.pvx[i];
      this.py[i] += this.pvy[i];
      this.pvy[i] += this.pg[i];
      this.plife[i]--;
      ctx.fillStyle = this.pcolor[i];
      ctx.fillRect(Math.round(this.px[i]), Math.round(this.py[i]), 1, 1);
    }
  }

  /** the idle frame of a unit at this moment (two-frame animations) */
  protected sprite(name: string, period: number, phase = 0, slow = 1): Sprite {
    const fs = framesFor(name);
    if (fs.length < 2 || !slow) return fs[0];
    return fs[(Math.floor(this.t / period) + phase) & 1];
  }

  protected put(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, opts?: DrawOpts): void {
    drawSprite(ctx, s, x, y, opts);
  }

  /** a soft round glow: three stacked translucent discs, drawn row by row (no gradients to allocate) */
  protected glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, alpha: number): void {
    ctx.fillStyle = color;
    ctx.globalAlpha = Math.max(0, alpha) / 3;
    for (let i = 3; i >= 1; i--) {
      const rr = (r * i) / 3;
      const ry = Math.round(rr * 0.8);
      for (let dy = -ry; dy <= ry; dy++) {
        const half = Math.round(rr * Math.sqrt(1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5))));
        ctx.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** drifting dust motes */
  protected motes(ctx: CanvasRenderingContext2D, color: string, n: number, floor: number): void {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = (i * 37 + this.t * 0.15 * ((i % 3) + 1)) % W;
      const y = (i * 23 + Math.sin(this.t / 50 + i) * 6 + 40) % (floor - 4);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
}

/** a creature that walks back and forth (or marches across) the scene */
export interface Walker {
  name: string;
  x: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
  carrying: boolean;
}
