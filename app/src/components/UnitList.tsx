import type { Tab, Unit } from "@swarmsim/engine";
import { memo, useRef, useState } from "react";
import { useGameValue, useGameValueEvery, useStore } from "../game/GameContext";
import { useFormat } from "../format";
import type { Formatter } from "../format";
import { unitLabel, visibleUnits } from "../game/selectors";
import { unitHref } from "../router";
import { SpriteIcon } from "./Icon";
import { useInView } from "./useInView";
import { CardActions, ROW_EVERY } from "./unit/CardActions";
import { useOptions } from "../game/options";

function rateText(unit: Unit, tab: Tab, fmt: Formatter): string {
  const v = unit.velocity();
  if (!v.isZero()) return fmt.rate(v, { unit: unit.name });
  // territory units: show what they capture (main.html special case)
  if (tab.name === "territory") {
    const prod = unit.totalProduction();
    return Object.keys(prod)
      .filter((k) => !prod[k].isZero())
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
  unit: Unit;
  tab: Tab;
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
  const snapshot = useGameValueEvery(() => {
    const cap = unit.capValue() ? `${fmt.percent(unit.capPercent(), { floor: true })} full` : "";
    return [fmt.num(unit.count()), rateText(unit, tab, fmt), cap].join(SEP);
  }, every, phase);
  const [count, rate, cap] = snapshot.split(SEP);
  // the "new upgrade" marker weighs up every upgrade's cost: it is re-read as
  // often as the buy row (a few times a second), on other ticks than the row
  const upgradable = useGameValueEvery(() => unit.isNewlyUpgradable(), near ? ROW_EVERY * every : every, index + ROW_EVERY / 2);
  const name = unitLabel(unit, true);
  return (
    <li className="card unit-item" ref={item}>
      <a className="unit-card" href={unitHref(unit.name)} data-unit={unit.name} aria-current={current ? "true" : undefined}>
        <SpriteIcon name={unit.name} tab={unit.unittype.tab} />
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
export function UnitList({ tab, selected }: { tab: Tab; selected?: string }) {
  const { game } = useStore();
  const names = useGameValue(() => visibleUnits(tab).map((u) => u.name).join(","));
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
              unit={game.unit(n)}
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
