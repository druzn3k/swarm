// The meat tab: the home burrow. Drones haul meat to the pile, queens lay,
// nests and hives fill the chamber, royalty takes the ledges, and the
// highest mind the swarm has grown floats glowing in the upper chamber.
import { Scene, W, H, shown } from "./base";
import type { Walker } from "./base";
import { spriteFor } from "../units";

const GROUND = 70;

/** the minds above hive empress, lowest first */
export const MINDS = ["prophet", "goddess", "pantheon", "pantheon2", "pantheon3", "pantheon4", "pantheon5", "overmind", "overmind2", "overmind3", "overmind4", "overmind5", "overmind6"];
const MIND_GLOW: Record<string, string> = { overmind: "#ff5a4f", overmind2: "#f2b33d", overmind3: "#9be36b", overmind4: "#7fd6e8", overmind5: "#c98cf0", overmind6: "#ffffff" };

export class MeatScene extends Scene {
  private drones: Walker[] = [];

  protected layout(): void {
    const want = shown(this.log("drone"), 4, 26);
    while (this.drones.length < want) this.drones.push(newDrone());
    this.drones.length = want;
  }

  protected burstPoint(unit: string): [number, number] {
    switch (unit) {
      case "drone":
        return [40, GROUND - 6];
      case "queen":
      case "greaterqueen":
        return [22, GROUND - 10];
      case "nest":
        return [70, GROUND - 14];
      case "hive":
        return [84, 30];
      case "hivequeen":
        return [130, 30];
      case "empress":
        return [30, 34];
      case "meat":
        return [126, GROUND - 6];
      default:
        return MINDS.includes(unit) ? [80, 12] : [80, 30];
    }
  }

