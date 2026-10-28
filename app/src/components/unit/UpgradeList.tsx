import type { Unit } from "@swarmsim/engine";
import { visibleUpgrades } from "../../game/selectors";
import { UpgradeItem } from "./UpgradeItem";
import { HiddenUpgrade, UpgradeNotify } from "../progression/UpgradeNotify";

/** A unit's upgrades, each with its notify setting; hidden ones collapse. */
export function UpgradeList({ unit }: { unit: Unit }) {
  const upgrades = visibleUpgrades(unit, "upgrade");
  if (!upgrades.length) return null;
  return (
    <section className="section card" aria-labelledby="upgrades-title">
      <h2 id="upgrades-title">Upgrades</h2>
      <ul className="upgrade-list">
        {upgrades.map((u) =>
          u.isManuallyHidden() ? <HiddenUpgrade key={u.name} upgrade={u} /> : <UpgradeItem key={u.name} upgrade={u} footer={<UpgradeNotify upgrade={u} />} />
        )}
      </ul>
    </section>
  );
}
