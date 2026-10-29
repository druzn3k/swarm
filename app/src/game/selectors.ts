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

/**
 * Visible units of a tab in the old game's order (`cur.tab.sortUnits()` in
 * views/main.html and unit.html): the most advanced unit at the top, the
 * cheapest at the bottom (meat last on the meat tab). "All units" keeps the
 * spreadsheet order, cheapest first, like the old game.
 */
export function visibleUnits(tab: Tab): Unit[] {
  return (tab.sortUnits() as Unit[]).filter((u) => u.isVisible());
}

/** Visible units of a tab, cheapest first (the reverse of the list, except on "all units"). */
export function cheapestFirst(tab: Tab): Unit[] {
  const list = visibleUnits(tab);
  return tab.name === "all" ? list : list.reverse();
}

/**
 * The units next to `unit` in its list, as the list shows them: `above` is
 * the card above it (prev/next controls: previous, on the left), `below` the
 * card under it (next, on the right).
 */
export function unitNeighbours(tab: Tab, unit: Unit): { above?: Unit; below?: Unit } {
  const list = visibleUnits(tab);
  const i = list.indexOf(unit);
  if (i < 0) return {};
  return { above: list[i - 1], below: list[i + 1] };
}

export function visibleUpgrades(unit: Unit, klass: "upgrade" | "ability" = "upgrade"): Upgrade[] {
  return (unit.upgrades.byClass[klass] ?? []).filter((u) => u.isVisible());
}

/**
 * The unit the laptop layout shows next to a tab's list when the route names
 * none: the one last opened on the tab (the old game's tab.lastselected), else
 * the tab's lead unit if its screen has something to buy or cast, else the
 * cheapest unit that does (the list's bottom-most).
 */
export function defaultUnit(game: Game, tabName: string): string {
  const tab = tabByName(game, tabName);
  if (!tab) return "";
  const last = tab.lastselected;
  if (last && last.isVisible() && tab.indexByUnitName[last.name] !== undefined) return last.name;
  // otherwise the cheapest unit with something to do on its screen (meat has
  // nothing to buy, so a new game opens on drones, territory on swarmlings)
  const units = cheapestFirst(tab);
  const lead = tab.leadunit as Unit;
  const candidates = lead.isVisible() ? [lead, ...units.filter((u) => u !== lead)] : units;
  return (candidates.find(hasActions) ?? candidates[0])?.name ?? "";
}

/** Does the unit's screen offer anything to buy or cast? */
function hasActions(unit: Unit): boolean {
  return isUnitBuyable(unit) || visibleUpgrades(unit).length > 0 || visibleUpgrades(unit, "ability").length > 0;
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
