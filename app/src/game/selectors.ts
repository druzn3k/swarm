// Small read-only helpers over the engine that several screens share. Game
// rules stay in the engine; these only pick and order things for display.
import type { Decimal, Game, Tab, Unit, Upgrade } from "@swarmsim/engine";

/** the bottom-bar tabs, in order */
export const TAB_ORDER = ["meat", "larva", "territory", "energy", "mutagen"] as const;

const own = <T>(dict: { [key: string]: T }, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined;

/** a tab by name, including the engine's hidden "all" tab */
export function tabByName(game: Game, name: string): Tab | undefined {
  return own(game.tabs.byName, name);
}

/** a unit by name ("greaterqueen") or by the old game's url slug ("greater queen") */
export function findUnit(game: Game, key: string): Unit | undefined {
  return own(game._units.byName, key) ?? own(game._units.bySlug, key);
}

/** Visible units of a tab, lowest tier first (the mock-up's order). */
export function visibleUnits(tab: Tab): Unit[] {
  const sorted = tab.sortUnits() as Unit[];
  const list = sorted.filter((u) => u.isVisible());
  return tab.name === "all" ? list : list.reverse();
}

export function visibleUpgrades(unit: Unit, klass: "upgrade" | "ability" = "upgrade"): Upgrade[] {
  return (unit.upgrades.byClass[klass] ?? []).filter((u) => u.isVisible());
}

export function tabTitle(tab: Tab): string {
  return tab.name === "all" ? "All units" : (tab.leadunit.unittype.plural as string);
}

/** "label" for exactly one, "plural" otherwise */
export function unitNoun(unit: Unit, n: Decimal | number): string {
  const one = typeof n === "number" ? n === 1 : n.equals(1);
  return (one ? unit.unittype.label : unit.unittype.plural) as string;
}

/** A unit's name with its suffix (e.g. "drone", or a ranked unit's "overmind II") */
export function unitLabel(unit: Unit, plural = false): string {
  const base = (plural ? unit.unittype.plural : unit.unittype.label) as string;
  return unit.suffix ? `${base} ${unit.suffix}` : base;
}

/** Can the player buy this unit from its screen? (directive-unit.html) */
export function isUnitBuyable(unit: Unit): boolean {
  const t = unit.unittype;
  return !t.unbuyable && !t.isBuyHidden && unit.cost.length > 0 && unit.isBuyButtonVisible();
}

/** "a, b and c" */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}
