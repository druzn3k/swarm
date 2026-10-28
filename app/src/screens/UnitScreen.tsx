import { useEffect } from "react";
import { useGame } from "../game/GameContext";
import { useFormat } from "../format";
import { findUnit, isUnitBuyable, unitLabel } from "../game/selectors";
import { parseQuery, tabHref, useHash } from "../router";
import { unitDescription } from "../content/descriptions";
import { SpriteIcon } from "../components/Icon";
import { UnitNav } from "../components/unit/UnitNav";
import { CapInfo, OwnedLine, ProductionLines } from "../components/unit/UnitInfo";
import { BuyUnit } from "../components/unit/BuyUnit";
import { UpgradeList } from "../components/unit/UpgradeList";
import { AbilityList } from "../components/unit/AbilityList";
import { AscensionPanel } from "../components/progression/AscensionPanel";

export function UnitScreen({ unit: key }: { unit: string }) {
  const { game } = useGame();
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
  const desc = unitDescription(unit.name, t.description);
  const initial = parseQuery(hash).get("num") ?? "";
  return (
    <>
      <UnitNav unit={unit} />
      <div className="unit-hero card">
        <SpriteIcon name={unit.name} tab={t.tab} size={72} />
        <div>
          <h1>{unitLabel(unit)}</h1>
          <p className="owned num" aria-label={`Owned: ${fmt.long(unit.count())}`}>
            {fmt.long(unit.count())}
          </p>
        </div>
      </div>
      <section className="section card" aria-label="About this unit">
        {desc && <p className="desc">{desc}</p>}
        {t.lol && <p className="lol">{t.lol}</p>}
        <OwnedLine unit={unit} />
        <ProductionLines unit={unit} />
      </section>
      <CapInfo unit={unit} />
      {unit.name === "mutagen" && <AscensionPanel />}
      {isUnitBuyable(unit) && <BuyUnit key={unit.name + "?" + initial} unit={unit} initial={initial} />}
      <UpgradeList unit={unit} />
      <AbilityList unit={unit} />
    </>
  );
}
