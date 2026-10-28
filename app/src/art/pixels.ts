// Pixel-art building blocks: the palette, the Sprite type, and small helpers
// to write sprites as grids of palette keys ('.' is transparent). Framework-
// agnostic and DOM-free, so the sprite tables can be unit tested in node.

export const PAL: Record<string, string> = {
  k: "#1b0f1f", // outline
  p: "#4a2459", // chitin dark
  P: "#7d3f97", // chitin
  l: "#b67ad0", // chitin highlight
  w: "#9fc3d1", // wing
  W: "#d9eef5", // wing shine
  e: "#ff5a4f", // eye
  m: "#9c2a35", // meat dark
  M: "#d2505b", // meat
  f: "#f0c9a6", // fat
  b: "#efe3d2", // bone
  y: "#f2b33d", // amber
  Y: "#a8661c", // amber dark
  g: "#e2ecc0", // grub
  G: "#a9bd80", // grub shade
  d: "#2e1b26", // dirt dark
  D: "#4b2d3b", // dirt
  E: "#6b4453", // dirt light
  c: "#7fd6e8", // crystal
  C: "#3b8fa8", // crystal dark
  v: "#9be36b", // mutagen
  V: "#4f8f3a", // mutagen dark
  r: "#e8728e", // brain
  R: "#a8435f", // brain dark
  // added for the full cast
  s: "#b9c2cf", // steel
  S: "#68708a", // steel dark
  h: "#a8714a", // shell
  H: "#62402c", // shell dark
  u: "#8b7fa8", // fur
  U: "#4e4468", // fur dark
  j: "#f4ff8f", // glow
  x: "#ffffff", // glint
};

export interface Sprite {
  w: number;
  h: number;
  rows: string[];
  pal: Record<string, string>;
}

export const T = "."; // transparent

export function sp(rows: string[], recolor: Record<string, string> = {}): Sprite {
  const w = rows.length ? rows[0].length : 0;
  return { w, h: rows.length, rows, pal: { ...PAL, ...recolor } };
}

export function recolor(s: Sprite, map: Record<string, string>): Sprite {
  return { ...s, pal: { ...s.pal, ...map } };
}

/** Swap palette keys in the grid itself (e.g. turn chitin into mutagen). */
export function rekey(s: Sprite, map: Record<string, string>): Sprite {
  const rows = s.rows.map((r) => r.replace(/./g, (ch) => map[ch] ?? ch));
  return { ...s, rows };
}

/**
 * Symmetric sprites are written as their left half. With `odd`, the last
 * column of the half is the centre column and isn't repeated.
 */
export function mirror(half: string[], odd = false): string[] {
  return half.map((r) => r + [...(odd ? r.slice(0, -1) : r)].reverse().join(""));
}

/** A mutable grid for sprites that are easier to plot than to type. */
export class Grid {
  cells: string[][];
  constructor(
    public w: number,
    public h: number
  ) {
    this.cells = Array.from({ length: h }, () => Array<string>(w).fill(T));
  }
  set(x: number, y: number, key: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y][x] = key;
    return this;
  }
  get(x: number, y: number): string {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.cells[y][x] : T;
  }
  /** copy another sprite's opaque pixels in, top-left at (x, y) */
  stamp(rows: string[], x: number, y: number, opts: { flip?: boolean } = {}): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[opts.flip ? row.length - 1 - i : i];
        if (ch !== T) this.set(x + i, y + j, ch);
      }
    });
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, key: string): this {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, key);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }
  /** a dark 1px outline around every opaque pixel (4-neighbourhood) */
  outline(key = "k"): this {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.cells[y][x] !== T) continue;
        if ([this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)].some((c) => c !== T && c !== key)) add.push([x, y]);
      }
    for (const [x, y] of add) this.cells[y][x] = key;
    return this;
  }
  rows(): string[] {
    return this.cells.map((r) => r.join(""));
  }
}

/** Rank pips under a sprite (overmind II..VI): n amber dots, centred. */
export function withPips(rows: string[], n: number): string[] {
  const w = rows[0].length;
  const g = new Grid(w, rows.length + 3);
  g.stamp(rows, 0, 0);
  const span = n * 2 - 1;
  const x0 = Math.floor((w - span) / 2);
  for (let i = 0; i < n; i++) {
    g.set(x0 + i * 2, rows.length + 1, "y");
  }
  // outline the pips so they read on any background
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 2;
    g.set(x, rows.length, g.get(x, rows.length) === T ? "k" : g.get(x, rows.length));
    g.set(x, rows.length + 2, "k");
    if (g.get(x - 1, rows.length + 1) === T) g.set(x - 1, rows.length + 1, "k");
    if (g.get(x + 1, rows.length + 1) === T) g.set(x + 1, rows.length + 1, "k");
  }
  return g.rows();
}
