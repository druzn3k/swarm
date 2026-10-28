import type { Unit } from "@swarmsim/engine";
import { visibleUpgrades } from "../../game/selectors";
import { UpgradeItem } from "./UpgradeItem";

// PHASE B (B1): this is a minimal stand-in. Abilities still need their
// show/hide toggle, cast feedback and art.
export function AbilityList({ unit }: { unit: Unit }) {
  const abilities = visibleUpgrades(unit, "ability");
  if (!abilities.length) return null;
  return (
    <section className="section card" aria-labelledby="abilities-title" data-slot="abilities">
      <h2 id="abilities-title">Abilities</h2>
      <ul className="upgrade-list">
        {abilities.map((u) => (
          <UpgradeItem key={u.name} upgrade={u} ability />
        ))}
      </ul>
    </section>
  );
}
