import type { Unit } from "@swarmsim/engine";
import { useFormat } from "../../format";
import { tabHref, unitHref } from "../../router";
import { unitLabel } from "../../game/selectors";
import { SpriteIcon } from "../Icon";
import { stepToUnit } from "./stepUnit";

function Step({ unit, dir }: { unit?: Unit; dir: "prev" | "next" }) {
  const fmt = useFormat();
  if (!unit) return <span className="icon-btn step" aria-disabled="true" />;
  const name = unitLabel(unit, true);
  return (
    <a
      className="icon-btn step"
      href={unitHref(unit.name)}
      rel={dir}
      data-step={dir}
      aria-label={`${dir === "prev" ? "Previous" : "Next"}: ${name}`}
      onClick={(e) => {
        // a plain click replaces the history entry (stepUnit.ts); new tabs and windows work as links
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        stepToUnit(unit.name, dir);
      }}
    >
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
 * right) is the card below, the cheaper one (UnitScreen works them out).
 * Stepping replaces the history entry, so Back goes to the list.
 */
export function UnitNav({ unit, above, below }: { unit: Unit; above?: Unit; below?: Unit }) {
  const tab = unit.tab!;
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
