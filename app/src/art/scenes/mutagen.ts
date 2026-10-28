// The mutagen tab: the mutation lab. A vat of mutagen bubbles in the middle,
// rising as the swarm stockpiles it; the mutations bred so far stand on the
// shelves; dormant premutagen sleeps on the floor; and above the vat the
// ascension rift waits, burning brighter with every ascension.
import { Scene, W, H, shown } from "./base";
import { spriteFor } from "../units";

const GROUND = 72;
const MUTANTS = ["mutanthatchery", "mutantbat", "mutantclone", "mutantswarmwarp", "mutantrush", "mutanteach", "mutantfreq", "mutantnexus", "mutantarmy", "mutantmeat"];
const SHELF_L = 38;
const SHELF_R = 38;
const SLOTS: [number, number][] = [
  [4, SHELF_L],
  [22, SHELF_L],
  [40, SHELF_L],
  [102, SHELF_R],
  [120, SHELF_R],
  [138, SHELF_R],
];
const VAT_X = 58;
const VAT_W = 44;
const VAT_TOP = 44;

export class MutagenScene extends Scene {
  protected burstColors = ["#9be36b", "#4f8f3a", "#f4ff8f", "#ffffff"];
  private mutants: string[] = [];

  protected layout(): void {
    // the six most plentiful mutations take the shelves
    this.mutants = MUTANTS.filter((n) => this.log(n) >= 0)
      .sort((a, b) => this.log(b) - this.log(a))
      .slice(0, SLOTS.length);
  }

  protected burstPoint(unit: string): [number, number] {
    const i = this.mutants.indexOf(unit);
    if (i >= 0) return [SLOTS[i][0] + 8, SLOTS[i][1] - 8];
    if (unit === "premutagen") return [20, GROUND - 4];
    return [80, VAT_TOP + 6];
  }

  protected draw(ctx: CanvasRenderingContext2D, slow: number): void {
    const t = this.t;

    // the ascension rift
    const asc = this.log("ascension");
    const power = asc >= 0 ? 0.35 + Math.min(0.4, asc * 0.15) : 0.12;
    const pulse = power + 0.08 * Math.sin(t / 18) * slow;
    this.glow(ctx, 80, 18, 16, "#9be36b", pulse);
    ctx.globalAlpha = Math.min(1, pulse + 0.3);
    ctx.fillStyle = "#f4ff8f";
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (slow ? t / 60 : 0);
      ctx.fillRect(Math.round(80 + Math.cos(a) * 13), Math.round(18 + Math.sin(a) * 6), 1, 1);
    }
    ctx.globalAlpha = 1;
    if (asc >= 0) {
      const s = spriteFor("ascension");
      this.put(ctx, s, 80 - Math.floor(s.w / 2), 11 + Math.round(Math.sin(t / 30) * 1.5) * slow);
    }

    // the vat: mutagen level rises with the stockpile
    const level = Math.max(2, Math.min(VAT_W, Math.round(4 + Math.max(0, this.log("mutagen")) * 2.5)));
    const fill = Math.min(GROUND - VAT_TOP - 4, Math.round((level / VAT_W) * (GROUND - VAT_TOP - 4)));
    const top = GROUND - 2 - fill;
    ctx.fillStyle = "#4f8f3a";
    ctx.fillRect(VAT_X + 2, top, VAT_W - 4, fill);
    ctx.fillStyle = "#9be36b";
    const wave = slow ? Math.round(Math.sin(t / 10)) : 0;
    for (let x = VAT_X + 2; x < VAT_X + VAT_W - 2; x++) ctx.fillRect(x, top + ((x + wave) % 4 === 0 ? 1 : 0), 1, 1);
    // glass front
    ctx.fillStyle = "rgba(217,238,245,0.12)";
    ctx.fillRect(VAT_X + 2, VAT_TOP + 2, VAT_W - 4, GROUND - VAT_TOP - 4);
    ctx.fillStyle = "rgba(217,238,245,0.45)";
    ctx.fillRect(VAT_X + 5, VAT_TOP + 4, 1, 12);
    ctx.fillRect(VAT_X + 7, VAT_TOP + 4, 1, 5);
    // bubbles
    if (slow && t % 7 === 0) this.spawn(VAT_X + 4 + Math.random() * (VAT_W - 8), GROUND - 4, 0, -0.25 - Math.random() * 0.2, 0, Math.max(6, fill * 2.5), "#d4ff9a");

