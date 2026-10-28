// Generated pixel art. Every sprite is a grid of palette keys; '.' is
// transparent. Higher-tier units reuse a base sprite with a recolor, so the
// whole cast of 53 units comes from a handful of drawings.

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
};

export interface Sprite {
  w: number;
  h: number;
  rows: string[];
  pal: Record<string, string>;
}

function sp(rows: string[], recolor: Record<string, string> = {}): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  return { w, h: rows.length, rows: rows.map((r) => r.padEnd(w, ".")), pal: { ...PAL, ...recolor } };
}

export function recolor(s: Sprite, map: Record<string, string>): Sprite {
  return { ...s, pal: { ...s.pal, ...map } };
}

// --- base drawings -------------------------------------------------------

const DRONE_A = [
  "......ww.ww.....",
  ".....wWwwWww....",
  "...kkkkkkkkkkk..",
  "..kpPlkYyyYyyYk.",
  ".kepPPkyYyyYyyYk",
  ".kppPPkYyyYyyYYk",
  "..kkkkkkkkkkkkk.",
  "..k.k..k.k..k...",
  ".k...k.k..k..k..",
];
const DRONE_B = [
  ".....ww..ww.....",
  "....wWww.wWw....",
  "...kkkkkkkkkkk..",
  "..kpPlkYyyYyyYk.",
  ".kepPPkyYyyYyyYk",
  ".kppPPkYyyYyyYYk",
  "..kkkkkkkkkkkkk.",
  "...k.k..k.k.k...",
  "...k..k.k..k.k..",
];

const LARVA_A = [
  "...kkkkkk...",
  "..kggGgggk..",
  ".kgggGgggGk.",
  "kggGggGgggGk",
  "kGgGgGgGgGGk",
  ".kkkkkkkkkk.",
];
const LARVA_B = [
  "............",
  "..kkkkkkkk..",
  ".kgggGggggk.",
  "kggGggGgggGk",
  "kGgGgGgGgGGk",
  ".kkkkkkkkkk.",
];

const QUEEN = [
  "....y.y.y.........",
  "....yyyyy...ww....",
  "...kkkkkkkwWwww...",
  "..kpPPPPkkkkkkkk..",
  ".kepPlPPkYyyYyyYkk",
  ".kppPPPkYyyYyyYyyk",
  ".kppPPkYyyYyyYyyYk",
  "..kkkkkYyyYyyYyyYk",
  "....k.kYyyYyyYyyk.",
  "...k..kkYyyYyyYk..",
  "..k..k..kkkkkkk...",
  "....k..k.k..k.....",
];

const NEST = [
  "......kkkkkk......",
  "....kkEDDEDEkk....",
  "...kEDDEDDDEDEk...",
  "..kEDdddEDdddDEk..",
  ".kDDdbbdDDdbbdDDk.",
  ".kEDdbbdEDdbbdDEk.",
  "kEDDDddDDDDddDDDEk",
  "kkkkkkkkkkkkkkkkkk",
];

const HIVE = [
  ".......kkkk.......",
  ".....kkYyyYkk.....",
  "....kYyyYyyYyk....",
  "...kyYkkyYkkyYk...",
  "..kYyykdkYkdkyYk..",
  "..kyYyYyyYyyYyyk..",
  ".kYyykkYyykkYyyYk.",
  ".kyYkdkyYkdkYyYyk.",
  ".kYyyYyyYyyYyyYyk.",
  "kYyykkyYkkYyykkYyk",
  "kyYkdkYykdkyYkdkYk",
  "kkkkkkkkkkkkkkkkkk",
];

const MEAT = [
  "...kkkkk...",
  "..kMMfMMk..",
  ".kMmMMfMMk.",
  "kMMmMMMmMbk",
  "kmMMMmMMbbk",
  ".kmmMMmmkk.",
  "..kkkkkk...",
];

const EGG = [".kk.", "kggk", "kgGk", ".kk."];

const BRAIN = [
  "....kkkkkk....",
  "..kkrRrrRrkk..",
  ".krrRrrRrrRrk.",
  "krRrrRrrRrrRrk",
  "kRrrRrRrrRrrRk",
  "krRrrRrrRrRrrk",
  ".kRrRrrRrrRrk.",
  "..kkRrrkRrkk..",
  "....kkk.kk....",
];

const EYE = [
  "....kkkkkk....",
  "..kkPPPPPPkk..",
  ".kPPbbbbbbPPk.",
  "kPPbbeeeebbPPk",
  "kPbbeekkeebbPk",
  "kPPbbeeeebbPPk",
  ".kPPbbbbbbPPk.",
  "..kkPPPPPPkk..",
  "....kkkkkk....",
];

const CRYSTAL = [
  "....k....",
  "...kck...",
  "..kcCck..",
  ".kccCcck.",
  "kcccCccck",
  ".kcCcCck.",
  "..kcCck..",
  "...kck...",
  "....k....",
];

const VIAL = [
  "..kkkk..",
  "..kbbk..",
  "..kbbk..",
  ".kvvvvk.",
  "kvVvvVvk",
  "kvvVvvvk",
  "kVvvvVvk",
  ".kkkkkk.",
];

