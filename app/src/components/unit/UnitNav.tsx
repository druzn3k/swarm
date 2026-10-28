import type { Unit } from "@swarmsim/engine";
import { useFormat } from "../../format";
import { tabHref, unitHref } from "../../router";
import { unitLabel } from "../../game/selectors";
import { SpriteIcon } from "../Icon";

function Step({ unit, dir }: { unit?: Unit; dir: "prev" | "next" }) {
  const fmt = useFormat();
  if (!unit || !unit.isVisible()) return <span className="icon-btn step" aria-disabled="true" />;
  const name = unitLabel(unit, true);
  return (
    <a className="icon-btn step" href={unitHref(unit.name)} rel={dir} aria-label={`${dir === "prev" ? "Previous" : "Next"}: ${name}`}>
      {dir === "prev" && <span aria-hidden="true">‹</span>}
      <SpriteIcon name={unit.name} tab={unit.unittype.tab} size={24} />
      <span className="num">
        {fmt.num(unit.count())} {name}
      </span>
      {dir === "next" && <span aria-hidden="true">›</span>}
    </a>
  );
}

/** Back to the tab, and the previous/next unit in it. */
export function UnitNav({ unit }: { unit: Unit }) {
  const tab = unit.tab!;
  return (
    <nav className="unit-nav" aria-label="Units">
      <a className="icon-btn back" href={tabHref(tab.name)} aria-label={`Back to ${tab.leadunit.unittype.plural}`}>
        ←
      </a>
      <Step unit={unit.prev} dir="prev" />
      <Step unit={unit.next} dir="next" />
    </nav>
  );
}