    // mutations on the shelves
    for (let i = 0; i < this.mutants.length; i++) {
      const [x, y] = SLOTS[i];
      const s = this.sprite(this.mutants[i], 30, i, slow);
      const bob = Math.round(Math.sin(t / 26 + i)) * slow;
      this.put(ctx, s, x + Math.floor((16 - s.w) / 2), y - s.h + bob * (s.h > 12 ? 0 : 1), { flip: i >= 3 });
    }

    // dormant premutagen sleeps on the floor
    const pre = spriteFor("premutagen");
    const sleepers = shown(this.log("premutagen"), 1, 4);
    for (let i = 0; i < sleepers; i++) {
      const x = i % 2 ? 108 + (i >> 1) * 22 : 6 + (i >> 1) * 22;
      const breathe = slow && (t + i * 30) % 120 < 60 ? 1 : 0;
      this.put(ctx, pre, x, GROUND - pre.h + 2 + breathe);
      if (slow && (t + i * 50) % 150 === 0) this.spawn(x + 10, GROUND - pre.h, 0.15, -0.2, 0, 50, "#b8c4a0");
    }
  }

  protected paintBackground(g: CanvasRenderingContext2D, r: () => number): void {
    const bands = ["#0b120d", "#0f1912", "#132016", "#17271a"];
    for (let y = 0; y < H; y++) {
      g.fillStyle = bands[Math.min(bands.length - 1, Math.floor((y / H) * bands.length))];
      g.fillRect(0, y, W, 1);
    }
    // organic tiles on the back wall
    for (let y = 2; y < GROUND; y += 6) {
      for (let x = (y / 6) % 2 ? -5 : 0; x < W; x += 10) {
        g.fillStyle = "#1a2a1c";
        g.fillRect(x + 1, y + 1, 8, 4);
        g.fillStyle = "#223524";
        g.fillRect(x + 1, y + 1, 8, 1);
      }
    }
    // pipes along the ceiling
    g.fillStyle = "#2f4a33";
    g.fillRect(0, 3, W, 3);
    g.fillStyle = "#4f6f4f";
    g.fillRect(0, 3, W, 1);
    for (let x = 6; x < W; x += 26) {
      g.fillStyle = "#1b0f1f";
      g.fillRect(x, 2, 3, 5);
    }
    // shelves
    shelf(g, 2, SHELF_L, 56);
    shelf(g, 100, SHELF_R, 58);
    // the vat
    g.fillStyle = "#1b0f1f";
    g.fillRect(VAT_X, VAT_TOP, VAT_W, GROUND - VAT_TOP + 2);
    g.fillStyle = "#0c1a10";
    g.fillRect(VAT_X + 2, VAT_TOP + 2, VAT_W - 4, GROUND - VAT_TOP - 4);
    g.fillStyle = "#68708a";
    g.fillRect(VAT_X - 1, VAT_TOP - 1, VAT_W + 2, 3);
    g.fillStyle = "#b9c2cf";
    g.fillRect(VAT_X - 1, VAT_TOP - 1, VAT_W + 2, 1);
    for (let x = VAT_X + 4; x < VAT_X + VAT_W; x += 12) {
      g.fillStyle = "#68708a";
      g.fillRect(x, VAT_TOP - 1, 2, 3);
    }
    // floor
    g.fillStyle = "#1f2a1a";
    g.fillRect(0, GROUND, W, H - GROUND);
    g.fillStyle = "#2f3f28";
    g.fillRect(0, GROUND, W, 1);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = i % 4 ? "#141c12" : "#4f8f3a";
      g.fillRect(Math.floor(r() * W), GROUND + 1 + Math.floor(r() * (H - GROUND - 1)), 1, 1);
    }
    // vat base
    g.fillStyle = "#68708a";
    g.fillRect(VAT_X - 2, GROUND, VAT_W + 4, 3);
    g.fillStyle = "#1b0f1f";
    g.fillRect(VAT_X - 2, GROUND + 3, VAT_W + 4, 1);
  }
}

function shelf(g: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  g.fillStyle = "#1b0f1f";
  g.fillRect(x - 1, y - 1, w + 2, 5);
  g.fillStyle = "#5c3a2a";
  g.fillRect(x, y, w, 3);
  g.fillStyle = "#7a5238";
  g.fillRect(x, y, w, 1);
  g.fillStyle = "#3a2418";
  g.fillRect(x + 3, y + 3, 2, 4);
  g.fillRect(x + w - 5, y + 3, 2, 4);
}
