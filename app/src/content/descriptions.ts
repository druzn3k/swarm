// Static fallbacks for descriptions the spreadsheet leaves as "-". The live
// templates (swarmsim-coffee/app/views/desc/) are ported in
// ./LiveDescription.tsx; these are used if a template can't be rendered.

export const unitDescriptions: Record<string, string> = {
  cocoon:
    "Each cocoon is a larva encased within a protective shell. Larvae can freely enter and leave their cocoons, but cannot be transformed into other units while cocooned. Clone Larvae clones cocoons as if they were normal larvae. Cocoon your larvae intended for cloning to avoid accidentally spending them.",
  territory: "Your swarm's military captures territory, fueling your expansion.",
  energy: "Energy is consumed to use special abilities.",
  nexus:
    "Nexus are the focal points for the energy needed to cast spells and use special abilities. Drawing energy from multiple nexus is powerful but difficult - each nexus is more expensive than the last, and ultimately there is a limit to the number of nexus your spellcasters can utilize.",
  crystal: "Energy frozen into a solid form. Crystals can be thawed and used as energy at any time.",
  nightbug: "Nightbugs wriggle and glow when exposed to the energy of your nexus. Gather nightbugs near your nexus to store additional energy.",
  moth: "Lepidoptera are mysterious creatures, with furry bodies and large wings, emerging from their dens only at night. The lepidoptera are attracted to the light of your nightbugs, and energy is attracted to the lepidoptera.",
  bat: "Bats empower all of your swarm's energy-based abilities.",
  mutagen: "Allows mutation, increasing the power of each member of your swarm.",
  premutagen:
    "Mutagen cannot be used while inactive. Ascend to begin a new swarm, resetting most of your units and upgrades, but activating all of your mutagen. Active mutagen allows powerful upgrades.",
  mutanthatchery: "Increases larvae production.",
  mutantbat: "Increases power of all abilities.",
  mutantclone: "Increases Clone Larvae's maximum.",
  mutantswarmwarp: "Increases Swarmwarp's power.",
  mutantrush: "Increases the power of Larvae Rush, Meat Rush and Territory Rush.",
  mutanteach: "When a hatchery or expansion spawns mutagen, more mutagen is generated.",
  mutantfreq: "Increases the chance of spawning mutagen when buying a hatchery or expansion.",
  mutantnexus: "Increases energy generation and maximum energy.",
  mutantarmy: "Increases all territory generated.",
  mutantmeat: "Makes your meat units more productive.",
};

const empower = (plural: string) => `Dramatically increase both your ${plural}' meat cost and territory captured. This will destroy all of your ${plural}.`;

export const upgradeDescriptions: Record<string, string> = {
  hatchery: "Each hatchery produces more larvae.",
  expansion: "Each expansion increases your hatcheries' larvae production.",
  clonearmy: "Summon a mirrored copy of your army. Unlike Clone Larvae, this ability has no cap.",
  clonelarvae: "Clone new larvae.",
  larvarush: "Instantly give birth to new larvae.",
  meatrush: "Instantly create new meat.",
  territoryrush: "Instantly capture new territory.",
  swarmwarp: "Warp time around your swarm. Instantly travel into the future, gaining production. Does not produce energy.",
  achievementbonus: "Larva production increases with your achievement points.",
  mutatearmy: "Increases the amount of territory captured, and increases the cost of unlocking other mutagen powers.",
  mutatebat: "Increases the power of all abilities, and increases the cost of unlocking other mutagen powers.",
  mutateclone: "Increases Clone Larvae's maximum, and increases the cost of unlocking other mutagen powers.",
  mutateeach: "When a hatchery or expansion spawns mutagen, more mutagen is generated. Increases the cost of unlocking other mutagen powers.",
  mutatefreq: "Increases the chance of spawning mutagen when buying a hatchery or expansion, and increases the cost of unlocking other mutagen powers.",
  mutatehatchery: "Increases larvae production, and increases the cost of unlocking other mutagen powers.",
  mutatemeat: "Increases production of all meat units, and increases the cost of unlocking other mutagen powers.",
  mutatenexus: "Increases energy generated, but also increases the energy cost of ascending. Increases the cost of unlocking other mutagen powers.",
  mutaterush: "Increases the power of Larvae Rush, Meat Rush, and Territory Rush, and increases the cost of unlocking other mutagen powers.",
  mutateswarmwarp: "Increases Swarmwarp's power, and increases the cost of unlocking other mutagen powers.",
  centipedeempower: empower("chilopodomorphs"),
  devourerempower: empower("devourers"),
  giantspiderempower: empower("giant arachnomorphs"),
  goonempower: empower("goons"),
  locustempower: empower("locusts"),
  mosquitoempower: empower("culicimorphs"),
  roachempower: empower("roaches"),
  spiderempower: empower("arachnomorphs"),
  stingerempower: empower("stingers"),
  swarmlingempower: empower("swarmlings"),
  waspempower: empower("wasps"),
};

const templated = (d: unknown) => d == null || d === "" || d === "-";

export function unitDescription(name: string, fromSheet: unknown): string {
  return templated(fromSheet) ? unitDescriptions[name] ?? "" : String(fromSheet);
}

export function upgradeDescription(name: string, fromSheet: unknown): string {
  return templated(fromSheet) ? upgradeDescriptions[name] ?? "" : String(fromSheet);
}
