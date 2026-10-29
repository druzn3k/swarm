import { useEffect } from "react";
import { useGameValueEvery, useStore } from "../game/GameContext";
import { useWide } from "../layout";
import { useFormat } from "../format";
import { findUnit, isUnitBuyable, tabByName, unitLabel } from "../game/selectors";
import { parseQuery, tabHref, useHash } from "../router";
import { UnitDescription } from "../content/LiveDescription";
import { SpriteIcon } from "../components/Icon";
import { UnitNav } from "../components/unit/UnitNav";
import { CapInfo, OwnedLine, ProductionLines } from "../components/unit/UnitInfo";
import { BuyUnit } from "../components/unit/BuyUnit";
import { UpgradeList } from "../components/unit/UpgradeList";
import { AbilityList } from "../components/unit/AbilityList";
import { TerritoryChart } from "../components/unit/TerritoryChart";
import { AscensionPanel } from "../components/progression/AscensionPanel";

/** A unit's screen. `listTab` is the list shown beside it (laptop layout), for prev/next. */
export function UnitScreen({ unit: key, listTab }: { unit: string; listTab?: string }) {
  const store = useStore();
  const { game } = store;
  // re-render on every tick; next to the list (laptop layout) on every other
  // tick, the ones the list's cards skip half of, so the two columns together
  // stay within the tick budget. Player actions show at once.
  useGameValueEvery((s) => s.getVersion(), useWide() ? 2 : 1, 1);
  const fmt = useFormat();
  const hash = useHash();
  const unit = findUnit(game, key);
  const valid = !!unit && !!unit.tab && unit.isVisible();
  // like the old game: unknown or not-yet-visible units go back to their tab
  useEffect(() => {
    if (!valid) window.location.replace(tabHref(unit?.tab?.name ?? "meat"));
  }, [valid, unit]);
  if (!unit || !valid) return null;

  const t = unit.unittype;
  const initial = parseQuery(hash).get("num") ?? "";
  return (
    <>
      <UnitNav unit={unit} list={listTab ? tabByName(game, listTab) : undefined} />
      <div className="unit-hero card">
        <SpriteIcon name={unit.name} tab={t.tab} size={72} />
        <div>
          <h1>{unitLabel(unit)}</h1>
          <p className="owned num">{fmt.long(unit.count())}</p>
        </div>
      </div>
      <section className="section card" aria-label="About this unit">
        <UnitDescription unit={unit} />
        {t.lol && <p className="lol">{t.lol}</p>}
        <OwnedLine unit={unit} />
        <ProductionLines unit={unit} />
      </section>
      <CapInfo unit={unit} />
      {unit.name === "mutagen" && <AscensionPanel />}
      {unit.name === "territory" && <TerritoryChart />}
      {isUnitBuyable(unit) && <BuyUnit key={unit.name + "?" + initial} unit={unit} initial={initial} />}
      {/* the old crystal page converted crystals to energy here */}
      {unit.name === "crystal" && <BuyUnit key={"energy?" + initial} unit={game.unit("energy")} initial={initial} />}
      <UpgradeList unit={unit} />
      <AbilityList unit={unit} />
    </>
  );
}
