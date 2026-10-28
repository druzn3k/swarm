// Every unit's sprite, drawn as pixel grids of palette keys ('.' is clear).
// Creatures face left (head on the left); scenes flip them to walk right.
// Distinct creatures get their own drawing; numbered tiers (overmind II..VI)
// reuse their base with a recolor and rank pips.
import { Grid, mirror, recolor, rekey, sp, withPips } from "./pixels";
import type { Sprite } from "./pixels";

// --- meat ---------------------------------------------------------------

const MEAT = [
  "...kkkkk...",
  "..kMMfMMk..",
  ".kMmMMfMMk.",
  "kMMmMMMmMbk",
  "kmMMMmMMbbk",
  ".kmmMMmmkk.",
  "..kkkkkk...",
];

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

const QUEEN_A = [
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
const QUEEN_B = [
  "....y.y.y.........",
  "....yyyyy..ww.....",
  "...kkkkkkkwWwwww..",
  ...QUEEN_A.slice(3),
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

const GREATERQUEEN_A = [
  "...y.y.y.y..........",
  "...yyyyyyy..ww..ww..",
  "..kkkkkkkkkwWwwwWwww",
  ".kpPPPPPPkkkkkkkkkk.",
  "kepPPlPPkYyyYyyYyyYk",
  "kppPPPPkYyyYyyYyyYyk",
  "kppPPPkYyyYyyYyyYyyk",
  ".kkkkkkYyyYyyYyyYyyk",
  "....k.kYyyYyyYyyYyk.",
  "...k..kkYyyYyyYyykk.",
  "..k..k..kkYyyYyykk..",
  "....k..k..kkkkkk....",
  "...k..k..k..k.......",
];
const GREATERQUEEN_B = [
  "...y.y.y.y..........",
  "...yyyyyyy.ww..ww...",
  "..kkkkkkkkwWwwwWwww.",
  ...GREATERQUEEN_A.slice(3),
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

const HIVEQUEEN = [
  "....y.y.y...........",
  "....yyyyy...ww.ww...",
  "...kkkkkkk.wWwwWww..",
  "..kpPPPPPkkkkkkkkkk.",
  ".kepPlPPkyYkdkyYkdkk",
  ".kppPPPkYyyYyyYyyYyk",
  ".kppPPkdkyYkdkyYkdkk",
  "..kkkkkYyyYyyYyyYyyk",
  "....k.kyYkdkyYkdkyk.",
  "...k..kkYyyYyyYyykk.",
  "..k..k..kkkkkkkkk...",
  "....k..k.k..k.......",
];

// front-on, wings spread like a cape: the one regal silhouette
const EMPRESS = mirror(
  [
    "........y.y",
    "........yYy",
    ".......kkkk",
    "..ww..kpPPl",
    ".wWww.kePPP",
    "wWwwwwkpPPP",
    "wwWwwwwkkPP",
    "wwwWwwwkYyy",
    ".wwwWwkYyYy",
    "..wwwkYyYyy",
    "...kkkYyYyY",
    "....kYyYyyy",
    ".....kYyYyY",
    "......kkYyy",
    "........kkk",
  ],
  true
);

// hooded seer: a brain for a head, a staff with a glowing tip
const PROPHET = [
  "...k...k......",
  "....k.k.....y.",
  "..kkkkkkk..yjy",
  ".krRrrRrRk..Y.",
  "krRrRrrRrRk.Y.",
  "kRrRrRrRrRk.Y.",
  ".kkekkkekk..Y.",
  "..kpPPPPk...Y.",
  ".kpPlPPPPk.kPk",
  ".kpPPlPPPPkkY.",
  ".kpPPPlPPPk.Y.",
  "kpPPPPPlPPPkY.",
  "kpPPPPPPlPPPk.",
  "kkkkkkkkkkkkk.",
];

// hive neuron: a single nerve cell reaching out
const NEURON = [
  "r......r.....r.",
  ".r....r.....r..",
  "..r..r.....r...",
  "...rr.kkkk.r...",
  "....rkrRrrkr...",
  ".....krxRrrkrrr",
  "rrrrkrRyyRrk...",
  "....krrRyRrk...",
  ".....kRrrRk.r..",
  "....r.kkkk...r.",
  "...r....r.....r",
  "..r......r.....",
  ".r........r....",
];

// neural cluster: three neurons, wired together
const CLUSTER = [
  "..kkkk..........",
  ".krRrrk...kkkk..",
  ".kRyyRkrrkrRrrk.",
  ".krRrRk..kRyyRk.",
  "..kkkk...krRrRk.",
  "...r......kkkk..",
  "....r....r......",
  ".....kkkkr......",
  "....krRrrk......",
  "....kRyyRkr.....",
  "....krRrRk.r....",
  ".....kkkk.......",
];

// hive network: many small nodes on a web of nerves
const NETWORK = (() => {
  const node = [".kkk.", "krRrk", "kRyRk", "krRrk", ".kkk."];
  const at: [number, number][] = [
    [0, 1],
    [12, 0],
    [6, 5],
    [0, 10],
    [13, 9],
  ];
  const g = new Grid(18, 15);
  const c = (i: number) => [at[i][0] + 2, at[i][1] + 2] as const;
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
    [2, 3],
    [2, 4],
    [3, 4],
    [1, 4],
  ]) {
    const [x0, y0] = c(a);
    const [x1, y1] = c(b);
    g.line(x0, y0, x1, y1, "R");
  }
  for (const [x, y] of at) g.stamp(node, x, y);
  return g.rows();
})();

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

// hive mind: a bigger brain on a nerve stalk, tendrils trailing
const HIVEMIND = [
  ".....kkkkkk.....",
  "...kkrRrrRrkk...",
  "..krRrrRrrRrrk..",
  ".krRrRrrRrRrRrk.",
  "krRrrRrRrrRrrRrk",
  "kRrRrrRrRrRrRrRk",
  "krRrRrrRrrRrRrrk",
  ".kRrrRrRrRrrRrk.",
  "..kRrRrkkRrRrk..",
  "...kkkkRRkkkk...",
  "......kRRk......",
  ".....r.kRk.r....",
  "....r..kRk..r...",
  "...r....k....r..",
];

// arch-mind: merged minds, three eyes open, crowned with a halo
const ARCHMIND = [
  "....yyyyyyyy....",
  "...y........y...",
  "....yyyyyyyy....",
  ".....kkkkkk.....",
  "...kkrRrrRrkk...",
  "..krRrrRrrRrrk..",
  ".krRkkRrRrkkRrk.",
  "krRkeekrRkeekRrk",
  "kRrRkkRkkRkkrRrk",
  "krRrRrkeekRrRrrk",
  ".kRrrRrkkrRrRrk.",
  "..kRrRrRrRrRrk..",
  "...kkkkRRkkkk...",
  "......kRRk......",
  ".....rkRRkr.....",
  "....r..kk..r....",
];

// overmind: one great eye in a fleshy mass, tentacles below
const OVERMIND_HALF = [
  "......kkk",
  "....kkRrr",
  "...kRrrRr",
  "..kRrkkkk",
  ".kRrkbbbb",
  ".kRkbbeee",
  "kRrkbeekk",
  "kRrkbeekk",
  ".kRkbbeee",
  ".kRkbbbbb",
  ".kRrkkkkk",
  "..kRrRrRr",
  "...kkRkkR",
  "...kR.kR.",
  "...R..R..",
];
const OVERMIND_A = mirror(OVERMIND_HALF);
const OVERMIND_B = mirror([
  ...OVERMIND_HALF.slice(0, 4),
  ".kRrkkkkk",
  ".kRkRrRrR",
  "kRrkrRrRr",
  "kRrkRrRrR",
  ".kRkkkkkk",
  ".kRkRrRrR",
  ...OVERMIND_HALF.slice(10),
]);

// --- larva ----------------------------------------------------------------

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

const COCOON = [
  "....k....",
  "....k....",
  "..kkkkk..",
  ".kbfbbbk.",
  "kbbfbbfbk",
  "kfbbbfbbk",
  "kbbfbbbfk",
  "kbfbbfbbk",
  "kbbbfbbbk",
  ".kfbbbfk.",
  ".kbbfbbk.",
  "..kbbbk..",
  "...kkk...",
];

const EGG = [".kk.", "kggk", "kgGk", ".kk."];

// --- territory --------------------------------------------------------------

// claimed land: the swarm's banner on a mound
const TERRITORY = [
  ".kk...........",
  ".kYkkkkkkkk...",
  ".kYkMMMMMMMk..",
  ".kYkMMyMyMMMk.",
  ".kYkMMMyMMMk..",
  ".kYkMMMMMMMMk.",
  ".kYkkkkkkkkk..",
  ".kYk..........",
  ".kYk..........",
  "kkYkkk........",
  "kDDEDDkk......",
  "kDEDDDEDkk....",
  "kDDDEDDDEDkk..",
  "kkkkkkkkkkkkk.",
];

const SWARMLING_A = [
  "........k.k...",
  ".......kPkPk..",
  "..kkkkkPPPPPk.",
  ".kbPPPPPlPPPPk",
  "kebPPlPPPlPPk.",
  "kbkPPPPPPPPPk.",
  ".kbkkkkkkkkk..",
  "..P.P...P.P...",
  ".P...P.P...P..",
];
const SWARMLING_B = [
  ...SWARMLING_A.slice(0, 7),
  "...PP....PP...",
  "..P..P..P..P..",
];

const STINGER_A = [
  "....ww..ww....",
  "...wWw.wWw....",
  "..kkkkkkkkk...",
  ".kePkllkllk...",
  ".kPPkPPkPPkbbb",
  "..kkkkkkkkk...",
  "...P.P.P......",
];
const STINGER_B = [
  "..............",
  "..wWwwwWww....",
  "..kkkkkkkkk...",
  ...STINGER_A.slice(3),
];

const SPIDER = mirror([
  "P.......",
  ".P....kk",
  "..P.kkpP",
  "PP.kpPlP",
  "..PkpPPP",
  "PPPkpPPP",
  "...kkpPP",
  "PPP.kpee",
  "...P.kpk",
  "..P...kb",
  ".P......",
]);

const MOSQUITO_A = rekey(
  sp([
    "......ww.ww.....",
    ".....wWw.wWww...",
    "...kk.kwwkkkkk..",
    "..kekkPPkMmMMMk.",
    "SSkkkPPPkMMmMMMk",
    "....kkkkkkkkkkk.",
    "...P.P..P.P.....",
    "..P..P...P.P....",
    ".P...P....P..P..",
    "P....P.....P....",
  ]),
  { P: "u" }
).rows;
const MOSQUITO_B = [
  "................",
  "....wWwwwWwww...",
  ...MOSQUITO_A.slice(2),
];

const LOCUST = [
  "..k.......kk....",
  "...k.....kVVk...",
  "...kkkkkkVkkVk..",
  "..kvvvvkkwwwwVk.",
  ".kevvvvkwwwwwwVk",
  ".kvvvVvkvVvvvvvk",
  "..kkkkkkkkkkkkkk",
  "...V.V..V.....Vk",
  "..V..V..V......k",
];

const ROACH = [
  "H..H............",
  ".H..H...........",
  "..kk.kkkkkkkk...",
  ".kHhkhhhHhhhhkk.",
  "kekHkhhxhhhHhhhk",
  ".kHhkHhhhhHhhhk.",
  "..kkkkkkkkkkkk..",
  "..H.H..H.H..H...",
];

const GIANTSPIDER = mirror([
  "u.........",
  ".u......kk",
  ".u....kkUU",
  "..u..kUUuU",
  "uu.ukUUUMM",
  "..uukUUUUM",
  "uuu.kUUUUU",
  "...ukkUUUU",
  "uuu..kUeeU",
  "...u..kUUk",
  "..u...kbkk",
  ".u.....b..",
  "u.........",
]);

const CENTIPEDE_A = [
  ".Y.Y..................",
  "..YY.kkk.kkk.kkk.kkk..",
  ".kkkkMmMkMmMkMmMkMmMk.",
  "kbeMkMMMkMMMkMMMkMMMMk",
  ".kbkkkkkkkkkkkkkkkkkk.",
  ".Y.Y.Y.Y.Y.Y.Y.Y.Y.Y..",
  "Y.Y.Y.Y.Y.Y.Y.Y.Y.Y.Y.",
];
const CENTIPEDE_B = [
  ...CENTIPEDE_A.slice(0, 5),
  "..Y.Y.Y.Y.Y.Y.Y.Y.Y.Y.",
  ".Y.Y.Y.Y.Y.Y.Y.Y.Y.Y..",
];

const WASP_A = [
  "........ww...ww....",
  ".......wWWw.wWWw...",
  "........wwwkwww....",
  "..kkkk.kkkk.kkkkk..",
  ".kyyyykkyyykkyYyYk.",
  "keyyyykYyyYkyyYyYyk",
  "kyyyYkkkYYkkkyYyYkb",
  ".kkkk..kkk...kkkkk.",
  "..Y.Y...Y.Y...Y....",
];
const WASP_B = [
  "...................",
  ".....wWWwwwwWWw....",
  ".......wwwwkwww....",
  ...WASP_A.slice(3),
];

const DEVOURER = mirror([
  "....kkkkk",
  "..kkfffff",
  ".kffkkkkk",
  ".kfkbkbkb",
  "kffkbkMMM",
  "kfkbkmMmm",
  "kfkkMmmkk",
  "kffkbkmmm",
  ".kfkbkbkb",
  ".kffkkkkk",
  "..kfffmff",
  "...kfmfff",
  "kDDkfffmf",
  "kDEDkffff",
  "kkkkkkkkk",
]);

// a bug piloting a flying metal exoskeleton
const GOON_A = [
  "...kkkkkkkk.......",
  "..kssssssssk......",
  "...kkkSkkkk.......",
  "..kkkkkSkkkkk.....",
  ".kSsssssssssSk....",
  "kSkPPksxsssSSk....",
  "kSkePksssssSSkyy..",
  "kSkkkkssssSSSkYyy.",
  ".kSSSSSSSSSSk.yY..",
  "..kSk....kSk......",
  ".kSSk...kSSk......",
];
const GOON_B = [
  ".kkkkkkkkkkkk.....",
  "kssssssssssssk....",
  ".kkkkkSkkkkkk.....",
  ...GOON_A.slice(3, 6),
  "kSkePksssssSSkjy..",
  "kSkkkkssssSSSkyjy.",
  ".kSSSSSSSSSSk.jy..",
  ...GOON_A.slice(9),
];

// --- energy -----------------------------------------------------------------

const ENERGY = [
  ".....kkkk.",
  "....kcxck.",
  "...kcWck..",
  "..kcWck...",
  ".kccckkkk.",
  "kcxccccck.",
  "kkkkcWcck.",
  "...kcWck..",
  "..kcWck...",
  ".kcck.....",
  "kck.......",
  "kk........",
];

// the nexus: a floating crystal spire over a rune stone
const NEXUS = mirror(
  [
    "......k",
    ".....kx",
    ".....kc",
    "....kcW",
    "....kcc",
    "...kcCW",
    "...kcCc",
    "...kCcc",
    "....kCc",
    ".....kc",
    "......k",
    ".......",
    "..kkkkk",
    ".kEcEsE",
    "kDDDDDD",
    "kkkkkkk",
  ],
  true
);

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

const NIGHTBUG = [
  "...ww.ww......",
  "..wWwwWww.....",
  ".kkkkkkkkkk...",
  "kePPkUUUkjjk..",
  "kPPPkUuUkjjjk.",
  ".kkkkkkkkkkk..",
  "..u.u.u.......",
];

const MOTH_HALF = [
  ".....u...",
  "......u..",
  ".kkk...uk",
  "kllPk..kU",
  "kllllkkkU",
  "klyykllkU",
  "kyeykllkU",
  "klyykllkU",
  ".kllllkkU",
  "..kPllk.U",
  "..klPlk.k",
  "...kkk...",
];
/** wings half-raised: squeeze each wing toward the body */
function squeeze(half: string[]): string[] {
  return half.map((r) => {
    const body = r.slice(-2);
    const wing = r.slice(0, -2);
    // drop the two inner columns of the wing (keeps the outline)
    return ".." + wing.slice(0, 1) + wing.slice(3) + body;
  });
}
const MOTH_A = mirror(MOTH_HALF);
const MOTH_B = mirror(squeeze(MOTH_HALF));

const BAT_HALF = [
  "........k.",
  "kk.....kUk",
  "kUk...kUUU",
  "kuUk..kUeU",
  "kuuUkkUUUU",
  "kuuuUUuUUU",
  "kuuuuuUkUU",
  ".kuukuukUk",
  "..kk.kk.k.",
];
const BAT_A = mirror(BAT_HALF);
const BAT_B = mirror([
  "..........",
  "........k.",
  ".......kUk",
  "kkk...kUUU",
  "kuUkk.kUeU",
  "kuuuUkUUUU",
  ".kuuuUuUUU",
  "..kkukkUUk",
  "....k...k.",
]);
// hanging upside down from a ceiling
const BAT_HANG = [
  ".k..k.",
  "kUkkUk",
  "kUUUUk",
  "kuUUuk",
  "kuUUuk",
  "kUeeUk",
  ".kUUk.",
  "..kk..",
];

// --- mutagen ----------------------------------------------------------------

const MUTAGEN = [
  "...kkkk...",
  "...kwWk...",
  "...kWwk...",
  "...kwwk...",
  "..kvvvvk..",
  ".kvvxvvvk.",
  "kvvvvvVvvk",
  "kvVvvvvvvk",
  "kvvvvVvvvk",
  ".kVvvvvVk.",
  "..kkkkkk..",
];

// inactive mutagen: a dormant glob, eyes shut
const PREMUTAGEN = [
  ".....kk.....",
  "....kGGk....",
  "...kGggGk...",
  "..kGgggxGk..",
  ".kGggggggGk.",
  "kGgkkgggkkGk",
  "kGggggggggGk",
  "kGGgggggggGk",
  ".kGGGGGGGGk.",
  "..kkkkkkkk..",
];

const MUTANTHATCHERY = [
  ".......v........",
  "......kVk.......",
  "....kkkVkkkk....",
  "...kvVvvVvvVk...",
  "..kVvkkvvkkvVk..",
  ".kvVkggkVkggkVk.",
  ".kVvkgGkvkgGkvk.",
  "kvVvvkkvVvkkvVvk",
  "kVvvVvVvvVvVvVvk",
  "kkkkkkkkkkkkkkkk",
];

const MUTANTCLONE = [
  "..kkkk....kkkk..",
  ".kvvvvk..kvvvvk.",
  "kvvxvvvkkvvxvvvk",
  "kvVvyvvVvvVvyvvk",
  "kvvvvvvkkvvvvvVk",
  ".kVvvvk..kVvvvk.",
  "..kkkk....kkkk..",
];

const MUTANTSWARMWARP = (() => {
  const g = new Grid(15, 15);
  for (let arm = 0; arm < 2; arm++) {
    for (let t = 0; t < 70; t++) {
      const a = t * 0.16 + arm * Math.PI;
      const r = 0.6 + t * 0.085;
      g.set(Math.round(7 + Math.cos(a) * r), Math.round(7 + Math.sin(a) * r), arm ? "l" : "v");
    }
  }
  g.set(7, 7, "x");
  return g.outline().rows();
})();

const MUTANTRUSH = [
  "..kk...kk.....",
  "..kvk..kvk....",
  "VV.kvk..kvk...",
  "....kvk..kvk..",
  "VVV..kvk..kvk.",
  "....kvk..kvk..",
  "VV.kvk..kvk...",
  "..kvk..kvk....",
  "..kk...kk.....",
];

const HELIX = (() => {
  const g = new Grid(11, 16);
  for (let y = 1; y < 15; y++) {
    const a = (y / 14) * Math.PI * 2;
    const x1 = Math.round(5 + Math.sin(a) * 3.6);
    const x2 = Math.round(5 - Math.sin(a) * 3.6);
    if (y % 2 === 0 && Math.abs(x1 - x2) > 2) g.line(Math.min(x1, x2) + 1, y, Math.max(x1, x2) - 1, y, "b");
    g.set(x1, y, "v");
    g.set(x2, y, Math.cos(a) > 0 ? "l" : "P");
  }
  return g.outline().rows();
})();

const MUTANTFREQ = [
  ".kkkkkkkkk.",
  "kbbbbbbbbbk",
  "kbvvbbbbbfk",
  "kbvVbbbbbfk",
  "kbbbbbbbbfk",
  "kbbbbvvbbfk",
  "kbbbbvVbbfk",
  "kbbbbbbbbfk",
  "kbbbbbbvvfk",
  "kbbbbbbvVfk",
  "kfffffffffk",
  ".kkkkkkkkk.",
];

const MUTANTMEAT = [
  "........kk..",
  ".......kvvk.",
  "..kk...kvvk.",
  ".kvvk...kk..",
  ".kvkkkkk....",
  "..kMMvMMk...",
  ".kMmMMfvMk..",
  "kMMmvMMmMbk.",
  "kmMMMmMMbbk.",
  ".kmmMMmmkk..",
  "..kkkkkk....",
];

const MUTANT = { P: "v", l: "j", p: "V", U: "V", u: "v", y: "j", Y: "V", e: "e" };

const ASCENSION = mirror(
  [
    ".....yyy",
    "....y...",
    ".....yyy",
    "........",
    "w......k",
    "ww....kx",
    "wWw..kxl",
    ".wWw.klP",
    "..wWwkPP",
    "...wkPPP",
    "....kPlP",
    "....kPPP",
    ".....kPP",
    "......kP",
    ".......k",
  ],
  true
);

// --- tables -----------------------------------------------------------------

const ROYAL = { p: "#2b1f5c", P: "#4d3fa0", l: "#8f86e6", y: "#f7d774", Y: "#b48a2c" };
const IMPERIAL = { p: "#5c1f2b", P: "#a03f4d", l: "#e68694", y: "#ffc070", Y: "#b8642a" };
const EMPRESS_PAL = { p: "#3a1550", P: "#8a3fb0", l: "#e0a8f5", w: "#c9a8e8", W: "#f4e6ff", y: "#ffe08a", Y: "#c48a2a" };
const OVERMIND_IRIS = ["#ff5a4f", "#f2b33d", "#9be36b", "#7fd6e8", "#c98cf0", "#ffffff"];
const OVERMIND_FLESH = [
  { r: "#e8728e", R: "#a8435f" },
  { r: "#e88a72", R: "#a8543f" },
  { r: "#c9e872", R: "#6f8a3a" },
  { r: "#72c9e8", R: "#3a6f8a" },
  { r: "#b872e8", R: "#6a3a9a" },
  { r: "#f2eef7", R: "#9a90a8" },
];

/** idle frames: [a, b], or a single frame */
const FRAMES: Record<string, Sprite[]> = {};
function unit(name: string, ...frames: Sprite[]): void {
  FRAMES[name] = frames;
}
const both = (a: string[], b: string[], pal?: Record<string, string>) => [sp(a, pal), sp(b, pal)] as const;

unit("meat", sp(MEAT));
unit("drone", ...both(DRONE_A, DRONE_B));
unit("queen", ...both(QUEEN_A, QUEEN_B));
unit("nest", sp(NEST, { d: "#4a2a2c", D: "#8a5450", E: "#b37a68" }));
unit("greaterqueen", ...both(GREATERQUEEN_A, GREATERQUEEN_B, ROYAL));
unit("hive", sp(HIVE));
unit("hivequeen", sp(HIVEQUEEN, IMPERIAL));
unit("empress", sp(EMPRESS, EMPRESS_PAL));
unit("prophet", sp(PROPHET, { r: "#d79be8", R: "#8a4fa8" }));
unit("goddess", sp(NEURON));
unit("pantheon", sp(CLUSTER, { r: "#f08aa8", R: "#b0506f" }));
unit("pantheon2", sp(NETWORK, { r: "#ff9fc0", R: "#c9688a" }));
unit("pantheon3", sp(BRAIN));
unit("pantheon4", sp(HIVEMIND, { r: "#d79be8", R: "#8a4fa8" }));
unit("pantheon5", sp(ARCHMIND, { r: "#f7c66b", R: "#b8782a", e: "#7fd6e8" }));
for (let i = 1; i <= 6; i++) {
  const pal = { ...OVERMIND_FLESH[i - 1], e: OVERMIND_IRIS[i - 1] };
  const pips = (rows: string[]) => (i === 1 ? rows : withPips(rows, i));
  unit(i === 1 ? "overmind" : `overmind${i}`, sp(pips(OVERMIND_A), pal), sp(pips(OVERMIND_B), pal));
}

unit("larva", ...both(LARVA_A, LARVA_B));
unit("cocoon", sp(COCOON, { f: "#c9b49c", b: "#f4ecdf" }));

unit("territory", sp(TERRITORY));
unit("swarmling", ...both(SWARMLING_A, SWARMLING_B));
unit("stinger", ...both(STINGER_A, STINGER_B, { l: "#d9a8ee" }));
unit("spider", sp(SPIDER));
unit("mosquito", ...both(MOSQUITO_A, MOSQUITO_B));
unit("locust", sp(LOCUST));
unit("roach", sp(ROACH));
unit("giantspider", sp(GIANTSPIDER));
unit("centipede", ...both(CENTIPEDE_A, CENTIPEDE_B, { M: "#d9663f", m: "#8f3a22", Y: "#e0a050" }));
unit("wasp", ...both(WASP_A, WASP_B));
unit("devourer", sp(DEVOURER));
unit("goon", ...both(GOON_A, GOON_B));

unit("energy", sp(ENERGY));
unit("nexus", sp(NEXUS));
unit("crystal", sp(CRYSTAL));
unit("nightbug", sp(NIGHTBUG), sp(NIGHTBUG, { j: "#8a9a52" }));
unit("moth", ...both(MOTH_A, MOTH_B));
unit("bat", ...both(BAT_A, BAT_B));

unit("mutagen", sp(MUTAGEN));
unit("premutagen", sp(PREMUTAGEN, { g: "#b8c4a0", G: "#6f7f5c" }));
unit("mutanthatchery", sp(MUTANTHATCHERY));
unit("mutantbat", ...both(BAT_A, BAT_B).map((s) => mutantEyes(rekey(s, MUTANT))));
unit("mutantclone", sp(MUTANTCLONE));
unit("mutantswarmwarp", sp(MUTANTSWARMWARP));
unit("mutantrush", sp(MUTANTRUSH));
unit("mutanteach", sp(HELIX));
unit("mutantfreq", sp(MUTANTFREQ));
unit("mutantnexus", ...both(MOTH_A, MOTH_B).map((s) => rekey(s, { ...MUTANT, l: "v", P: "V", y: "j" })));
unit("mutantarmy", ...both(SWARMLING_A, SWARMLING_B).map((s) => rekey(s, MUTANT)));
unit("mutantmeat", sp(MUTANTMEAT));
unit("ascension", sp(ASCENSION));

/** a third eye in the middle of the forehead: the mark of a mutant */
function mutantEyes(s: Sprite): Sprite {
  const rows = s.rows.slice();
  // find the eye row and put a glowing eye between the two
  const y = rows.findIndex((r) => r.includes("e"));
  if (y > 0) {
    const mid = Math.floor(s.w / 2);
    const up = rows[y - 1];
    rows[y - 1] = up.slice(0, mid - 1) + "jj" + up.slice(mid + 1);
  }
  return { ...s, rows };
}

/** Scene-only pieces that aren't units. */
export const PROPS = {
  egg: sp(EGG),
  batHang: sp(BAT_HANG),
  helix: sp(HELIX),
};

/** shown for a unit with no drawing; real units never get it (see art.test.ts) */
export const FALLBACK: Sprite = sp(EGG);

export function hasSprite(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FRAMES, name);
}

/** a unit's sprite (first idle frame) */
export function spriteFor(name: string, _tab?: string): Sprite {
  return hasSprite(name) ? FRAMES[name][0] : FALLBACK;
}

/** a unit's idle frames (one or two) */
export function framesFor(name: string): Sprite[] {
  return hasSprite(name) ? FRAMES[name] : [FALLBACK];
}

export function spriteNames(): string[] {
  return Object.keys(FRAMES);
}

/** the raw grids, for tests */
export function allUnitSprites(): [string, Sprite][] {
  return Object.entries(FRAMES).flatMap(([n, fs]) => fs.map((s, i) => [`${n}#${i}`, s] as [string, Sprite]));
}

export { recolor };
