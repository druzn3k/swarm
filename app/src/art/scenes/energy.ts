// The energy tab: the nexus chamber. Crystal spires float over rune stones
// and pulse with light, sparks of energy rise into them, crystals grow from
// the floor, nightbugs blink, moths circle the glow and bats hang overhead.
import { Scene, W, H, shown, smallCount } from "./base";
import { PROPS, spriteFor } from "../units";

const GROUND = 72;
/** nexus spots, in build order: centre first */
const SPIRES: [number, number][] = [
  [80, 4],
  [50, 0],
  [110, 0],
  [26, 0],
  [134, 0],
];

export class EnergyScene extends Scene {
  protected burstColors = ["#7fd6e8", "#d9eef5", "#3b8fa8", "#ffffff"];

  protected burstPoint(unit: string): [number, number] {
    switch (unit) {
      case "crystal":
        return [30, GROUND - 4];
      case "nightbug":
      case "moth":
        return [80, 30];
      case "bat":
        return [60, 8];
      default:
        return [80, 34];
    }
  }

  protected draw(ctx: CanvasRenderingContext2D, slow: number): void {
    const t = this.t;
    const nexus = spriteFor("nexus");
    const spires = Math.min(5, Math.max(1, smallCount(this.log("nexus"))));
    const lit = this.log("nexus") >= 0;
    const energy = shown(this.log("energy"), 1, 6);

    // bats hang from the ceiling, now and then flexing their wings
    const bats = shown(this.log("bat"), 1, 6);
    for (let i = 0; i < bats; i++) {
      const x = 14 + ((i * 47) % 130);
      const flap = slow && (t + i * 97) % 300 < 16;
      if (flap) {
        const s = this.sprite("bat", 4, i, slow);
        this.put(ctx, s, x - 7, 4);
      } else {
        this.put(ctx, PROPS.batHang, x, 3 + (i % 2), { flip: i % 2 === 1 });
      }
    }

    // nexus spires, each pulsing with its own glow
    for (let i = 0; i < spires; i++) {
      const [cx, dy] = SPIRES[i];
      const float = Math.round(Math.sin(t / 25 + i) * 1.5) * slow;
      const y = GROUND - nexus.h + 2 - dy;
      if (lit) this.glow(ctx, cx, y + 6 + float, i === 0 ? 14 : 10, "#7fd6e8", 0.25 + 0.12 * Math.sin(t / 15 + i) * slow + energy * 0.02);
      this.put(ctx, nexus, cx - Math.floor(nexus.w / 2), y + float);
      if (!lit) {
        ctx.fillStyle = "rgba(11,6,11,0.5)";
        ctx.fillRect(cx - 6, y, 13, 11);
      }
    }

    // energy sparks rise into the centre spire
    if (slow && lit && t % Math.max(3, 14 - energy * 2) === 0) {
      const x = 10 + Math.random() * (W - 20);
      const dx = (80 - x) / 70;
      this.spawn(x, GROUND - 2, dx, -0.55, 0, 70, Math.random() < 0.5 ? "#7fd6e8" : "#d9eef5");
    }

    // crystals grow from the floor
    const crystal = spriteFor("crystal");
    const crystals = shown(this.log("crystal"), 1, 6);
    for (let i = 0; i < crystals; i++) {
      const [x, y] = CRYSTALS[i];
      this.put(ctx, crystal, x, GROUND - crystal.h + 3 + y);
    }

    // moths circle the light
    const moths = shown(this.log("moth"), 1, 4);
    for (let i = 0; i < moths; i++) {
      const a = (slow ? t / 70 : 0) + (i * Math.PI * 2) / Math.max(1, moths);
      const s = this.sprite("moth", 5, i, slow);
      this.put(ctx, s, 80 + Math.cos(a) * 46 - s.w / 2, 30 + Math.sin(a) * 14 - s.h / 2, { flip: Math.sin(a) > 0 });
    }

    // nightbugs drift and blink
    const bugs = shown(this.log("nightbug"), 1.5, 6);
    for (let i = 0; i < bugs; i++) {
      const x = ((i * 61 + (slow ? t * (0.12 + (i % 3) * 0.05) : 0)) % (W + 20)) - 10;
      const y = 22 + ((i * 17) % 30) + Math.round(Math.sin(t / 30 + i * 2) * 3) * slow;
      const on = !slow || (t + i * 37) % 90 < 60;
      if (on) this.glow(ctx, x + 10, y + 4, 5, "#f4ff8f", 0.45);
      this.put(ctx, this.sprite("nightbug", 1000, on ? 0 : 1, 1), x, y, { flip: true });
    }

    if (slow) this.motes(ctx, "rgba(127,214,232,0.35)", 10, GROUND);
  }

  protected paintBackground(g: CanvasRenderingContext2D, r: () => number): void {
    const bands = ["#0b0d1c", "#0f1326", "#131a30", "#17203a", "#1b2442"];
    for (let y = 0; y < H; y++) {
      g.fillStyle = bands[Math.min(bands.length - 1, Math.floor((y / H) * bands.length))];
      g.fillRect(0, y, W, 1);
    }
    // the cavern hollow
    g.fillStyle = "#1f2a4a";
    for (let y = 4; y < GROUND + 10; y++) {
      const t = (y - 4) / (GROUND + 6);
      const half = Math.sqrt(Math.max(0, 1 - Math.pow(1 - t, 2))) * 80;
      g.fillRect(Math.round(80 - half), y, Math.round(half * 2), 1);
    }
    // crystal veins in the walls
    for (let i = 0; i < 9; i++) {
      let x = Math.floor(r() * W);
      let y = Math.floor(r() * 50);
      const len = 6 + Math.floor(r() * 10);
      for (let k = 0; k < len; k++) {
        g.fillStyle = k % 4 === 0 ? "#7fd6e8" : "#2e6a82";
        g.fillRect(x, y, 1, 1);
        x += r() < 0.5 ? 1 : -1;
        y += r() < 0.6 ? 1 : 0;
      }
    }
    // floor
    g.fillStyle = "#262f52";
    g.fillRect(0, GROUND, W, H - GROUND);
    g.fillStyle = "#33406a";
    for (let x = 0; x < W; x += 2) if (r() < 0.5) g.fillRect(x, GROUND, 2, 1);
    for (let i = 0; i < 80; i++) {
      g.fillStyle = i % 3 ? "#1b2442" : "#3b8fa8";
      g.fillRect(Math.floor(r() * W), GROUND + 1 + Math.floor(r() * (H - GROUND - 1)), 1, 1);
    }
  }
}

const CRYSTALS: [number, number][] = [
  [36, 1],
  [118, 0],
  [4, 2],
  [146, 0],
  [62, 3],
  [90, 2],
];
