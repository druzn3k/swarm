// The hive scene: a small pixel canvas that shows the swarm. Real counts get
// huge (trillions), so each kind of creature is drawn on a log scale with a
// cap, and new kinds appear as they're unlocked.
import { BASE, drawSprite, spriteFor } from "./sprites";

export const W = 160;
export const H = 84;
const GROUND = 70;

export interface Population {
  meat: number; // log10 of each count, so huge numbers stay finite
  larva: number;
  drone: number;
  queen: number;
  nest: number;
  greaterqueen: number;
  hive: number;
  beyond: string | null; // highest unlocked unit above hive, if any
}

interface Walker {
  x: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  carrying: boolean;
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** how many sprites to draw for a unit, given log10(count) */
function shown(log10: number, perDecade: number, cap: number): number {
  if (!isFinite(log10) || log10 < 0) return 0;
  return Math.min(cap, 1 + Math.floor(log10 * perDecade));
}

export class HiveScene {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private drones: Walker[] = [];
  private particles: Particle[] = [];
  private pop: Population = { meat: 1.5, larva: 1, drone: -1, queen: -1, nest: -1, greaterqueen: -1, hive: -1, beyond: null };
  private t = 0;
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d")!;
    this.bg = this.paintBackground();
  }

  setPopulation(pop: Population): void {
    this.pop = pop;
    const want = shown(pop.drone, 4, 26);
    while (this.drones.length < want) this.drones.push(this.newDrone(true));
    this.drones.length = want;
  }

