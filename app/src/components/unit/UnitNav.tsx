import type { Tab, Unit } from "@swarmsim/engine";
import { useFormat } from "../../format";
import { tabHref, unitHref } from "../../router";
import { unitLabel, unitNeighbours } from "../../game/selectors";
import { SpriteIcon } from "../Icon";

function Step({ unit, dir }: { unit?: Unit; dir: "prev" | "next" }) {
  const fmt = useFormat();
  if (!unit) return <span className="icon-btn step" aria-disabled="true" />;
  const name = unitLabel(unit, true);
  return (
    <a className="icon-btn step" href={unitHref(unit.name)} rel={dir} data-step={dir} aria-label={`${dir === "prev" ? "Previous" : "Next"}: ${name}`}>
      {dir === "prev" && <span aria-hidden="true">‹</span>}
      <SpriteIcon name={unit.name} tab={unit.unittype.tab} size={24} />
      <span className="step-text">
        <span className="step-name">{name}</span>
        <span className="num step-count">{fmt.num(unit.count())}</span>
      </span>
      {dir === "next" && <span aria-hidden="true">›</span>}
    </a>
  );
}

/**
 * Back to the tab, and the units next to this one in the list: previous (‹,
 * on the left) is the card above, the more advanced unit; next (›, on the
 * right) is the card below, the cheaper one. `list` is the list shown with the
 * unit (laptop layout: "all units" when it was picked there), else its tab.
 */
export function UnitNav({ unit, list }: { unit: Unit; list?: Tab }) {
  const tab = unit.tab!;
  const { above, below } = unitNeighbours(list && list.indexByUnitName[unit.name] !== undefined ? list : tab, unit);
  return (
    <nav className="unit-nav" aria-label="Units">
      <a className="icon-btn back" href={tabHref(tab.name)} aria-label={`Back to ${tab.leadunit.unittype.plural}`}>
        ←
      </a>
      <Step unit={above} dir="prev" />
      <Step unit={below} dir="next" />
    </nav>
  );
}
