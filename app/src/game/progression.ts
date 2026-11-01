// Small rules the old UI layer kept (directives/tabs.coffee, unit.coffee):
// the More menu's upgrade lists, the notify settings, and what an ability
// cast changed. Game rules (undo's window, what buy-all buys) are the
// engine's: they come with the view.
import { Dec } from "@swarmsim/engine-wasm";
import type { NumString } from "@swarmsim/engine-wasm";
import type { GameView, UnitRef, UpgradeRef } from "./view";

// --- undo (directives/tabs.coffee) --------------------------------------------

/** Whole seconds left to undo, like the old `number:0` filter; 0 when undo isn't possible. */
export function undoSecondsLeft(g: GameView): number {
  const u = g.v.undo;
  return u?.undoable ? u.secs_left : 0;
}

// --- buy all / cheapest upgrades ---------------------------------------------

/** The old "buy cheapest" spends at most 25% of each resource. */
export const CHEAPEST_PERCENT = 0.25;

export function buyAllList(g: GameView): UpgradeRef[] {
  return (g.v.buy_all ?? []).map((i) => g.upgrade(i));
}
export function buyCheapestList(g: GameView): UpgradeRef[] {
  return (g.v.buy_cheapest ?? []).map((i) => g.upgrade(i));
}

// --- upgrade notify setting (views/directive-unit.html) ---------------------

export const NOTIFY_OPTIONS: { value: number; label: string }[] = [
  { value: -1, label: "Hide upgrade" },
  { value: 0, label: "Never notify" },
  { value: 1, label: "Notify when buyable" },
  { value: 2, label: "Notify at 2× cost" },
  { value: 4, label: "Notify at 4× cost" },
];

/** An upgrade's default notify level (the engine stores the default as absent): off on the mutagen tab, else "when buyable". */
export function defaultWatch(upgrade: UpgradeRef): number {
  return upgrade.unit.tabName === "mutagen" ? 0 : 1;
}

// --- ability casts ------------------------------------------------------------

export interface Gain {
  unit: UnitRef;
  val: NumString;
}

export interface CastPreview {
  /** units whose counts the cast can raise */
  units: string[];
  /** seconds skipped by a swarmwarp-like ability (focused units only) */
  skipSecs: number;
}

/** What an ability affects, read before casting. */
export function previewCast(upgrade: UpgradeRef): CastPreview {
  const g = upgrade.g;
  const names = new Set<string>();
  let skipSecs = 0;
  const cost = new Set((upgrade.st.cost ?? []).map(([u]) => g.s.units[u].name));
  for (const effect of upgrade.effects) {
    if (effect.st.kind === "skipTime") {
      skipSecs += Number(effect.v?.output ?? 0) || 0;
      // time travel: everything produces; show the tab leaders
      for (const tab of g.s.tabs) names.add(g.s.units[tab.lead].name);
    } else if (effect.unit) {
      names.add(effect.unit.name);
    }
  }
  // a cast never "gains" what it spends
  for (const n of cost) names.delete(n);
  return { units: [...names], skipSecs };
}

export function snapshotCounts(g: GameView, names: string[]): Record<string, NumString> {
  const out: Record<string, NumString> = {};
  for (const n of names) out[n] = g.unit(n).count;
  return out;
}

/** Positive changes since a snapshot, in snapshot order. */
export function gainsSince(g: GameView, before: Record<string, NumString>): Gain[] {
  const gains: Gain[] = [];
  for (const name of Object.keys(before)) {
    const unit = g.unit(name);
    const diff = Dec.from(unit.count).minus(before[name]);
    if (diff.gt(0)) gains.push({ unit, val: diff.toString() });
  }
  return gains;
}