  /** a little hatching burst where a unit of this kind lives */
  burst(unit: string): void {
    const at: Record<string, [number, number]> = {
      drone: [40, GROUND - 6],
      queen: [22, GROUND - 10],
      nest: [70, GROUND - 14],
      meat: [126, GROUND - 6],
    };
    const [x, y] = at[unit] ?? [80, 30];
    const colors = ["#f2b33d", "#e2ecc0", "#b67ad0", "#efe3d2"];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 1.2;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.8, life: 30 + Math.random() * 20, color: colors[i % colors.length] });
    }
  }

  frame(): void {
    this.t++;
    const ctx = this.ctx;
    ctx.drawImage(this.bg, 0, 0);
    const p = this.pop;
    const slow = this.reduced ? 0 : 1;

    // beyond-hive minds glow in the upper chamber
    if (p.beyond) {
      const s = spriteFor(p.beyond);
      const bob = Math.round(Math.sin(this.t / 30) * 2) * slow;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#b67ad0";
      ctx.fillRect(66, 8 + bob, 28, 22);
      ctx.globalAlpha = 1;
      drawSprite(ctx, s, 80 - s.w / 2, 14 + bob);
    }

    // hives in the back wall
    const hives = shown(p.hive, 1, 3);
    for (let i = 0; i < hives; i++) drawSprite(ctx, BASE.hive, 96 - i * 22, 24 + (i % 2) * 4);

    // nests on the floor
    const nests = shown(p.nest, 1, 4);
    for (let i = 0; i < nests; i++) drawSprite(ctx, BASE.nest, 58 + i * 20 - (i % 2) * 6, GROUND - 8 + (i % 2));

    // meat pile
    const chunks = Math.max(1, shown(p.meat, 1.6, 14));
    for (let i = 0; i < chunks; i++) {
      const row = Math.floor((-1 + Math.sqrt(1 + 8 * i)) / 2); // triangular stacking
      const inRow = i - (row * (row + 1)) / 2;
      const x = 122 + inRow * 9 - row * 4 + (row % 2) * 2;
      const y = GROUND - 7 - row * 5;
      drawSprite(ctx, BASE.meat, Math.min(x, W - 12), y);
    }

    // queens by the egg chamber, laying
    const queens = shown(p.queen, 1.5, 3);
    const gq = shown(p.greaterqueen, 1, 2);
    for (let i = 0; i < queens + gq; i++) {
      const s = i < gq ? spriteFor("greaterqueen") : BASE.queen;
      const bob = Math.round(Math.sin(this.t / 20 + i) * 1) * slow;
      drawSprite(ctx, s, 6 + i * 13, GROUND - 12 - (i % 2) * 3 + bob);
      if (slow && (this.t + i * 40) % 160 === 0) this.dropEgg(14 + i * 13);
    }

    // larvae wriggle on the floor
    const larvae = shown(p.larva, 2, 9);
    for (let i = 0; i < larvae; i++) {
      const s = (Math.floor(this.t / 18) + i) % 2 === 0 || !slow ? BASE.larvaA : BASE.larvaB;
      drawSprite(ctx, s, 6 + ((i * 17) % 46), GROUND + 4 + (i % 3) * 3, { flip: i % 2 === 1 });
    }

    // drones walk to the meat pile and back
    for (const d of this.drones) {
      if (slow) this.step(d);
      const s = Math.floor(this.t / 6 + d.phase) % 2 === 0 ? BASE.droneA : BASE.droneB;
      drawSprite(ctx, s, d.x, d.y, { flip: d.dir === 1 });
      if (d.carrying) {
        ctx.fillStyle = "#d2505b";
        ctx.fillRect(Math.round(d.x) + (d.dir === 1 ? 2 : 11), Math.round(d.y) + 1, 3, 2);
      }
    }

    // particles
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const q of this.particles) {
      q.x += q.vx;
      q.y += q.vy;
      q.vy += 0.06;
      q.life--;
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
    }

    // dust motes
    if (slow) {
      ctx.fillStyle = "rgba(239,227,210,0.35)";
      for (let i = 0; i < 10; i++) {
        const x = (i * 37 + this.t * 0.15 * ((i % 3) + 1)) % W;
        const y = (i * 23 + Math.sin(this.t / 50 + i) * 6 + 40) % (GROUND - 4);
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
  }

  private newDrone(scatter: boolean): Walker {
    return {
      x: scatter ? 34 + Math.random() * 80 : 34,
      y: GROUND - 10 + Math.floor(Math.random() * 8),
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: 0.25 + Math.random() * 0.3,
      carrying: Math.random() < 0.5,
      phase: Math.floor(Math.random() * 6),
    };
  }

  private step(d: Walker): void {
    d.x += d.dir * d.speed;
    if (d.x > 112) {
      d.dir = -1;
      d.carrying = true;
    } else if (d.x < 34) {
      d.dir = 1;
      d.carrying = false;
    }
  }

  private dropEgg(x: number): void {
    for (let i = 0; i < 4; i++) {
      this.particles.push({ x, y: GROUND - 2, vx: (Math.random() - 0.5) * 0.3, vy: -0.6, life: 18, color: "#e2ecc0" });
    }
  }

  private paintBackground(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    const r = rng(7);
    // earth bands, darker toward the surface
    const bands = ["#140b14", "#1a0f1a", "#21131f", "#281725", "#2e1b26"];
    for (let y = 0; y < H; y++) {
      g.fillStyle = bands[Math.min(bands.length - 1, Math.floor((y / H) * bands.length))];
      g.fillRect(0, y, W, 1);
    }
    // the chamber: a rounded hollow
    g.fillStyle = "#3a2231";
    for (let y = 6; y < GROUND + 14; y++) {
      const t = (y - 6) / (GROUND + 8);
      const half = Math.sqrt(Math.max(0, 1 - Math.pow(1 - t, 2))) * 78;
      g.fillRect(Math.round(80 - half), y, Math.round(half * 2), 1);
    }
    // floor
    g.fillStyle = "#4b2d3b";
    g.fillRect(0, GROUND + 2, W, H - GROUND - 2);
    g.fillStyle = "#573645";
    for (let x = 0; x < W; x += 2) if (r() < 0.5) g.fillRect(x, GROUND + 2, 2, 1);
    // pebbles and grit
    const grit = ["#573645", "#6b4453", "#24141e"];
    for (let i = 0; i < 160; i++) {
      g.fillStyle = grit[i % grit.length];
      g.fillRect(Math.floor(r() * W), Math.floor(r() * H), 1, 1);
    }
    // roots hanging from the ceiling
    g.fillStyle = "#5c3a2a";
    for (let i = 0; i < 7; i++) {
      let x = 12 + Math.floor(r() * (W - 24));
      const len = 4 + Math.floor(r() * 10);
      for (let y = 4; y < 4 + len; y++) {
        if (r() < 0.25) x += r() < 0.5 ? -1 : 1;
        g.fillRect(x, y, 1, 1);
      }
    }
    // glowing fungus near the floor
    for (let i = 0; i < 6; i++) {
      const x = 4 + Math.floor(r() * (W - 8));
      g.fillStyle = "rgba(127,214,232,0.18)";
      g.fillRect(x - 1, GROUND + 1, 4, 2);
      g.fillStyle = "#7fd6e8";
      g.fillRect(x, GROUND + 1, 1, 1);
      g.fillRect(x + 1, GROUND, 1, 1);
    }
    return c;
  }
}

