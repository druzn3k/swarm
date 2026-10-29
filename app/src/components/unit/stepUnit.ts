// Moving to the previous/next unit (the arrows on a unit screen, or a swipe).
// Both replace the current history entry instead of adding one, so however
// many units the player steps through, Back returns to the list they came
// from (where they left it: scrollMemory.ts). The new screen slides in from
// the side the player moved towards.
import { unitHref } from "../../router";

export type StepDir = "prev" | "next";

let pending: { unit: string; dir: StepDir } | undefined;

export function stepToUnit(unit: string, dir: StepDir): void {
  pending = { unit, dir };
  window.location.replace(unitHref(unit));
}

/** The direction the screen for `unit` was stepped to from, if it was. */
export function slideFor(unit: string): StepDir | undefined {
  return pending?.unit === unit ? pending.dir : undefined;
}

export function clearSlide(): void {
  pending = undefined;
}
