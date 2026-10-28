import type { Unit } from "@swarmsim/engine";
import { visibleUpgrades } from "../../game/selectors";
import { UpgradeItem } from "./UpgradeItem";
import { HiddenUpgrade, UpgradeNotify } from "../progression/UpgradeNotify";
import { useOptions } from "../../game/options";

/**
 * A unit's upgrades; hidden ones collapse. As in the old game, the notify
 * setting shows only with "advanced unit data" on (or to un-hide an upgrade).
 */
export function UpgradeList({ unit }: { unit: Unit }) {
  const upgrades = visibleUpgrades(unit, "upgrade");
  const [{ showAdvancedUnitData }] = useOptions();
  if (!upgrades.length) return null;
  return (
    <section className="section card" aria-labelledby="upgrades-title">
      <h2 id="upgrades-title">Upgrades</h2>
      <ul className="upgrade-list">
        {upgrades.map((u) =>
          u.isManuallyHidden() ? <HiddenUpgrade key={u.name} upgrade={u} /> : <UpgradeItem key={u.name} upgrade={u} footer={showAdvancedUnitData ? <UpgradeNotify upgrade={u} /> : undefined} />
        )}
      </ul>
    </section>
  );
}
