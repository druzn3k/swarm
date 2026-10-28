import type { Tab, Unit } from "@swarmsim/engine";
import { memo } from "react";
import { useGameValue, useStore } from "../game/GameContext";
import { useFormat } from "../format";
import type { Formatter } from "../format";
import { unitLabel, visibleUnits } from "../game/selectors";
import { unitHref } from "../router";
import { SpriteIcon } from "./Icon";
import { QuickBuy } from "./unit/QuickBuy";
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

/** One unit's card. Re-renders only when its text changes. */
const UnitCard = memo(function UnitCard({ unit, tab, quickBuy }: { unit: Unit; tab: Tab; quickBuy: boolean }) {
  const fmt = useFormat();
  const snapshot = useGameValue(() => {
    const cap = unit.capValue() ? `${fmt.percent(unit.capPercent(), { floor: true })} full` : "";
    return [fmt.num(unit.count()), rateText(unit, tab, fmt), cap, unit.isNewlyUpgradable() ? "1" : ""].join(SEP);
  });
  const [count, rate, cap, upgradable] = snapshot.split(SEP);
  const name = unitLabel(unit, true);
  return (
    <li className="card">
      <a className="unit-card" href={unitHref(unit.name)} data-unit={unit.name}>
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
        {upgradable && (
          <span className="upgrade-dot" role="img" aria-label="New upgrade available" title="New upgrade available" />
        )}
      </a>
      {/* the old table's buy dropdown, with advanced unit data on */}
      {quickBuy && <QuickBuy unit={unit} />}
    </li>
  );
});

/** The visible units of a tab, as cards that open the unit screen. Re-renders when the list changes; cards update themselves. */
export function UnitList({ tab }: { tab: Tab }) {
  const { game } = useStore();
  const names = useGameValue(() => visibleUnits(tab).map((u) => u.name).join(","));
  const [{ showAdvancedUnitData }] = useOptions();
  return (
    <ul className="unit-list">
      {names
        .split(",")
        .filter(Boolean)
        .map((n) => (
          <UnitCard key={n} unit={game.unit(n)} tab={tab} quickBuy={showAdvancedUnitData} />
        ))}
    </ul>
  );
}