const CLAW = [
  "........kk......",
  ".......kbbk.....",
  "...kkkkkbbk.....",
  "..kMMMMkkk.kk...",
  ".keMMmMMMkkbbk..",
  ".kmmMMmMMMMkbk..",
  "..kkkkkkkkkkk...",
  "..k.k..k.k..k...",
  ".k...k.k..k..k..",
];

export const BASE = {
  droneA: sp(DRONE_A),
  droneB: sp(DRONE_B),
  larvaA: sp(LARVA_A),
  larvaB: sp(LARVA_B),
  queen: sp(QUEEN),
  nest: sp(NEST),
  hive: sp(HIVE),
  meat: sp(MEAT),
  egg: sp(EGG),
  brain: sp(BRAIN),
  eye: sp(EYE),
  crystal: sp(CRYSTAL),
  vial: sp(VIAL),
  claw: sp(CLAW),
};

// --- unit -> sprite ------------------------------------------------------

const ROYAL = { p: "#2b1f5c", P: "#4d3fa0", l: "#8f86e6", y: "#f7d774", Y: "#b48a2c" };
const IMPERIAL = { p: "#5c1f2b", P: "#a03f4d", l: "#e68694", y: "#fff0a8", Y: "#d0a43a" };
const DIVINE = { p: "#1f4f5c", P: "#3f93a0", l: "#86d6e6", y: "#ffffff", Y: "#9fd0d8" };

const MEAT_TIERS: Record<string, Sprite> = {
  meat: BASE.meat,
  drone: BASE.droneA,
  queen: BASE.queen,
  nest: BASE.nest,
  greaterqueen: recolor(BASE.queen, ROYAL),
  hive: BASE.hive,
  hivequeen: recolor(BASE.queen, IMPERIAL),
  empress: recolor(BASE.queen, DIVINE),
  prophet: recolor(BASE.brain, { r: "#d79be8", R: "#8a4fa8" }),
  goddess: BASE.brain,
  pantheon: recolor(BASE.brain, { r: "#f2b33d", R: "#a8661c" }),
  pantheon2: recolor(BASE.brain, { r: "#7fd6e8", R: "#3b8fa8" }),
  pantheon3: recolor(BASE.brain, { r: "#9be36b", R: "#4f8f3a" }),
  pantheon4: recolor(BASE.brain, { r: "#efe3d2", R: "#a08a78" }),
  pantheon5: recolor(BASE.brain, { r: "#ff8a5c", R: "#b34a26" }),
  overmind: BASE.eye,
};

const OVERMIND_COLORS = ["#ff5a4f", "#f2b33d", "#9be36b", "#7fd6e8", "#b67ad0", "#ffffff"];

export function spriteFor(name: string, tab?: string): Sprite {
  if (MEAT_TIERS[name]) return MEAT_TIERS[name];
  const om = /^overmind(\d)$/.exec(name);
  if (om) return recolor(BASE.eye, { e: OVERMIND_COLORS[(+om[1] - 1) % OVERMIND_COLORS.length] });
  if (name === "larva" || name === "cocoon") return name === "cocoon" ? recolor(BASE.larvaA, { g: "#d9cbb8", G: "#9e8a74" }) : BASE.larvaA;
  if (name === "territory") return BASE.claw;
  if (name === "energy" || name === "nexus" || name === "crystal") return BASE.crystal;
  if (name === "mutagen" || name === "premutagen") return BASE.vial;
  switch (tab) {
    case "territory":
      return recolor(BASE.claw, tierTint(name));
    case "energy":
      return recolor(BASE.crystal, { c: "#c9b3f0", C: "#7d5fb8" });
    case "mutagen":
      return recolor(BASE.vial, { v: "#e8728e", V: "#a8435f" });
    case "larva":
      return BASE.larvaA;
    default:
      return BASE.egg;
  }
}

function tierTint(name: string): Record<string, string> {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tints = [
    { M: "#d2505b", m: "#9c2a35" },
    { M: "#c9873a", m: "#8a5520" },
    { M: "#8a9c3a", m: "#56631f" },
    { M: "#5a7fc9", m: "#2f4c8a" },
    { M: "#b45ac9", m: "#6f2f8a" },
  ];
  return tints[h % tints.length];
}

// --- drawing -------------------------------------------------------------

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  s: Sprite,
  x: number,
  y: number,
  opts: { flip?: boolean; scale?: number } = {}
): void {
  const scale = opts.scale ?? 1;
  x = Math.round(x);
  y = Math.round(y);
  for (let row = 0; row < s.h; row++) {
    const line = s.rows[row];
    for (let col = 0; col < s.w; col++) {
      const key = line[opts.flip ? s.w - 1 - col : col];
      if (key === ".") continue;
      ctx.fillStyle = s.pal[key];
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
    }
  }
}

const iconCache = new Map<Sprite, string>();
/** A sprite as a data URL, padded to a square, for <img> icons. */
export function spriteDataUrl(s: Sprite): string {
  let url = iconCache.get(s);
  if (url) return url;
  const size = Math.max(s.w, s.h) + 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  drawSprite(ctx, s, Math.floor((size - s.w) / 2), Math.floor((size - s.h) / 2));
  url = c.toDataURL();
  iconCache.set(s, url);
  return url;
}
