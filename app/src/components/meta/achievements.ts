// Achievement list logic from the old AchievementsCtrl: states, filters
// (stored in the save, like the old game) and order.
import type { NumString } from "@swarmsim/engine-wasm";
import type { AchievementRef, GameView } from "../../game/view";
import type { GameStore } from "../../game/store";

export type AchievementState = "earned" | "unearned" | "masked" | "hidden";

export interface AchievementsShown {
  earned: boolean;
  unearned: boolean;
  masked: boolean;
  order: "default" | "percentComplete";
  reverse: boolean;
}

export const DEFAULT_SHOWN: AchievementsShown = { earned: true, unearned: true, masked: true, order: "default", reverse: false };

/** The options-bag key the filters are kept under. */
export const SHOWN_KEY = "achievementsShown";

export function achievementState(a: AchievementRef): AchievementState {
  if (a.earned) return "earned";
  if (a.unmasked) return "unearned";
  // masked zero-point vanity achievements aren't masked, but entirely hidden
  if (a.points <= 0) return "hidden";
  return "masked";
}

/**
 * The filters. The old game kept them in the save's top-level
 * `achievementsShown`, which the engine keeps but can't write; this app keeps
 * them in the options bag (set_option), and reads the old key as a fallback.
 */
export function readShown(store: Pick<GameStore, "ui">): AchievementsShown {
  const raw = store.ui.options[SHOWN_KEY] ?? store.ui.unknown[SHOWN_KEY];
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<AchievementsShown>;
  return {
    earned: s.earned ?? true,
    unearned: s.unearned ?? true,
    masked: s.masked ?? true,
    order: s.order === "percentComplete" ? "percentComplete" : "default",
    reverse: !!s.reverse,
  };
}

export function writeShown(store: GameStore, shown: AchievementsShown): void {
  store.setOption(SHOWN_KEY, { ...shown });
}

function isShown(a: AchievementRef, shown: AchievementsShown): boolean {
  const state = achievementState(a);
  if (state === "hidden") return false;
  return shown[state];
}

/** game.achievementsSorted(): by when they were earned, unearned last (a stable sort). */
function sortedByEarned(g: GameView): AchievementRef[] {
  return g
    .achievements()
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const xe = x.a.earnedAt;
      const ye = y.a.earnedAt;
      if (xe === undefined || ye === undefined) return xe === ye ? x.i - y.i : xe === undefined ? 1 : -1;
      return xe - ye || x.i - y.i;
    })
    .map((x) => x.a);
}

/** The achievements to list, filtered and ordered like the old screen (a stable sort; unknown keys last). */
export function listAchievements(g: GameView, shown: AchievementsShown): AchievementRef[] {
  const pred = shown.order === "percentComplete" ? (a: AchievementRef) => a.progressOrder : (a: AchievementRef) => a.earnedAt;
  const sign = shown.reverse ? -1 : 1;
  return sortedByEarned(g)
    .filter((a) => isShown(a, shown))
    .map((a, i) => ({ a, i, k: pred(a) }))
    .sort((x, y) => {
      const xu = x.k == null || Number.isNaN(x.k);
      const yu = y.k == null || Number.isNaN(y.k);
      let c = 0;
      if (xu !== yu) c = xu ? 1 : -1;
      else if (!xu && x.k !== y.k) c = (x.k as number) < (y.k as number) ? -1 : 1;
      return c !== 0 ? c * sign : x.i - y.i;
    })
    .map((x) => x.a);
}

/** When an achievement was earned, as a date. */
export function earnedDate(g: GameView, a: AchievementRef): Date | undefined {
  const elapsed = a.earnedAt;
  return elapsed == null ? undefined : new Date(g.startedMs + elapsed);
}

/**
 * The larva-production bonus from achievement points (a multiplier), if the
 * upgrade is owned. Its effect's stats are a detail of the larva unit: ask
 * for `ACHIEVEMENT_BONUS_NEED`.
 */
export function achievementBonus(g: GameView): NumString | undefined {
  const up = g.upgrade("achievementbonus");
  if (!up.v || up.count === "0") return undefined;
  const prod = g.s.statIndex("prod");
  for (const e of up.effects) {
    const v = e.v?.stats?.find(([s]) => s === prod)?.[1];
    if (v !== undefined) return v;
  }
  return undefined;
}

export const ACHIEVEMENT_BONUS_NEED = { focus: ["larva"], sections: ["achievements"] } as const;
