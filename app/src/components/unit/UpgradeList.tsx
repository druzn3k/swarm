import type { Unit } from "@swarmsim/engine";
import { visibleUpgrades } from "../../game/selectors";
import { UpgradeItem } from "./UpgradeItem";

// PHASE B (B1): per-upgrade notify setting (hide / never / when buyable / 2x / 4x)
export function UpgradeList({ unit }: { unit: Unit }) {
  const upgrades = visibleUpgrades(unit, "upgrade");
  if (!upgrades.length) return null;
  return (
    <section className="section card" aria-labelledby="upgrades-title">
      <h2 id="upgrades-title">Upgrades</h2>
      <ul className="upgrade-list">
        {upgrades.map((u) => (
          <UpgradeItem key={u.name} upgrade={u} />
        ))}
      </ul>
    </section>
  );
}
