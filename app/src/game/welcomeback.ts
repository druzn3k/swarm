// "Welcome back": what the swarm produced while the player was away. A port of
// WelcomeBackCtrl (swarmsim-coffee/app/scripts/controllers/loadsave.coffee).
// Compute it right after loading, before the first heartbeat, or the
// time-since-closed is wrong.
import type { Decimal, Game, Session, Unit } from "@swarmsim/engine";

/** Shown only after at least this long away (not on a refresh). */
export const WELCOME_BACK_MINUTES = 3;

export interface OfflineGain {
  unit: Unit;
  val: Decimal;
}

export interface WelcomeBack {
  /** how long the game was closed */
  millis: number;
  gains: OfflineGain[];
}

export interface WelcomeBackOptions {
  /** show it even after a short absence (the old `?forcewelcome`) */
  force?: boolean;
  /** use only the save's dates, not the heartbeat (after an import) */
  ignoreHeartbeat?: boolean;
}

/** The units worth listing: the meat tab's three highest producing generations, then every tab's lead unit. */
export function interestingUnits(game: Game): Unit[] {
  const list: Unit[] = [];
  let leaders = 0;
  for (const unit of game.tabs.byName.meat.sortedUnits as Unit[]) {
    if (leaders >= 3) break;
    if (!unit.velocity().isZero()) {
      leaders += 1;
      list.push(unit);
    }
  }
  for (const tab of game.tabs.list) list.push(tab.leadunit as Unit);
  const seen = new Set<string>();
  return list.filter((u) => (seen.has(u.name) ? false : (seen.add(u.name), true)));
}

/** null when the player wasn't away long enough. */
export function computeWelcomeBack(game: Game, session: Session, opts: WelcomeBackOptions = {}): WelcomeBack | null {
  const ignoreHeartbeat = !!opts.ignoreHeartbeat;
  const millis = session.millisSinceClosed(undefined, ignoreHeartbeat);
  if (!(millis / 60000 >= WELCOME_BACK_MINUTES || opts.force)) return null;
  const reifiedToClose = (session.dateClosed(ignoreHeartbeat).getTime() - session.state.date.reified.getTime()) / 1000;
  const gains: OfflineGain[] = [];
  for (const unit of interestingUnits(game)) {
    const diff = unit.count().minus(unit._countInSecsFromReified(reifiedToClose));
    if (diff.greaterThan(0)) gains.push({ unit, val: diff });
  }
  return { millis: Math.max(0, millis), gains };
}
