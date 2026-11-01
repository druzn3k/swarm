// Live unit and upgrade descriptions: a port of the old game's templates
// (swarmsim-coffee/app/views/desc/{unit,upgrade}/*.html), which the old
// `unitdesc`/`upgradedesc` directives used when the spreadsheet description
// is "-". Spreadsheet descriptions are shown as they are. Numbers are read
// from the engine on every render, like the old templates.
import type { ReactNode } from "react";
import { Dec } from "@swarmsim/engine-wasm";
import type { NumString } from "@swarmsim/engine-wasm";
import type { Formatter } from "../format";
import { useFormat } from "../format";
import type { Need } from "../game/store";
import type { EffectRef, GameView, UnitRef, UpgradeRef } from "../game/view";
import { unitHref } from "../router";
import { unitDescription, unitDescriptions, upgradeDescription } from "./descriptions";

const isTemplated = (d: unknown) => d == null || d === "" || d === "-";

/**
 * What a unit's screen needs in the view for its descriptions: the unit's
 * details (its effects, its upgrades' effects), plus the few templates that
 * read another unit: cocoon reads Clone Larvae (an energy ability), crystal
 * the hatchery's crystal timer (listed with larvae), and the hatchery's and
 * mutagen-chance texts read the hidden unit that owns hatcheries.
 */
export function descriptionNeed(g: GameView, unit: string | undefined): Need {
  if (!unit) return {};
  const focus = [unit];
  const hidden: string[] = [];
  if (unit === "cocoon") focus.push(g.s.units[g.s.upgrades[g.s.upgradeIndex("clonelarvae")!].unit].name);
  if (unit === "crystal") focus.push("larva");
  if (unit === "larva" || unit === "mutantfreq") hidden.push(g.s.units[g.s.upgrades[g.s.upgradeIndex("hatchery")!].unit].name);
  return { focus, hidden };
}

/** A value the template can't do without; a missing one (not in the view yet) falls back to the static text. */
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`not in the view: ${what}`);
  return v;
}

/** The old `percent` filter with `plusOne`: (v - 1) as a percentage. */
function plusOne(fmt: Formatter, v: NumString | undefined, places = 0): string {
  if (v == null) return "?";
  return fmt.percent(v, { plusOne: true, places });
}