  protected draw(ctx: CanvasRenderingContext2D, slow: number): void {
    const t = this.t;

    // the highest mind glows in the upper chamber; the one below it, faintly beside
    let top = -1;
    for (let i = MINDS.length - 1; i >= 0; i--)
      if (this.log(MINDS[i]) >= 0) {
        top = i;
        break;
      }
    if (top >= 0) {
      const name = MINDS[top];
      const s = this.sprite(name, 90, 0, slow);
      const bob = Math.round(Math.sin(t / 30) * 2) * slow;
      const pulse = 0.35 + 0.1 * Math.sin(t / 20) * slow;
      this.glow(ctx, 80, 12 + bob, 16, MIND_GLOW[name] ?? "#b67ad0", pulse);
      this.put(ctx, s, 80 - s.w / 2, 12 - s.h / 2 + 2 + bob);
      if (top > 0) {
        const lower = spriteFor(MINDS[top - 1]);
        ctx.globalAlpha = 0.55;
        this.put(ctx, lower, 52 - lower.w / 2, 14 - lower.h / 2 - bob);
        this.put(ctx, lower, 108 - lower.w / 2, 14 - lower.h / 2 - bob, { flip: true });
        ctx.globalAlpha = 1;
      }
    }

    // hives in the back wall
    const hive = spriteFor("hive");
    const hives = shown(this.log("hive"), 1, 3);
    for (let i = 0; i < hives; i++) this.put(ctx, hive, 96 - i * 22, 26 + (i % 2) * 4);

    // royalty on the ledges
    const hq = shown(this.log("hivequeen"), 1, 2);
    if (hq) ledge(ctx, 114, 36, 42);
    for (let i = 0; i < hq; i++) {
      const s = this.sprite("hivequeen", 40, i, slow);
      this.put(ctx, s, 116 + i * 19, 36 - s.h + Math.round(Math.sin(t / 25 + i)) * slow, { flip: i === 1 });
    }
    if (this.log("empress") >= 0) {
      const s = spriteFor("empress");
      ledge(ctx, 14, 46, 38);
      this.put(ctx, s, 22, 46 - s.h + Math.round(Math.sin(t / 35)) * slow);
    }

    // nests on the floor
    const nest = spriteFor("nest");
    const nests = shown(this.log("nest"), 1, 4);
    for (let i = 0; i < nests; i++) this.put(ctx, nest, 58 + i * 20 - (i % 2) * 6, GROUND - 8 + (i % 2));

    // meat pile
    const meat = spriteFor("meat");
    const chunks = Math.max(1, shown(this.log("meat"), 1.6, 14));
    for (let i = 0; i < chunks; i++) {
      const row = Math.floor((-1 + Math.sqrt(1 + 8 * i)) / 2); // triangular stacking
      const inRow = i - (row * (row + 1)) / 2;
      const x = 122 + inRow * 9 - row * 4 + (row % 2) * 2;
      this.put(ctx, meat, Math.min(x, W - 12), GROUND - 7 - row * 5);
    }

    // queens and greater queens by the egg chamber, laying
    const queens = shown(this.log("queen"), 1.5, 3);
    const gq = shown(this.log("greaterqueen"), 1, 2);
    for (let i = 0; i < queens + gq; i++) {
      const name = i < gq ? "greaterqueen" : "queen";
      const s = this.sprite(name, 24, i, slow);
      const bob = Math.round(Math.sin(t / 20 + i)) * slow;
      this.put(ctx, s, 4 + i * 13, GROUND - s.h - (i % 2) * 3 + bob);
      if (slow && (t + i * 40) % 160 === 0) this.dropEgg(12 + i * 13);
    }

    // larvae wriggle on the floor
    const larvae = shown(this.log("larva"), 2, 9);
    for (let i = 0; i < larvae; i++) {
      this.put(ctx, this.sprite("larva", 18, i, slow), 6 + ((i * 17) % 46), GROUND + 4 + (i % 3) * 3, { flip: i % 2 === 1 });
    }

    // drones walk to the meat pile and back
    for (const d of this.drones) {
      if (slow) step(d);
      const s = this.sprite("drone", 6, d.phase, slow);
      this.put(ctx, s, d.x, d.y, { flip: d.dir === 1 });
      if (d.carrying) {
        ctx.fillStyle = "#d2505b";
        ctx.fillRect(Math.round(d.x) + (d.dir === 1 ? 2 : 11), Math.round(d.y) + 1, 3, 2);
      }
    }

    if (slow) this.motes(ctx, "rgba(239,227,210,0.35)", 10, GROUND);
  }

  private dropEgg(x: number): void {
    for (let i = 0; i < 4; i++) this.spawn(x, GROUND - 2, (Math.random() - 0.5) * 0.3, -0.6, 0.06, 18, "#e2ecc0");
  }

  protected paintBackground(g: CanvasRenderingContext2D, r: () => number): void {
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
  }
}

function ledge(g: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  g.fillStyle = "#1b0f1f";
  g.fillRect(x - 1, y - 1, w + 2, 5);
  g.fillStyle = "#573645";
  g.fillRect(x, y, w, 3);
  g.fillStyle = "#6b4453";
  g.fillRect(x, y, w, 1);
  g.fillStyle = "#2e1b26";
  for (let i = 2; i < w - 2; i += 5) g.fillRect(x + i, y + 3, 2, 1 + (i % 3));
}

function newDrone(): Walker {
  return {
    name: "drone",
    x: 34 + Math.random() * 80,
    y: GROUND - 10 + Math.floor(Math.random() * 8),
    dir: Math.random() < 0.5 ? 1 : -1,
    speed: 0.25 + Math.random() * 0.3,
    carrying: Math.random() < 0.5,
    phase: Math.floor(Math.random() * 6),
  };
}

function step(d: Walker): void {
  d.x += d.dir * d.speed;
  if (d.x > 112) {
    d.dir = -1;
    d.carrying = true;
  } else if (d.x < 34) {
    d.dir = 1;
    d.carrying = false;
  }
}
