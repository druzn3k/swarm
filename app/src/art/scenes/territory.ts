// The territory tab: the surface at dusk. The war band marches across the
// field, fliers overhead, a devourer bursting from the earth now and then,
// and the swarm's banners planted on the conquered hills.
import { Scene, W, H, shown } from "./base";
import type { Walker } from "./base";
import { spriteFor } from "../units";

const GROUND = 66;

/** marching units: [name, sprites per decade, cap, flies] */
const ARMY: [string, number, number, boolean][] = [
  ["swarmling", 1.2, 6, false],
  ["stinger", 1, 4, true],
  ["spider", 1, 3, false],
  ["mosquito", 1, 3, true],
  ["locust", 1, 3, false],
  ["roach", 1, 3, false],
  ["giantspider", 0.7, 2, false],
  ["centipede", 0.7, 2, false],
  ["wasp", 0.7, 2, true],
  ["goon", 0.7, 2, true],
];
const MAX_ARMY = 26;

export class TerritoryScene extends Scene {
  protected burstColors = ["#d2505b", "#f2b33d", "#efe3d2", "#b67ad0"];
  private army: Walker[] = [];
  private flies: boolean[] = [];

  protected layout(): void {
    const army: Walker[] = [];
    const flies: boolean[] = [];
    let seed = 0;
    for (const [name, per, cap, fly] of ARMY) {
      const n = shown(this.log(name), per, cap);
      for (let i = 0; i < n && army.length < MAX_ARMY; i++) {
        seed++;
        const old = this.army.find((w) => w.name === name && !army.includes(w));
        army.push(
          old ?? {
            name,
            x: ((seed * 47) % (W + 30)) - 20,
            y: fly ? 10 + ((seed * 13) % 30) : GROUND - spriteFor(name).h + 2 + ((seed * 5) % 9),
            dir: 1,
            speed: (fly ? 0.35 : 0.22) + ((seed * 7) % 5) * 0.03,
            phase: seed,
            carrying: false,
          }
        );
        flies.push(fly);
      }
    }
    // ground units drawn back to front
    const order = army.map((_, i) => i).sort((a, b) => army[a].y + spriteFor(army[a].name).h - (army[b].y + spriteFor(army[b].name).h));
    this.army = order.map((i) => army[i]);
    this.flies = order.map((i) => flies[i]);
  }

  protected burstPoint(unit: string): [number, number] {
    if (unit === "territory") return [130, 40];
    const w = this.army.find((a) => a.name === unit);
    return w ? [w.x + 8, w.y + 4] : [60, GROUND - 6];
  }

  protected draw(ctx: CanvasRenderingContext2D, slow: number): void {
    const t = this.t;

    // banners on the conquered hills
    const flag = spriteFor("territory");
    const flags = shown(this.log("territory"), 1, 5);
    for (let i = 0; i < flags; i++) {
      const [x, y] = FLAGS[i];
      this.put(ctx, flag, x, y - flag.h);
    }

    // the devourer surfaces now and then
    if (this.log("devourer") >= 0) {
      const s = spriteFor("devourer");
      const cycle = slow ? t % 400 : 100;
      const rise = cycle < 200 ? Math.min(1, cycle / 50, (200 - cycle) / 50) : 0;
      if (rise > 0) {
        const x = 96;
        const top = GROUND + 6 - Math.round(rise * (s.h - 2));
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, GROUND + 6);
        ctx.clip();
        this.put(ctx, s, x, top);
        ctx.restore();
        if (slow && cycle === 10) for (let k = 0; k < 10; k++) this.spawn(x + 9, GROUND + 4, (Math.random() - 0.5) * 1.6, -1 - Math.random(), 0.08, 30, k % 2 ? "#6b4453" : "#4b2d3b");
      }
    }

