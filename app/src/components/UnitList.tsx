import type { Tab, Unit } from "@swarmsim/engine";
import { useGame } from "../game/GameContext";
import { useFormat } from "../format";
import type { Formatter } from "../format";
import { unitLabel, visibleUnits } from "../game/selectors";
import { unitHref } from "../router";
import { SpriteIcon } from "./Icon";

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

function UnitCard({ unit, tab }: { unit: Unit; tab: Tab }) {
  const fmt = useFormat();
  const cap = unit.capValue();
  const upgradable = unit.isNewlyUpgradable();
  const name = unitLabel(unit, true);
  return (
    <li className="card">
      <a className="unit-card" href={unitHref(unit.name)} data-unit={unit.name}>
        <SpriteIcon name={unit.name} tab={unit.unittype.tab} />
        <span className="unit-names">
          <span className="unit-name">{name}</span>
          <span className="unit-rate num">{rateText(unit, tab, fmt)}</span>
        </span>
        <span className="unit-count num">
          {fmt.num(unit.count())}
          {cap && <small>{fmt.percent(unit.capPercent(), { floor: true })} full</small>}
        </span>
        <span className="chevron" aria-hidden="true" />
        {upgradable && (
          <span className="upgrade-dot" role="img" aria-label="New upgrade available" title="New upgrade available" />
        )}
      </a>
    </li>
  );
}

/** The visible units of a tab, as cards that open the unit screen. Re-renders every tick. */
export function UnitList({ tab }: { tab: Tab }) {
  useGame();
  return (
    <ul className="unit-list">
      {visibleUnits(tab).map((u) => (
        <UnitCard key={u.name} unit={u} tab={tab} />
      ))}
    </ul>
  );
}
