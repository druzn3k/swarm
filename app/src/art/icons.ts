// Upgrade and ability icons: a small set of generic pixel icons, and the
// mapping from an upgrade's name to its icon.
import { Grid, rekey, sp } from "./pixels";
import type { Sprite } from "./pixels";
import { hasSprite, spriteFor } from "./units";

const FASTER = [
  "....kk....",
  "...kyyk...",
  "..kyyyyk..",
  ".kyykkyyk.",
  "kyyk..kyyk",
  "kkk.kk.kkk",
  "...kyyk...",
  "..kyyyyk..",
  ".kyykkyyk.",
  "kyyk..kyyk",
  "kkk....kkk",
];

const EGG = ["..kk..", ".kggk.", "kgxggk", "kggggk", "kgggGk", "kgGGGk", ".kkkk."];

const TWIN = new Grid(14, 10).stamp(EGG, 0, 3).stamp(EGG, 7, 1).set(5, 0, "y").set(4, 1, "y").set(6, 1, "y").set(5, 2, "y").rows();

const PLUS = [".kkk.", "kkykk", "kyyyk", "kkykk", ".kkk."];

// three claw slashes and a plus: stronger warriors
const EMPOWER = (() => {
  const g = new Grid(14, 13);
  for (let i = 0; i < 3; i++) g.line(1 + i * 3, 3, 6 + i * 3, 11, "M");
  for (let i = 0; i < 3; i++) g.set(1 + i * 3, 3, "b").set(2 + i * 3, 4, "b");
  g.outline();
  return g.stamp(PLUS, 9, 0).rows();
})();

const PYLON = [
  "...k...",
  "..kxk..",
  "..kck..",
  ".kcWck.",
  ".kcCck.",
  "..kCk..",
  "...k...",
  ".kkkkk.",
  "kEcEcEk",
  "kkkkkkk",
];
const BUILD = new Grid(13, 12).stamp(PYLON, 1, 2).stamp(PLUS, 8, 0).rows();

const HATCHERY = new Grid(12, 10)
  .stamp(EGG, 3, 0)
  .stamp(["kEk......kEk", "kDEkkkkkkEDk", ".kDDEDDEDDk.", "..kkkkkkkk.."], 0, 6)
  .rows();

const EXPANSION = [
  "kkkk...kkkk",
  "kyyk...kyyk",
  "kyk.....kyk",
  "kk.kkkkk.kk",
  "...kDEDk...",
  "...kEDEk...",
  "...kDEDk...",
  "kk.kkkkk.kk",
  "kyk.....kyk",
  "kyyk...kyyk",
  "kkkk...kkkk",
];

const MEDAL = [
  "kk.....kk",
  "kMk...kMk",
  ".kMk.kMk.",
  "..kMkMk..",
  "..kkkkk..",
  ".kyyyyyk.",
  "kyyyxyyyk",
  "kyyxyxyyk",
  "kyyyxyyyk",
  ".kYyyyYk.",
  "..kkkkk..",
];

const HOURGLASS = [
  "kkkkkkkkk",
  "kYYYYYYYk",
  ".kwyyyWk.",
  ".kWyyywk.",
  "..kwyWk..",
  "...kyk...",
  "..kwywk..",
  ".kwwywwk.",
  ".kwyyywk.",
  "kYYYYYYYk",
  "kkkkkkkkk",
];
const WARP = new Grid(13, 12)
  .stamp(HOURGLASS, 2, 0)
  .set(0, 3, "c")
  .set(0, 4, "c")
  .set(1, 2, "c")
  .set(12, 7, "c")
  .set(12, 8, "c")
  .set(11, 9, "c")
  .rows();

/** a creature with speed lines trailing behind */
function rush(rows: string[], color: string): string[] {
  const w = rows[0].length + 5;
  const h = Math.max(rows.length, 7);
  const g = new Grid(w, h);
  const top = Math.floor((h - rows.length) / 2);
  g.stamp(rows, 5, top);
  const mid = Math.floor(h / 2);
  g.line(0, mid - 2, 3, mid - 2, color);
  g.line(1, mid, 4, mid, color);
  g.line(0, mid + 2, 3, mid + 2, color);
  return g.rows();
}

const MIRROR = [
  "..kkkkk..",
  ".kYyyyYk.",
  "kYwWwwwYk",
  "kywWwwwyk",
  "kywwWwwyk",
  "kywwwWwyk",
  "kywwwwWyk",
  "kYwwwwwYk",
  ".kYyyyYk.",
  "..kkYkk..",
  "...kYk...",
  "..kYYYk..",
  "..kkkkk..",
];
const MIRRORS = new Grid(15, 15).stamp(MIRROR, 0, 2).stamp(MIRROR, 6, 0).rows();

const larva = spriteFor("larva").rows;
const CLONE = new Grid(14, 10)
  .stamp(rekey(spriteFor("larva"), { g: "w", G: "W" }).rows, 2, 0)
  .stamp(larva, 0, 4)
  .rows();

const STAR = [".....k.....", "....kyk....", "...kyyyk...", "kkkkyyykkkk", "kyyyyxyyyyk", ".kyyyyyyyk.", "..kyyyyyk..", ".kyyykyyyk.", ".kyyk.kyyk.", "kyk.....kyk", "kk.......kk"];

/** the generic icon set, by name */
export const ICONS: Record<string, Sprite> = {
  faster: sp(FASTER),
  twin: sp(TWIN),
  empower: sp(EMPOWER),
  build: sp(BUILD),
  hatchery: sp(HATCHERY),
  expansion: sp(EXPANSION),
  medal: sp(MEDAL),
  cocoon: spriteFor("cocoon"),
  warp: sp(WARP),
  larvarush: sp(rush(larva, "g")),
  meatrush: sp(rush(spriteFor("meat").rows, "M")),
  territoryrush: sp(rush(spriteFor("swarmling").rows, "l")),
  clone: sp(CLONE),
  mirror: sp(MIRRORS),
  mutation: spriteFor("mutanteach"),
  ascension: spriteFor("ascension"),
  upgrade: sp(STAR),
};

/** shown for an unknown upgrade; real upgrades never get it (see art.test.ts) */
export const UPGRADE_FALLBACK = ICONS.upgrade;

const EXACT: Record<string, string> = {
  hatchery: "hatchery",
  expansion: "expansion",
  achievementbonus: "medal",
  cocooning: "cocoon",
  larvarush: "larvarush",
  meatrush: "meatrush",
  territoryrush: "territoryrush",
  swarmwarp: "warp",
  clonelarvae: "clone",
  clonearmy: "mirror",
  mutatehidden: "ascension",
};

/** the icon's name in ICONS for an upgrade or ability, or null if unknown */
export function iconNameForUpgrade(name: string): string | null {
  if (EXACT[name]) return EXACT[name];
  if (/^nexus\d$/.test(name)) return "build";
  if (/prod$/.test(name)) return "faster";
  if (/twin$/.test(name)) return "twin";
  if (/empower$/.test(name)) return "empower";
  if (/^mutate/.test(name)) return "mutation";
  return null;
}

/**
 * An upgrade's or ability's icon. Mutations show the mutant they breed
 * (mutatebat -> the bat mutation), everything else a generic icon.
 */
export function iconForUpgrade(name: string): Sprite {
  const mutant = /^mutate(\w+)$/.exec(name);
  if (mutant && hasSprite("mutant" + mutant[1])) return spriteFor("mutant" + mutant[1]);
  const icon = iconNameForUpgrade(name);
  return icon ? ICONS[icon] : UPGRADE_FALLBACK;
}
