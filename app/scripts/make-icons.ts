// Generates the app icons (public/icons/*.png) from the game's own pixel art:
// the queen sprite on the burrow background, scaled by whole pixels.
// Run with `pnpm icons` after changing the sprite or the palette.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spriteFor } from "../src/art/sprites";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
// the hive chamber colour: light enough for the sprite's dark outline to read
const BG = "#3a2231";
const sprite = spriteFor("queen");

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** An RGBA square: the sprite centered on the background, filling `fill` of the width. */
function render(size: number, fill: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const [br, bg, bb] = rgb(BG);
  for (let i = 0; i < size * size; i++) px.set([br, bg, bb, 255], i * 4);
  const scale = Math.max(1, Math.floor((size * fill) / Math.max(sprite.w, sprite.h)));
  const ox = Math.floor((size - sprite.w * scale) / 2);
  const oy = Math.floor((size - sprite.h * scale) / 2);
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const key = sprite.rows[y][x];
      if (key === ".") continue;
      const [r, g, b] = rgb(sprite.pal[key]);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) px.set([r, g, b, 255], ((oy + y * scale + dy) * size + ox + x * scale + dx) * 4);
    }
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf: Uint8Array): number {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

mkdirSync(OUT, { recursive: true });
// "any" icons fill most of the square; maskable ones keep the sprite inside
// the 80% safe zone that Android's icon masks never crop
const icons: [string, number, number][] = [
  ["icon-192.png", 192, 0.78],
  ["icon-512.png", 512, 0.78],
  ["maskable-512.png", 512, 0.56],
  ["apple-touch-icon.png", 180, 0.7],
  ["favicon-32.png", 32, 1],
];
for (const [name, size, fill] of icons) {
  writeFileSync(join(OUT, name), png(size, render(size, fill)));
  console.log(`icons/${name} ${size}x${size}`);
}