    // the war band marches right
    for (let i = 0; i < this.army.length; i++) {
      const w = this.army[i];
      const fly = this.flies[i];
      if (slow) {
        w.x += w.speed;
        if (w.x > W + 4) w.x = -24;
      }
      const s = this.sprite(w.name, fly ? 4 : 7, w.phase, slow);
      const bob = fly && slow ? Math.round(Math.sin(t / 12 + w.phase) * 2) : 0;
      if (fly) {
        ctx.fillStyle = "rgba(11,6,11,0.35)";
        ctx.fillRect(Math.round(w.x) + 3, GROUND + 4 + (w.phase % 6), s.w - 6, 1);
      }
      this.put(ctx, s, w.x, w.y + bob, { flip: true });
    }

    // embers drift up from the battlefield
    if (slow && t % 9 === 0 && this.army.length) {
      this.spawn(Math.random() * W, GROUND + 2, (Math.random() - 0.5) * 0.2, -0.3 - Math.random() * 0.3, 0, 60, "#f2b33d");
    }
  }

  protected paintBackground(g: CanvasRenderingContext2D, r: () => number): void {
    // dusk sky
    const sky = ["#140a22", "#1d0f2e", "#2a1438", "#3c1a3e", "#55223f", "#702c3c", "#8a3a38"];
    for (let y = 0; y < GROUND; y++) {
      g.fillStyle = sky[Math.min(sky.length - 1, Math.floor((y / 56) * sky.length))];
      g.fillRect(0, y, W, 1);
    }
    // stars
    for (let i = 0; i < 40; i++) {
      g.fillStyle = i % 4 ? "rgba(239,227,210,0.5)" : "#efe3d2";
      g.fillRect(Math.floor(r() * W), Math.floor(r() * 30), 1, 1);
    }
    // a low red sun
    g.fillStyle = "#c9503a";
    for (let y = -9; y <= 9; y++) {
      const half = Math.round(Math.sqrt(81 - y * y));
      g.fillRect(40 - half, 48 + y, half * 2, 1);
    }
    g.fillStyle = "#e0703f";
    for (let y = -6; y <= 6; y++) {
      const half = Math.round(Math.sqrt(36 - y * y));
      g.fillRect(38 - half, 46 + y, half * 2, 1);
    }
    // far hills, near hills
    ridge(g, r, "#2a1430", 46, 8, 0.05);
    ridge(g, r, "#1f1024", 54, 6, 0.09);
    // the conquered hills on the right
    g.fillStyle = "#2a1a1c";
    for (let x = 100; x < W; x++) {
      const y = Math.round(44 + Math.pow((x - 100) / 60, 0.5) * -6 + Math.sin(x / 9) * 2);
      g.fillRect(x, y, 1, GROUND - y);
    }
    // the field
    const field = ["#3b2a1f", "#33231b", "#2b1d17", "#241812"];
    for (let y = GROUND - 8; y < H; y++) {
      g.fillStyle = field[Math.min(field.length - 1, Math.floor(((y - GROUND + 8) / (H - GROUND + 8)) * field.length))];
      g.fillRect(0, y, W, 1);
    }
    g.fillStyle = "#4a3a24";
    g.fillRect(0, GROUND - 8, W, 1);
    // grass tufts and stones
    for (let i = 0; i < 50; i++) {
      const x = Math.floor(r() * W);
      const y = GROUND - 7 + Math.floor(r() * (H - GROUND + 6));
      g.fillStyle = i % 3 ? "#5a6a2a" : "#7a8a3a";
      g.fillRect(x, y, 1, 2);
      g.fillRect(x + 1, y + 1, 1, 1);
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = i % 2 ? "#4b3a2e" : "#1a100c";
      g.fillRect(Math.floor(r() * W), GROUND - 6 + Math.floor(r() * (H - GROUND + 6)), 2, 1);
    }
  }
}

const FLAGS: [number, number][] = [
  [132, 42],
  [114, 45],
  [146, 40],
  [104, 48],
  [124, 44],
];

function ridge(g: CanvasRenderingContext2D, r: () => number, color: string, base: number, amp: number, freq: number): void {
  g.fillStyle = color;
  const ph = r() * 10;
  for (let x = 0; x < W; x++) {
    const y = Math.round(base - amp * (0.5 + 0.5 * Math.sin(x * freq + ph)) - (amp / 3) * Math.sin(x * freq * 2.7 + ph));
    g.fillRect(x, y, 1, GROUND - y);
  }
}
