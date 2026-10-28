// Achievement list logic from the old AchievementsCtrl: states, filters
// (stored in the save as `achievementsShown`, like the old game) and order.
import type { Achievement, Game } from "@swarmsim/engine";

export type AchievementState = "earned" | "unearned" | "masked" | "hidden";

export interface AchievementsShown {
  earned: boolean;
  unearned: boolean;
  masked: boolean;
  order: "default" | "percentComplete";
  reverse: boolean;
}

export const DEFAULT_SHOWN: AchievementsShown = { earned: true, unearned: true, masked: true, order: "default", reverse: false };

export function achievementState(a: Achievement): AchievementState {
  if (a.isEarned()) return "earned";
  if (a.isUnmasked()) return "unearned";
  // masked zero-point vanity achievements aren't masked, but entirely hidden
  if (a.type.points <= 0) return "hidden";
  return "masked";
}

export function readShown(game: Game): AchievementsShown {
  const s = (game.session.state as { achievementsShown?: Partial<AchievementsShown> }).achievementsShown ?? {};
  return {
    earned: s.earned ?? true,
    unearned: s.unearned ?? true,
    masked: s.masked ?? true,
    order: s.order === "percentComplete" ? "percentComplete" : "default",
    reverse: !!s.reverse,
  };
}

export function writeShown(game: Game, shown: AchievementsShown): void {
  game.withUnreifiedSave(() => {
    (game.session.state as { achievementsShown?: AchievementsShown }).achievementsShown = { ...shown };
  });
}

function isShown(a: Achievement, shown: AchievementsShown): boolean {
  const state = achievementState(a);
  if (state === "hidden") return false;
  return shown[state];
}

/** The achievements to list, filtered and ordered like the old screen (a stable sort; unknown keys last). */
export function listAchievements(game: Game, shown: AchievementsShown): Achievement[] {
  const pred = shown.order === "percentComplete" ? (a: Achievement) => a.progressOrder() : (a: Achievement) => a.earnedAtMillisElapsed();
  const sign = shown.reverse ? -1 : 1;
  return game
    .achievementsSorted()
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
export function earnedDate(game: Game, a: Achievement): Date | undefined {
  const elapsed = a.earnedAtMillisElapsed();
  return elapsed == null ? undefined : new Date(game.dateStarted().getTime() + elapsed);
}

/** The larva-production bonus from achievement points, if the upgrade is owned. */
export function achievementBonus(game: Game) {
  const up = game.upgrade("achievementbonus");
  return up && up.count().greaterThan(0) ? up.calcStats().prod : undefined;
}
