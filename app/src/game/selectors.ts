// Small read-only helpers over the view that several screens share. Game
// rules stay in the engine; these only pick and order things for display.
import { Dec } from "@swarmsim/engine-wasm";
import type { NumString } from "@swarmsim/engine-wasm";
import type { GameView, TabRef, UnitRef } from "./view";

/** the bottom-bar tabs, in order */
export const TAB_ORDER = ["meat", "larva", "territory", "energy", "mutagen"] as const;

/** a tab by name, including the engine's hidden "all" tab */
export function tabByName(g: GameView, name: string): TabRef | undefined {
  return g.tab(name);
}

/** a unit by name ("greaterqueen") or by the old game's url slug ("greater queen") */
export function findUnit(g: GameView, key: string): UnitRef | undefined {
  return g.findUnit(key);
}

/**
 * Visible units of a tab in the old game's order (`cur.tab.sortUnits()` in
 * views/main.html and unit.html): the most advanced unit at the top, the
 * cheapest at the bottom (meat last on the meat tab). "All units" keeps the
 * spreadsheet order, cheapest first, like the old game.
 */
export function visibleUnits(tab: TabRef): UnitRef[] {
  return tab.units;
}

/** Visible units of a tab, cheapest first (the reverse of the list, except on "all units"). */
export function cheapestFirst(tab: TabRef): UnitRef[] {
  const list = visibleUnits(tab);
  return tab.name === "all" ? list : list.slice().reverse();
}

/**
 * The units next to `unit` in its list, as the list shows them: `above` is
 * the card above it (prev/next controls: previous, on the left), `below` the
 * card under it (next, on the right).
 */
export function unitNeighbours(tab: TabRef, unit: UnitRef): { above?: UnitRef; below?: UnitRef } {
  const list = visibleUnits(tab);
  const i = list.findIndex((u) => u.id === unit.id);
  if (i < 0) return {};
  return { above: list[i - 1], below: list[i + 1] };
}

/**
 * The unit the laptop layout shows next to a tab's list when the route names
 * none: the one last opened on the tab (the old game's tab.lastselected), else
 * the tab's lead unit if its screen has something to buy or cast, else the
 * cheapest unit that does (the list's bottom-most).
 */
export function defaultUnit(g: GameView, tabName: string, lastSelected?: string): string {
  const tab = tabByName(g, tabName);
  if (!tab) return "";
  const last = lastSelected ? g.findUnit(lastSelected) : undefined;
  if (last && last.visible && tab.has(last.name)) return last.name;
  // otherwise the cheapest unit with something to do on its screen (meat has
  // nothing to buy, so a new game opens on drones, territory on swarmlings)
  const units = cheapestFirst(tab);
  const lead = tab.lead;
  const candidates = lead.visible ? [lead, ...units.filter((u) => u.id !== lead.id)] : units;
  return (candidates.find(hasActions) ?? candidates[0])?.name ?? "";
}

/** Does the unit's screen offer anything to buy or cast? */
function hasActions(unit: UnitRef): boolean {
  return isUnitBuyable(unit) || unit.upgrades("upgrade").length > 0 || unit.upgrades("ability").length > 0;
}

export function tabTitle(tab: TabRef): string {
  return tab.title;
}

/** "label" for exactly one, "plural" otherwise */
export function unitNoun(unit: UnitRef, n: NumString | number | Dec): string {
  return Dec.from(n).eq(1) ? unit.label : unit.plural;
}

/** A unit's name with its suffix (e.g. "drone", or a ranked unit's "overmind II") */
export function unitLabel(unit: UnitRef, plural = false): string {
  const base = plural ? unit.plural : unit.label;
  return unit.suffix ? `${base} ${unit.suffix}` : base;
}

/** Can the player buy this unit from its screen? (directive-unit.html) */
export function isUnitBuyable(unit: UnitRef): boolean {
  const t = unit.st;
  return !t.unbuyable && !t.is_buy_hidden && unit.hasCost && unit.buyButtonVisible;
}

/** "a, b and c" */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}
