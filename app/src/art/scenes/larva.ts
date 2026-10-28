// The larva tab: the egg chamber. Wax cells line the walls with grubs
// peeking out, cocoons hang from the ceiling on silk, and larvae wriggle
// across the floor among clutches of eggs.
import { Scene, W, H, shown } from "./base";
import { PROPS, spriteFor } from "../units";

const GROUND = 70;
const CELL_W = 8;
const CELL_H = 7;

export class LarvaScene extends Scene {
  protected burstColors = ["#e2ecc0", "#a9bd80", "#f2b33d", "#f4ecdf"];
  private cells: [number, number][] = [];

  protected layout(): void {
    // grubs peeking from cells: more cells fill as the larva count grows
    const want = shown(this.log("larva"), 3, CELLS.length);
    this.cells = CELLS.slice(0, want);
  }

  protected burstPoint(unit: string): [number, number] {
    return unit === "cocoon" ? [cocoonX(0) + 4, 26] : [70, GROUND];
  }

  protected draw(ctx: CanvasRenderingContext2D, slow: number): void {
    const t = this.t;
    // grubs in the wax cells
    for (const [x, y] of this.cells) {
      ctx.fillStyle = "#e2ecc0";
      ctx.fillRect(x + 2, y + 2, 3, 2);
      ctx.fillStyle = "#a9bd80";
      ctx.fillRect(x + 2, y + 4, 3, 1);
      ctx.fillStyle = "#1b0f1f";
      ctx.fillRect(x + 3, y + 3, 1, 1);
    }

    // cocoons hang on silk threads and sway
    const cocoon = spriteFor("cocoon");
    const cocoons = shown(this.log("cocoon"), 1.5, 8);
    for (let i = 0; i < cocoons; i++) {
      const x = cocoonX(i);
      const len = 6 + ((i * 7) % 11);
      const sway = slow ? Math.round(Math.sin(t / 40 + i * 1.7) * 1.2) : 0;
      ctx.fillStyle = "#cdbfae";
      ctx.fillRect(x + 4, 0, 1, len);
      this.put(ctx, cocoon, x + sway, len - 1);
    }

    // clutches of eggs
    const egg = PROPS.egg;
    const eggs = shown(this.log("larva"), 1, 6);
    for (let i = 0; i < eggs; i++) {
      this.put(ctx, egg, 132 + (i % 3) * 4 + (i >= 3 ? 2 : 0), GROUND - 3 - (i >= 3 ? 3 : 0));
      this.put(ctx, egg, 14 + (i % 3) * 4, GROUND - 3 - (i >= 3 ? 3 : 0));
    }

    // larvae wriggle across the floor
    const larvae = shown(this.log("larva"), 2, 14);
    for (let i = 0; i < larvae; i++) {
      const s = this.sprite("larva", 14 + (i % 3) * 4, i, slow);
      const lane = i % 3;
      const span = W + 24;
      const x = slow ? ((i * 41 + t * (0.08 + lane * 0.03)) % span) - 12 : (i * 29) % (W - 12);
      this.put(ctx, s, x, GROUND - 4 + lane * 4, { flip: true });
    }

    // the odd cocoon hatches: a puff of silk
    if (slow && cocoons > 0 && t % 240 === 120) {
      const x = cocoonX(t % cocoons) + 4;
      for (let k = 0; k < 6; k++) this.spawn(x, 18, (Math.random() - 0.5) * 0.6, Math.random() * 0.4, 0.03, 30, "#f4ecdf");
    }
    if (slow) this.motes(ctx, "rgba(242,179,61,0.3)", 8, GROUND);
  }

  protected paintBackground(g: CanvasRenderingContext2D, r: () => number): void {
    // warm wax walls
    const bands = ["#24140c", "#2c1a0f", "#331f12", "#3a2416"];
    for (let y = 0; y < H; y++) {
      g.fillStyle = bands[Math.min(bands.length - 1, Math.floor((y / GROUND) * bands.length))];
      g.fillRect(0, y, W, 1);
    }
    // a honeycomb of wax cells
    for (const [x, y] of ALL_CELLS) {
      hex(g, x, y, "#5a3a1c", "#1d1009");
    }
    // the cells' amber shine near the top
    g.fillStyle = "rgba(242,179,61,0.08)";
    g.fillRect(0, 0, W, 20);
    // floor: packed wax and dirt
    g.fillStyle = "#4b2d3b";
    g.fillRect(0, GROUND, W, H - GROUND);
    g.fillStyle = "#6b4420";
    g.fillRect(0, GROUND, W, 1);
    const grit = ["#573645", "#7a5226", "#24141e"];
    for (let i = 0; i < 90; i++) {
      g.fillStyle = grit[i % grit.length];
      g.fillRect(Math.floor(r() * W), GROUND + 1 + Math.floor(r() * (H - GROUND - 1)), 1, 1);
    }
  }
}

function hex(g: CanvasRenderingContext2D, x: number, y: number, wall: string, hole: string): void {
  g.fillStyle = wall;
  g.fillRect(x + 2, y, CELL_W - 3, 1);
  g.fillRect(x + 1, y + 1, 1, 1);
  g.fillRect(x + CELL_W - 2, y + 1, 1, 1);
  g.fillRect(x, y + 2, 1, CELL_H - 4);
  g.fillRect(x + CELL_W - 1, y + 2, 1, CELL_H - 4);
  g.fillRect(x + 1, y + CELL_H - 2, 1, 1);
  g.fillRect(x + CELL_W - 2, y + CELL_H - 2, 1, 1);
  g.fillRect(x + 2, y + CELL_H - 1, CELL_W - 3, 1);
  g.fillStyle = hole;
  g.fillRect(x + 2, y + 1, CELL_W - 4, CELL_H - 2);
  g.fillRect(x + 1, y + 2, CELL_W - 2, CELL_H - 4);
}

// honeycomb layout: offset rows of cells across the back wall
const ALL_CELLS: [number, number][] = [];
for (let row = 0; row < 11; row++) {
  for (let col = -1; col < W / CELL_W + 1; col++) {
    ALL_CELLS.push([col * CELL_W + (row % 2) * 4, 4 + row * (CELL_H - 1)]);
  }
}
// cells that fill with grubs, in a scattered but fixed order
const CELLS = (() => {
  const r = (() => {
    let s = 99;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  const list = ALL_CELLS.filter(([x, y]) => x >= 0 && x < W - CELL_W && y > 14 && y < GROUND - 12);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, 18);
})();

function cocoonX(i: number): number {
  return 10 + ((i * 53) % 136);
}
