import { memo, useRef, useState } from "react";
import { Num } from "@swarmsim/engine-wasm";
import { useGameValue, useGameValueEvery, useNeeds } from "../game/GameContext";
import type { UnitRef } from "../game/view";
import { useFormat } from "../format";
import type { Formatter } from "../format";
import { visibleUnits } from "../game/selectors";
import { unitHref } from "../router";
import { SpriteIcon } from "./Icon";
import { useInView } from "./useInView";
import { CardActions, ROW_EVERY } from "./unit/CardActions";
import { useOptions } from "../game/options";

function rateText(unit: UnitRef, tab: string, fmt: Formatter): string {
  const v = unit.velocity;
  if (!Num.isZero(v)) return fmt.rate(v, { unit: unit.name });
  // territory units: show what they capture (main.html special case; the list focuses them)
  if (tab === "territory") {
    const prod = unit.totalProduction;
    return Object.keys(prod)
      .filter((k) => !Num.isZero(prod[k]))
      .map((k) => fmt.rate(prod[k], { unit: k }))
      .join(" ");
  }
  return "";
}

const SEP = "\u0001";
/** ticks between re-reads of a card that is far off screen */
const OFFSCREEN_EVERY = 50;

/**
 * One unit's card. Re-renders only when its text changes. Next to a unit's
 * screen (laptop layout), cards refresh on every other tick, half of them on
 * each (`phase`), so the list costs half as much per tick. Cards far off
 * screen re-read the game only every few seconds.
 */
const UnitCard = memo(function UnitCard({
  unit,
  tab,
  advanced,
  current,
  phase,
  index,
  announce,
}: {
  unit: string;
  tab: string;
  advanced: boolean;
  current: boolean;
  phase?: number;
  index: number;
  announce: (text: string) => void;
}) {
  const fmt = useFormat();
  const item = useRef<HTMLLIElement>(null);
  // a card far off screen is re-read every few seconds (player actions at once)
  const near = useInView(item);
  const every = !near ? OFFSCREEN_EVERY : phase === undefined ? 1 : 2;
  const snapshot = useGameValueEvery((s) => {
    const u = s.g.unit(unit);
    const cap = u.cap ? `${fmt.percent(u.capPercent, { floor: true })} full` : "";
    return [fmt.num(u.count), rateText(u, tab, fmt), cap, u.suffix].join(SEP);
  }, every, phase);
  const [count, rate, cap, suffix] = snapshot.split(SEP);
  // the "new upgrade" marker weighs up every upgrade's cost: it is re-read as
  // often as the buy row (a few times a second), on other ticks than the row
  const upgradable = useGameValueEvery((s) => s.g.unit(unit).newlyUpgradable, near ? ROW_EVERY * every : every, index + ROW_EVERY / 2);
  const ref = useGameValue((s) => s.g.unit(unit).plural);
  const name = suffix ? `${ref} ${suffix}` : ref;
  const tabName = useGameValue((s) => s.g.unit(unit).tabName);
  return (
    <li className="card unit-item" ref={item}>
      <a className="unit-card" href={unitHref(unit)} data-unit={unit} aria-current={current ? "true" : undefined}>
        <SpriteIcon name={unit} tab={tabName} />
        <span className="unit-names">
          <span className="unit-name">{name}</span>
          <span className="unit-rate num">{rate}</span>
        </span>
        <span className="unit-count num">
          {count}
          {cap && <small>{cap}</small>}
        </span>
        <span className="chevron" aria-hidden="true" />
        {upgradable && <span className="upgrade-dot" role="img" aria-label="New upgrade available" title="New upgrade available" />}
      </a>
      {/* buy without opening the unit (a sibling of the link: no buttons inside <a>) */}
      <CardActions unit={unit} every={near ? ROW_EVERY * every : every} phase={index} advanced={advanced} announce={announce} />
    </li>
  );
});

/**
 * The visible units of a tab, as cards that open the unit screen, with a row
 * of quick buys under the buyable ones. Re-renders when the list changes;
 * cards update themselves. `selected` (laptop layout)
 * marks the card of the unit shown next to the list.
 */
export function UnitList({ tab, selected }: { tab: string; selected?: string }) {
  const names = useGameValue((s) => {
    const t = s.g.tab(tab);
    return t ? visibleUnits(t).map((u) => u.name).join(",") : "";
  });
  // the cards' quick "upgrade" buttons read their units' upgrades; the
  // territory list also shows what each army unit captures (a detail of each)
  const listed = names.split(",").filter(Boolean);
  useNeeds(tab === "territory" ? { upgrades: listed, focus: listed } : { upgrades: listed });
  const [{ showAdvancedUnitData }] = useOptions();
  // what the last quick buy did, for screen readers (one status line for the list)
  const [said, announce] = useState("");
  return (
    <>
      <ul className="unit-list">
        {names
          .split(",")
          .filter(Boolean)
          .map((n, i) => (
            <UnitCard
              key={n}
              unit={n}
              tab={tab}
              advanced={showAdvancedUnitData}
              current={n === selected}
              phase={selected === undefined ? undefined : i % 2}
              index={i}
              announce={announce}
            />
          ))}
      </ul>
      <p className="sr-only" role="status" data-slot="buy-status">
        {said}
      </p>
    </>
  );
}
