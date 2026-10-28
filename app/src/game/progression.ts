// Small rules the old UI layer kept (directives/tabs.coffee, unit.coffee):
// undo's time limit, the More menu's upgrade lists, and what an ability cast
// changed. Game rules stay in the engine.
import type { Commands, Decimal, Game, Unit, Upgrade } from "@swarmsim/engine";

// --- undo (directives/tabs.coffee) --------------------------------------------

export const UNDO_LIMIT_SECONDS = 30;

export function secondsSinceLastAction(game: Game, commands: Commands): number {
  return (game.now.getTime() - (commands._undo?.date?.getTime?.() ?? 0)) / 1000;
}

/** Undo works for 30 seconds after an action, and not twice in a row (that would redo). */
export function isUndoable(game: Game, commands: Commands): boolean {
  return secondsSinceLastAction(game, commands) < UNDO_LIMIT_SECONDS && !commands._undo?.isRedo;
}

/** Whole seconds left to undo, like the old `number:0` filter; 0 when undo isn't possible. */
export function undoSecondsLeft(game: Game, commands: Commands): number {
  if (!isUndoable(game, commands)) return 0;
  return Math.round(UNDO_LIMIT_SECONDS - secondsSinceLastAction(game, commands));
}

// --- buy all / cheapest upgrades ---------------------------------------------

/** The old "buy cheapest" spends at most 25% of each resource. */
export const CHEAPEST_PERCENT = 0.25;

export function buyAllList(game: Game): Upgrade[] {
  return game.availableAutobuyUpgrades();
}
export function buyCheapestList(game: Game): Upgrade[] {
  return game.availableAutobuyUpgrades(CHEAPEST_PERCENT);
}

// --- upgrade notify setting (views/directive-unit.html) ---------------------

export const NOTIFY_OPTIONS: { value: number; label: string }[] = [
  { value: -1, label: "Hide upgrade" },
  { value: 0, label: "Never notify" },
  { value: 1, label: "Notify when buyable" },
  { value: 2, label: "Notify at 2× cost" },
  { value: 4, label: "Notify at 4× cost" },
];

// --- ability casts ------------------------------------------------------------

export interface Gain {
  unit: Unit;
  val: Decimal;
}

export interface CastPreview {
  /** units whose counts the cast can raise */
  units: string[];
  /** seconds skipped by a swarmwarp-like ability */
  skipSecs: number;
}

/** What an ability affects, read before casting. */
export function previewCast(upgrade: Upgrade): CastPreview {
  const names = new Set<string>();
  let skipSecs = 0;
  const cost = new Set(upgrade.cost.map((c) => c.unit.name));
  for (const effect of upgrade.effect) {
    if (effect.type.name === "skipTime") {
      try {
        skipSecs += Number(effect.output().toNumber());
      } catch {
        /* unknown */
      }
      // time travel: everything produces; show the tab leaders
      for (const tab of upgrade.game.tabs.list) names.add(tab.leadunit.name);
    } else if (effect.unit) {
      names.add(effect.unit.name);
    }
  }
  // a cast never "gains" what it spends
  for (const n of cost) names.delete(n);
  return { units: [...names], skipSecs };
}

export function snapshotCounts(game: Game, names: string[]): Record<string, Decimal> {
  const out: Record<string, Decimal> = {};
  for (const n of names) out[n] = game.unit(n).count();
  return out;
}

/** Positive changes since a snapshot, in snapshot order. */
export function gainsSince(game: Game, before: Record<string, Decimal>): Gain[] {
  const gains: Gain[] = [];
  for (const name of Object.keys(before)) {
    const unit = game.unit(name);
    const diff = unit.count().minus(before[name]);
    if (diff.greaterThan(0)) gains.push({ unit, val: diff });
  }
  return gains;
}
