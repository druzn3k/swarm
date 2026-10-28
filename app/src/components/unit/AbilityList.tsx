import type { Unit } from "@swarmsim/engine";
import { visibleUpgrades } from "../../game/selectors";
import { AbilityItem } from "../progression/AbilityItem";

/** A unit's abilities (energy spells); each can be hidden and shown again. */
export function AbilityList({ unit }: { unit: Unit }) {
  const abilities = visibleUpgrades(unit, "ability");
  if (!abilities.length) return null;
  return (
    <section className="section card" aria-labelledby="abilities-title" data-slot="abilities">
      <h2 id="abilities-title">Abilities</h2>
      <ul className="upgrade-list">
        {abilities.map((u) => (
          <AbilityItem key={u.name} upgrade={u} />
        ))}
      </ul>
    </section>
  );
}
