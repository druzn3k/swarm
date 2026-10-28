// Live unit and upgrade descriptions: a port of the old game's templates
// (swarmsim-coffee/app/views/desc/{unit,upgrade}/*.html), which the old
// `unitdesc`/`upgradedesc` directives used when the spreadsheet description
// is "-". Spreadsheet descriptions are shown as they are. Numbers are read
// from the engine on every render, like the old templates.
import type { ReactNode } from "react";
import { Decimal } from "@swarmsim/engine";
import type { Effect, Game, Unit, Upgrade } from "@swarmsim/engine";
import type { Formatter } from "../format";
import { useFormat } from "../format";
import { unitHref } from "../router";
import { unitDescription, unitDescriptions, upgradeDescription } from "./descriptions";

const isTemplated = (d: unknown) => d == null || d === "" || d === "-";

/** The old `percent` filter with `plusOne`: (v - 1) as a percentage. */
function plusOne(fmt: Formatter, v: unknown, places = 0): string {
  if (v == null) return "?";
  return fmt.percent(v as Decimal.Value, { plusOne: true, places });
}

function stats(effect: Effect | undefined): Record<string, Decimal> {
  return (effect?.calcStats() ?? {}) as Record<string, Decimal>;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const N = ({ children }: { children: ReactNode }) => <span className="num">{children}</span>;

/** Paragraphs, each a ReactNode. */
type Paras = ReactNode[];

// --- shared pieces -----------------------------------------------------------

/** "You produce X larvae per second, allowing you to clone up to <link>Y larvae</link>." (cocoon and clonelarvae) */
function cloneCapSentence(game: Game, fmt: Formatter): ReactNode {
  const effect = game.upgrade("clonelarvae").effect[0];
  const cap = effect.cap() as Decimal;
  const cocoon = game.unit("cocoon");
  const vu = fmt.velocityUnit();
  const capText = `${fmt.long(cap)} larvae`;
  const enough = cocoon.isVisible() && cocoon.count().greaterThanOrEqualTo(cap);
  return (
    <>
      You produce <N>{fmt.long(game.unit("larva").velocity().times(vu.mult))}</N> larvae per {vu.label}, allowing you to clone up to{" "}
      {enough ? (
        <N>{capText}</N>
      ) : (
        <a className="num" href={`${unitHref("cocoon")}?num=${encodeURIComponent("@" + cap.toString())}`}>
          {capText}
        </a>
      )}
      .
    </>
  );
}

/** The old <crystal-timer> directive: crystals awarded by the next hatchery or expansion. */
function crystalTimer(game: Game, fmt: Formatter, unittext = "hatchery or expansion"): ReactNode {
  if (!game.unit("energy").isVisible()) return null;
  const effect = game.upgrade("hatchery").effectByType.addUnitTimed?.[0];
  if (!effect) return null;
  const crystal = game.unit("crystal");
  const millis = Number(effect.val2) * 1000;
  const qty = String(effect.val);
  if (crystal.isAddUnitTimerReady(millis)) {
    return (
      <>
        Your next {unittext} will award <N>{qty}</N> crystals.
      </>
    );
  }
  return (
    <>
      After <N>{fmt.duration(crystal.addUnitTimerRemainingMillis(millis) / 1000)}</N>, your next {unittext} will award <N>{qty}</N> crystals.
    </>
  );
}

/** Mutagen from the next hatchery/expansion (views/desc/upgrade/{hatchery,expansion}.html). */
function mutagenChance(upgrade: Upgrade, fmt: Formatter, plural: string): ReactNode {
  const game = upgrade.game;
  const minlevel = upgrade.unit.stat(`random.minlevel.${upgrade.name}`);
  if (upgrade.count().greaterThanOrEqualTo(minlevel)) {
    const next = upgrade.effect[1]?.outputNext() as { qty?: Decimal } | undefined;
    return (
      <span title="Savescumming won't work, by the way.">
        Your next {upgrade.name} has a <N>{fmt.percent(upgrade.unit.stat("random.freq"))}</N> chance to award <N>{fmt.long(next?.qty ?? 0)}</N>{" "}
        mutagen.
      </span>
    );
  }
  if (game.unit("mutagen").isVisible()) {
    return (
      <>
        Build <N>{fmt.long(minlevel)}</N> {plural} to begin earning mutagen.
      </>
    );
  }
  return null;
}

// --- units ---------------------------------------------------------------------

function unitTemplate(unit: Unit, fmt: Formatter): Paras | null {
  const game = unit.game;
  const e = unit.effect ?? [];
  switch (unit.name) {
    case "cocoon":
      return [
        "Each cocoon is a larva encased within a protective shell. Larvae can freely enter and leave their cocoons, but cannot be transformed into other units while cocooned.",
        "Clone Larvae clones cocoons as if they were normal larvae. Cocoon your larvae intended for cloning to avoid accidentally spending them.",
        cloneCapSentence(game, fmt),
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
        crystalTimer(game, fmt),
        <>
          Converting crystals has permanently increased your maximum energy by <N>{fmt.long(game.unit("mtxEnergy").count())}</N>.
        </>,
      ];
    case "bat":
      return [
        "Bats empower all of your swarm's energy-based abilities.",
        <>
          Your bats make your abilities <N>{plusOne(fmt, stats(e[0]).power, 2)}</N> more powerful. Raising more has diminishing returns, but can increase this to a
          maximum of <N>{plusOne(fmt, e[0]?.val)}</N>.
        </>,
      ];
    case "moth":
      return [
        "Lepidoptera are mysterious creatures, with furry bodies and large wings, emerging from their dens only at night. The lepidoptera are attracted to the light of your nightbugs, and energy is attracted to the lepidoptera.",
        <>
          Your lepidoptera generate <N>{plusOne(fmt, stats(e[0]).prod, 2)}</N> more energy. Hatching more has diminishing returns, but can increase this to a maximum
          of <N>{plusOne(fmt, e[0]?.val)}</N>.
        </>,
      ];
    case "nightbug":
      return [
        "Nightbugs wriggle and glow when exposed to the energy of your nexus. Gather nightbugs near your nexus to store additional energy.",
        <>
          Your nightbugs store up to <N>{plusOne(fmt, stats(e[0]).capMult, 2)}</N> more maximum energy. Hatching more has diminishing returns, but can increase
          this to a maximum of <N>{plusOne(fmt, e[0]?.val)}</N>.
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
          Increases all territory generated by <N>{plusOne(fmt, stats(e[0]).prod, 2)}</N>.
        </>,
      ];
    case "mutantbat":
      return [
        <>
          Increases power of all abilities by <N>{plusOne(fmt, stats(e[0]).power, 2)}</N>.
        </>,
      ];
    case "mutantclone":
      return [
        <>
          Increases Clone Larvae's maximum by <N>{plusOne(fmt, stats(e[0])["power.clonelarvae"], 2)}</N>.
        </>,
      ];
    case "mutanteach":
      return [
        <>
          When a hatchery or expansion spawns mutagen, <N>{plusOne(fmt, stats(e[0])["random.each"], 2)}</N> more mutagen is generated.
        </>,
      ];
    case "mutantfreq": {
      const freq = stats(e[0])["random.freq"];
      const chance = freq == null ? undefined : new Decimal(e[1].val + "").times(new Decimal(freq).minus(1));
      return [
        <>
          Increases the chance of spawning mutagen when buying a hatchery or expansion by <N>{chance ? fmt.percent(chance, { places: 2 }) : "?"}</N>.
        </>,
        <>
          You currently have a <N>{fmt.percent(e[0].unit.stat("random.freq"), { places: 2 })}</N> chance to spawn mutagen. More {unit.unittype.plural} have
          diminishing returns, but can increase this to a maximum of <N>{fmt.percent(new Decimal(e[1].val + "").times(e[0].val + ""), { places: 2 })}</N>.
        </>,
      ];
    }
    case "mutanthatchery":
      return [
        <>
          Increases larvae production by <N>{plusOne(fmt, stats(e[0]).prod, 2)}</N>.
        </>,
        unit.count().lessThanOrEqualTo(10) ? (
          <i>Raw mutagen produces larvae that doesn't benefit from hatchery mutations. Don't spend all your mutagen too early!</i>
        ) : null,
      ];
    case "mutantmeat":
      return e.map((effect) =>
        effect.unit?.isVisible() ? (
          <>
            {capitalize(effect.unit.unittype.plural as string)} are <N>{plusOne(fmt, stats(effect).prod, 2)}</N> more productive.
          </>
        ) : null
      );
    case "mutantnexus":
      return [
        <>
          Increases energy generation by <N>{plusOne(fmt, stats(e[0]).prod, 2)}</N>. Creating more has diminishing returns, but increases this to a maximum of{" "}
          <N>{plusOne(fmt, e[0]?.val, 2)}</N>.
        </>,
        <>
          Increases maximum energy by <N>{plusOne(fmt, stats(e[1]).capMult, 2)}</N>. Creating more has diminishing returns, but increases this to a maximum of{" "}
          <N>{plusOne(fmt, e[1]?.val, 2)}</N>.
        </>,
        <>
          However, <N>{plusOne(fmt, stats(e[2]).ascendCost, 2)}</N> more energy must be spent to decrease ascension costs. Creating more increases this to a
          maximum of <N>{plusOne(fmt, e[2]?.val, 2)}</N>.
        </>,
      ];
    case "mutantrush":
      return [
        <>
          Increases Larvae Rush's power by <N>{plusOne(fmt, stats(e[0])["power.larvarush"], 2)}</N>.
        </>,
        <>
          Increases Meat Rush's power by <N>{plusOne(fmt, stats(e[1])["power.meatrush"], 2)}</N>.
        </>,
        <>
          Increases Territory Rush's power by <N>{plusOne(fmt, stats(e[2])["power.territoryrush"], 2)}</N>.
        </>,
      ];
    case "mutantswarmwarp":
      return [
        <>
          Increases Swarmwarp's power by <N>{plusOne(fmt, stats(e[0])["power.swarmwarp"], 2)}</N>.
        </>,
      ];
  }
  return null;
}

/** A unit's description paragraphs: the spreadsheet text, or the live template. */
export function unitDescriptionParas(unit: Unit, fmt: Formatter): Paras {
  const sheet = unit.unittype.description;
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

function out(upgrade: Upgrade, i: number): Decimal {
  return upgrade.effect[i].output() as Decimal;
}

function empower(upgrade: Upgrade, fmt: Formatter, unitName: string): Paras {
  const unit = upgrade.game.unit(unitName);
  const plural = unit.unittype.plural as string;
  return [
    `Dramatically increase both your ${plural}' meat cost and territory captured.`,
    <>
      This will destroy all <N>{fmt.long(unit.count())}</N> of your {plural}.
    </>,
  ];
}

function upgradeTemplate(upgrade: Upgrade, fmt: Formatter): Paras | null {
  const game = upgrade.game;
  const name = upgrade.name;
  if (/empower$/.test(name)) return empower(upgrade, fmt, name.replace(/empower$/, ""));
  switch (name) {
    case "achievementbonus":
      return [
        <>
          Larva production increased by <N>{fmt.percent(Number(upgrade.type.effect[0].val) * 10)}</N> per 10 achievement points.
        </>,
      ];
    case "hatchery": {
      const vu = fmt.velocityUnit();
      const each = new Decimal(upgrade.type.effect[0].val + "").times(vu.mult);
      const total = (upgrade.unit.totalProduction().larva ?? new Decimal(0)).times(vu.mult);
      const base = new Decimal(upgrade.unit.prod[0].val + "").plus(stats(upgrade.effect[0]).base ?? 0).times(vu.mult);
      return [
        <>
          Each hatchery produces <N>{fmt.long(each)}</N> more larvae per {vu.label}. Currently, your hatcheries produce a total of <N>{fmt.long(total, 0)}</N> larvae
          per {vu.label}. With no multipliers, they would produce <N>{fmt.long(base, 0)}</N> larvae per {vu.label}.
        </>,
        mutagenChance(upgrade, fmt, "hatcheries"),
        crystalTimer(game, fmt, "hatchery"),
      ];
    }
    case "expansion": {
      const prod = stats(upgrade.effect[0]).prod;
      const current = prod == null ? "?" : fmt.long(new Decimal(prod).minus(1).times(100)) + "%";
      return [
        <>
          Each expansion increases your hatcheries' larvae production by <N>{plusOne(fmt, upgrade.type.effect[0].val)}</N>. Currently, your expansions increase
          hatchery production by <N>{current}</N>.
        </>,
        mutagenChance(upgrade, fmt, "expansions"),
        crystalTimer(game, fmt, "expansion"),
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
      const effect = upgrade.effect[0];
      return [
        <>
          Clone <N>{fmt.long(effect.output())}</N> new larvae.
        </>,
        <>
          {cloneCapSentence(game, fmt)} You have <N>{fmt.long(effect.bank())}</N> larvae and cocoons available to clone.
        </>,
      ];
    }
    case "clonearmy":
      return [
        <span title="Bloody Mary, Bloody Mary, Bloody Mary">Summon a mirrored copy of your army. Unlike Clone Larvae, this ability has no cap.</span>,
        ...upgrade.effect.map((effect) => {
          const n = effect.output() as Decimal;
          return n.greaterThan(0) ? (
            <>
              Create <N>{fmt.long(n)}</N> {effect.unit.unittype.plural}.
            </>
          ) : null;
        }),
      ];
  }
  return null;
}

/** An upgrade's or ability's description paragraphs: the spreadsheet text, or the live template. */
export function upgradeDescriptionParas(upgrade: Upgrade, fmt: Formatter): Paras {
  const sheet = upgrade.type.description;
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

export function UnitDescription({ unit }: { unit: Unit }) {
  return <Paragraphs paras={unitDescriptionParas(unit, useFormat())} />;
}

export function UpgradeDescription({ upgrade }: { upgrade: Upgrade }) {
  return <Paragraphs paras={upgradeDescriptionParas(upgrade, useFormat())} />;
}

