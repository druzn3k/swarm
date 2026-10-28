// Drawing sprites onto a canvas. Each sprite (and each flip of it) is painted
// once to a small offscreen canvas, then blitted with drawImage: cheap enough
// to draw dozens of creatures per frame with no allocation.
import type { Sprite } from "./pixels";

export interface DrawOpts {
  flip?: boolean;
  flipY?: boolean;
  scale?: number;
}

const cache = new WeakMap<Sprite, (HTMLCanvasElement | undefined)[]>();

function paint(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, flip: boolean, flipY: boolean, scale: number): void {
  for (let row = 0; row < s.h; row++) {
    const line = s.rows[flipY ? s.h - 1 - row : row];
    for (let col = 0; col < s.w; col++) {
      const key = line[flip ? s.w - 1 - col : col];
      if (key === ".") continue;
      ctx.fillStyle = s.pal[key];
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
    }
  }
}

function sheet(s: Sprite, flip: boolean, flipY: boolean): HTMLCanvasElement {
  let list = cache.get(s);
  if (!list) cache.set(s, (list = []));
  const i = (flip ? 1 : 0) + (flipY ? 2 : 0);
  let c = list[i];
  if (!c) {
    c = document.createElement("canvas");
    c.width = s.w;
    c.height = s.h;
    paint(c.getContext("2d")!, s, 0, 0, flip, flipY, 1);
    list[i] = c;
  }
  return c;
}

export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, opts: DrawOpts = NONE): void {
  const scale = opts.scale ?? 1;
  const c = sheet(s, !!opts.flip, !!opts.flipY);
  ctx.drawImage(c, Math.round(x), Math.round(y), s.w * scale, s.h * scale);
}
const NONE: DrawOpts = {};

const urls = new Map<string, string>();
const ids = new WeakMap<Sprite, number>();
let nextId = 1;

/**
 * A sprite as a square data URL for <img> icons, `size` pixels across, with
 * the sprite at the largest whole-number scale that fits (crisp pixels).
 */
export function spriteDataUrl(s: Sprite, size = 0): string {
  let id = ids.get(s);
  if (!id) ids.set(s, (id = nextId++));
  const key = id + ":" + size;
  let url = urls.get(key);
  if (url) return url;
  const side = Math.max(s.w, s.h) + 2;
  const box = Math.max(size, side);
  const scale = Math.max(1, Math.floor(box / side));
  const c = document.createElement("canvas");
  c.width = box;
  c.height = box;
  const ctx = c.getContext("2d")!;
  paint(ctx, s, Math.floor((box - s.w * scale) / 2), Math.floor((box - s.h * scale) / 2), false, false, scale);
  url = c.toDataURL();
  urls.set(key, url);
  return url;
}