/** An effect's own stats (calcStats), by stat name. */
function stats(effect: EffectRef | undefined, g: GameView): Record<string, NumString> {
  const out: Record<string, NumString> = {};
  for (const [i, v] of effect?.v?.stats ?? []) out[g.s.stats[i]] = v;
  return out;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const N = ({ children }: { children: ReactNode }) => <span className="num">{children}</span>;

/** Paragraphs, each a ReactNode. */
type Paras = ReactNode[];

// --- shared pieces -----------------------------------------------------------

/** "You produce X larvae per second, allowing you to clone up to <link>Y larvae</link>." (cocoon and clonelarvae) */
function cloneCapSentence(g: GameView, fmt: Formatter): ReactNode {
  const effect = g.upgrade("clonelarvae").effects[0];
  const cap = must(effect?.v?.cap, "clonelarvae cap");
  const cocoon = g.unit("cocoon");
  const vu = fmt.velocityUnit();
  const capText = `${fmt.long(cap)} larvae`;
  const enough = cocoon.visible && Dec.from(cocoon.count).gte(cap);
  return (
    <>
      You produce <N>{fmt.long(Dec.from(g.unit("larva").velocity).times(vu.mult))}</N> larvae per {vu.label}, allowing you to clone up to{" "}
      {enough ? (
        <N>{capText}</N>
      ) : (
        <a className="num" href={`${unitHref("cocoon")}?num=${encodeURIComponent("@" + Dec.from(cap).toString())}`}>
          {capText}
        </a>
      )}
      .
    </>
  );
}

/** The old <crystal-timer> directive: crystals awarded by the next hatchery or expansion. */
function crystalTimer(g: GameView, fmt: Formatter, unittext = "hatchery or expansion"): ReactNode {
  if (!g.unit("energy").visible) return null;
  const effect = g.upgrade("hatchery").effects.find((e) => e.st.kind === "addUnitTimed");
  if (!effect) return null;
  const qty = Dec.from(effect.st.val ?? "0").toString();
  const remaining = must(effect.v?.timer_remaining_ms, "crystal timer");
  if (remaining <= 0) {
    return (
      <>
        Your next {unittext} will award <N>{qty}</N> crystals.
      </>
    );
  }
  return (
    <>
      After <N>{fmt.duration(remaining / 1000)}</N>, your next {unittext} will award <N>{qty}</N> crystals.
    </>
  );
}

/** Mutagen from the next hatchery/expansion (views/desc/upgrade/{hatchery,expansion}.html). */
function mutagenChance(upgrade: UpgradeRef, fmt: Formatter, plural: string): ReactNode {
  const g = upgrade.g;
  const minlevel = must(upgrade.unit.stat(`random.minlevel.${upgrade.name}`), "minlevel");
  if (Dec.from(upgrade.count).gte(minlevel)) {
    const next = upgrade.effects[1]?.v?.rand_next;
    return (
      <span title="Savescumming won't work, by the way.">
        Your next {upgrade.name} has a <N>{fmt.percent(must(upgrade.unit.stat("random.freq"), "random.freq"))}</N> chance to award{" "}
        <N>{fmt.long(next?.qty ?? 0)}</N> mutagen.
      </span>
    );
  }
  if (g.unit("mutagen").visible) {
    return (
      <>
        Build <N>{fmt.long(minlevel)}</N> {plural} to begin earning mutagen.
      </>
    );
  }
  return null;
}

// --- units ---------------------------------------------------------------------

function unitTemplate(unit: UnitRef, fmt: Formatter): Paras | null {
  const g = unit.g;
  const e = unit.effects;
  const st = (effect: EffectRef | undefined) => stats(effect, g);
  switch (unit.name) {
    case "cocoon":
      return [
        "Each cocoon is a larva encased within a protective shell. Larvae can freely enter and leave their cocoons, but cannot be transformed into other units while cocooned.",
        "Clone Larvae clones cocoons as if they were normal larvae. Cocoon your larvae intended for cloning to avoid accidentally spending them.",
        cloneCapSentence(g, fmt),
      ];
    case "energy":
      // the capacity bar and "x / y energy" are the CapInfo card on the unit screen
      return [
        <span title="Coffee is consumed to restore energy.">Energy is consumed to use special abilities.</span>,
        <a href={unitHref("crystal")}>Need more energy?</a>,
      ];
    case "crystal":
      // crystal sales (MTX) are dropped; the energy buy input follows on the unit screen
      return [
        <span title="What should I name this new currency? It's a Golden opportunity to get Kredit for Coining a real Gem. Another Point, though - if I choose badly, they'll say &quot;what a RubeHe is. Just DieMan.&quot; I'm sure the answer will be Crystal clear soon enough.">
          Energy frozen into a solid form. Crystals can be thawed and used as energy at any time. Unlike energy, crystals have no maximum, and are kept when ascending.
        </span>,
        crystalTimer(g, fmt),
        <>
          Converting crystals has permanently increased your maximum energy by <N>{fmt.long(g.unit("mtxEnergy").count)}</N>.
        </>,
      ];
    case "bat":
      return [
        "Bats empower all of your swarm's energy-based abilities.",
        <>
          Your bats make your abilities <N>{plusOne(fmt, st(e[0]).power, 2)}</N> more powerful. Raising more has diminishing returns, but can increase this to a
          maximum of <N>{plusOne(fmt, e[0]?.st.val)}</N>.
        </>,
      ];
    case "moth":
      return [
        "Lepidoptera are mysterious creatures, with furry bodies and large wings, emerging from their dens only at night. The lepidoptera are attracted to the light of your nightbugs, and energy is attracted to the lepidoptera.",
        <>
          Your lepidoptera generate <N>{plusOne(fmt, st(e[0]).prod, 2)}</N> more energy. Hatching more has diminishing returns, but can increase this to a maximum
          of <N>{plusOne(fmt, e[0]?.st.val)}</N>.
        </>,
      ];
    case "nightbug":
      return [
        "Nightbugs wriggle and glow when exposed to the energy of your nexus. Gather nightbugs near your nexus to store additional energy.",
        <>
          Your nightbugs store up to <N>{plusOne(fmt, st(e[0]).capMult, 2)}</N> more maximum energy. Hatching more has diminishing returns, but can increase
          this to a maximum of <N>{plusOne(fmt, e[0]?.st.val)}</N>.
        </>,
      ];
    case "nexus":
      return [
        "Nexus are the focal points for the energy needed to cast spells and use special abilities.",
        "Drawing energy from multiple nexus is powerful but difficult - each nexus is more expensive than the last, and ultimately there is a limit to the number of nexus your spellcasters can utilize.",
      ];
    case "territory":
      // the production chart follows on the unit screen
      return [<span title="Your terrifying warriors tear through their foes to capture territory.">{unitDescriptions.territory}</span>];
    case "mutagen":
      // ascension and respec are the AscensionPanel on the unit screen
      return [<span title="Also creates heroic turtles.">{unitDescriptions.mutagen}</span>];
    case "mutantarmy":
      return [
        <>
          Increases all territory generated by <N>{plusOne(fmt, st(e[0]).prod, 2)}</N>.
        </>,
      ];
    case "mutantbat":
      return [
        <>
          Increases power of all abilities by <N>{plusOne(fmt, st(e[0]).power, 2)}</N>.
        </>,
      ];
    case "mutantclone":
      return [
        <>
          Increases Clone Larvae's maximum by <N>{plusOne(fmt, st(e[0])["power.clonelarvae"], 2)}</N>.
        </>,
      ];
    case "mutanteach":
      return [
        <>
          When a hatchery or expansion spawns mutagen, <N>{plusOne(fmt, st(e[0])["random.each"], 2)}</N> more mutagen is generated.
        </>,
      ];
    case "mutantfreq": {
      const freq = st(e[0])["random.freq"];
      const chance = freq == null ? undefined : Dec.from(must(e[1].st.val, "val")).times(Dec.from(freq).minus(1));
      return [
        <>
          Increases the chance of spawning mutagen when buying a hatchery or expansion by <N>{chance ? fmt.percent(chance, { places: 2 }) : "?"}</N>.
        </>,
        <>
          You currently have a <N>{fmt.percent(must(e[0].unit?.stat("random.freq"), "random.freq"), { places: 2 })}</N> chance to spawn mutagen. More{" "}
          {unit.plural} have diminishing returns, but can increase this to a maximum of{" "}
          <N>{fmt.percent(Dec.from(must(e[1].st.val, "val")).times(must(e[0].st.val, "val")), { places: 2 })}</N>.
        </>,
      ];
    }
    case "mutanthatchery":
      return [
        <>
          Increases larvae production by <N>{plusOne(fmt, st(e[0]).prod, 2)}</N>.
        </>,
        Dec.from(unit.count).lte(10) ? (
          <i>Raw mutagen produces larvae that doesn't benefit from hatchery mutations. Don't spend all your mutagen too early!</i>
        ) : null,
      ];
    case "mutantmeat":
      return e.map((effect) =>
        effect.unit?.visible ? (
          <>
            {capitalize(effect.unit.plural)} are <N>{plusOne(fmt, st(effect).prod, 2)}</N> more productive.
          </>
        ) : null
      );
    case "mutantnexus":
      return [
        <>
          Increases energy generation by <N>{plusOne(fmt, st(e[0]).prod, 2)}</N>. Creating more has diminishing returns, but increases this to a maximum of{" "}
          <N>{plusOne(fmt, e[0]?.st.val, 2)}</N>.
        </>,
        <>
          Increases maximum energy by <N>{plusOne(fmt, st(e[1]).capMult, 2)}</N>. Creating more has diminishing returns, but increases this to a maximum of{" "}
          <N>{plusOne(fmt, e[1]?.st.val, 2)}</N>.
        </>,
        <>
          However, <N>{plusOne(fmt, st(e[2]).ascendCost, 2)}</N> more energy must be spent to decrease ascension costs. Creating more increases this to a
          maximum of <N>{plusOne(fmt, e[2]?.st.val, 2)}</N>.
        </>,
      ];
    case "mutantrush":
      return [
        <>
          Increases Larvae Rush's power by <N>{plusOne(fmt, st(e[0])["power.larvarush"], 2)}</N>.
        </>,
        <>
          Increases Meat Rush's power by <N>{plusOne(fmt, st(e[1])["power.meatrush"], 2)}</N>.
        </>,
        <>
          Increases Territory Rush's power by <N>{plusOne(fmt, st(e[2])["power.territoryrush"], 2)}</N>.
        </>,
      ];
    case "mutantswarmwarp":
      return [
        <>
          Increases Swarmwarp's power by <N>{plusOne(fmt, st(e[0])["power.swarmwarp"], 2)}</N>.
        </>,
      ];
  }
  return null;
}

/** A unit's description paragraphs: the spreadsheet text, or the live template. */
export function unitDescriptionParas(unit: UnitRef, fmt: Formatter): Paras {
  const sheet = unit.st.description;
  if (!isTemplated(sheet)) return [String(sheet)];
  try {
    const live = unitTemplate(unit, fmt);
    if (live) return live;
  } catch (e) {
    console.warn("description", unit.name, e);
  }
  const text = unitDescription(unit.name, sheet);
  return text ? [text] : [];
}

// --- upgrades and abilities -----------------------------------------------------

function out(upgrade: UpgradeRef, i: number): Dec {
  return Dec.from(must(upgrade.effects[i]?.v?.output, `${upgrade.name} output`));
}

function empower(upgrade: UpgradeRef, fmt: Formatter, unitName: string): Paras {
  const unit = upgrade.g.unit(unitName);
  const plural = unit.plural;
  return [
    `Dramatically increase both your ${plural}' meat cost and territory captured.`,
    <>
      This will destroy all <N>{fmt.long(unit.count)}</N> of your {plural}.
    </>,
  ];
}

function upgradeTemplate(upgrade: UpgradeRef, fmt: Formatter): Paras | null {
  const g = upgrade.g;
  const name = upgrade.name;
  const st = (effect: EffectRef | undefined) => stats(effect, g);
  const val = (i: number) => must(upgrade.effects[i]?.st.val, "val");
  if (/empower$/.test(name)) return empower(upgrade, fmt, name.replace(/empower$/, ""));
  switch (name) {
    case "achievementbonus":
      return [
        <>
          Larva production increased by <N>{fmt.percent(Number(val(0)) * 10)}</N> per 10 achievement points.
        </>,
      ];
    case "hatchery": {
      const vu = fmt.velocityUnit();
      const each = Dec.from(val(0)).times(vu.mult);
      const unit = upgrade.unit;
      if (!unit.detailed && !g.hidden.has(unit.id)) throw new Error("hatchery production not in the view");
      const total = Dec.from(unit.totalProduction.larva ?? 0).times(vu.mult);
      const base = Dec.from(must(unit.st.prod?.[0]?.[1], "prod")).plus(st(upgrade.effects[0]).base ?? 0).times(vu.mult);
      return [
        <>
          Each hatchery produces <N>{fmt.long(each)}</N> more larvae per {vu.label}. Currently, your hatcheries produce a total of <N>{fmt.long(total, 0)}</N> larvae
          per {vu.label}. With no multipliers, they would produce <N>{fmt.long(base, 0)}</N> larvae per {vu.label}.
        </>,
        mutagenChance(upgrade, fmt, "hatcheries"),
        crystalTimer(g, fmt, "hatchery"),
      ];
    }
    case "expansion": {
      const prod = st(upgrade.effects[0]).prod;
      const current = prod == null ? "?" : fmt.long(Dec.from(prod).minus(1).times(100)) + "%";
      return [
        <>
          Each expansion increases your hatcheries' larvae production by <N>{plusOne(fmt, val(0))}</N>. Currently, your expansions increase
          hatchery production by <N>{current}</N>.
        </>,
        mutagenChance(upgrade, fmt, "expansions"),
        crystalTimer(g, fmt, "expansion"),
      ];
    }
    case "larvarush":
      return [
        <>
          Instantly give birth to <N>{fmt.long(out(upgrade, 0).plus(out(upgrade, 1)))}</N> new larvae.
        </>,
      ];
    case "meatrush":
      return [
        <>
          Instantly create <N>{fmt.long(out(upgrade, 0).plus(out(upgrade, 1)))}</N> new meat.
        </>,
      ];
    case "territoryrush":
      return [
        <>
          Instantly capture <N>{fmt.long(out(upgrade, 0).plus(out(upgrade, 1)))}</N> new territory.
        </>,
      ];
    case "swarmwarp":
      return [
        <>
          Warp time around your swarm. Instantly travel into the future, gaining <N>{fmt.duration(out(upgrade, 0))}</N> of production. Does not produce energy.
        </>,
      ];
    case "clonelarvae": {
      const effect = upgrade.effects[0];
      return [
        <>
          Clone <N>{fmt.long(must(effect?.v?.output, "output"))}</N> new larvae.
        </>,
        <>
          {cloneCapSentence(g, fmt)} You have <N>{fmt.long(must(effect?.v?.bank, "bank"))}</N> larvae and cocoons available to clone.
        </>,
      ];
    }
    case "clonearmy":
      return [
        <span title="Bloody Mary, Bloody Mary, Bloody Mary">Summon a mirrored copy of your army. Unlike Clone Larvae, this ability has no cap.</span>,
        ...upgrade.effects.map((effect) => {
          const n = Dec.from(must(effect.v?.output, "output"));
          return n.gt(0) ? (
            <>
              Create <N>{fmt.long(n)}</N> {effect.unit?.plural}.
            </>
          ) : null;
        }),
      ];
  }
  return null;
}

/** An upgrade's or ability's description paragraphs: the spreadsheet text, or the live template. */
export function upgradeDescriptionParas(upgrade: UpgradeRef, fmt: Formatter): Paras {
  const sheet = upgrade.st.description;
  if (!isTemplated(sheet)) return [String(sheet)];
  try {
    const live = upgradeTemplate(upgrade, fmt);
    if (live) return live;
  } catch (e) {
    console.warn("description", upgrade.name, e);
  }
  const text = upgradeDescription(upgrade.name, sheet);
  return text ? [text] : [];
}

function Paragraphs({ paras }: { paras: Paras }) {
  return (
    <>
      {paras.map((p, i) =>
        p == null || p === "" ? null : (
          <p className="desc" key={i}>
            {p}
          </p>
        )
      )}
    </>
  );
}

export function UnitDescription({ unit }: { unit: UnitRef }) {
  return <Paragraphs paras={unitDescriptionParas(unit, useFormat())} />;
}

export function UpgradeDescription({ upgrade }: { upgrade: UpgradeRef }) {
  // the unit screen asks for what its descriptions read (descriptionNeed)
  return <Paragraphs paras={upgradeDescriptionParas(upgrade, useFormat())} />;
}

