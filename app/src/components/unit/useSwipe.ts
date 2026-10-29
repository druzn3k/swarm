// A horizontal swipe on a unit screen steps to the neighbouring unit, the
// same way as the on-screen arrows: swiping left (the page moves left, like
// turning a page) goes to "next" on the right, swiping right to "previous".
// Pointer events, so it works with touch and with a mouse drag. The surface
// has `touch-action: pan-y`: the browser keeps vertical scrolling (and cancels
// our gesture when it scrolls), horizontal moves come to us. Keyboard users
// have the arrows.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { StepDir } from "./stepUnit";

/** how far a swipe must go, in CSS pixels */
export const SWIPE_MIN = 60;
/** and how much more sideways than up or down */
const SWIPE_RATIO = 1.5;

/** Swipes don't start on controls or on anything that scrolls sideways. */
function ignored(target: EventTarget | null, surface: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== surface; el = el.parentElement) {
    if (el.matches("input, select, textarea, button, summary, [role=slider], [contenteditable], [data-no-swipe]")) return true;
    if (el.scrollWidth > el.clientWidth) {
      const x = getComputedStyle(el).overflowX;
      if (x === "auto" || x === "scroll") return true;
    }
  }
  return false;
}

const hasSelection = () => {
  const sel = window.getSelection?.();
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
};

/** `onSwipe` returns whether it went somewhere (there may be no unit that way). */
export function useSwipe(ref: RefObject<HTMLElement>, onSwipe: (dir: StepDir) => boolean, active = true): void {
  // the screen re-renders on ticks; keep one set of listeners for the gesture
  const handler = useRef(onSwipe);
  handler.current = onSwipe;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let start: { id: number; x: number; y: number; mouse: boolean; selected: boolean } | null = null;

    const down = (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0) || ignored(e.target, el)) {
        start = null;
        return;
      }
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse", selected: hasSelection() };
    };
    const up = (e: PointerEvent) => {
      const s = start;
      start = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return;
      // a mouse drag that selected text was a selection, not a swipe
      if (s.mouse && !s.selected && hasSelection()) return;
      if (!handler.current(dx < 0 ? "next" : "prev")) return;
      // the press that ended the swipe is not a click on what it started on
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    const cancel = () => {
      start = null;
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [ref, active]);
}
