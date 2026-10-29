// A horizontal swipe on a unit screen steps to the neighbouring unit, the
// same way as the on-screen arrows: swiping left (the page moves left, like
// turning a page) goes to "next" on the right, swiping right to "previous".
// Pointer events, so it works with touch and with a mouse drag (one that
// doesn't start on text: that one selects text, as usual). The surface
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

/** Is the point over a character of text? (A mouse drag from there selects text; it isn't a swipe.) */
function onText(x: number, y: number): boolean {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | undefined;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    node = p?.offsetNode;
    offset = p?.offset ?? 0;
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    node = r?.startContainer;
    offset = r?.startOffset ?? 0;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const len = (node as Text).length;
  const range = document.createRange();
  for (const at of [offset - 1, offset]) {
    if (at < 0 || at + 1 > len) continue;
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    const r = range.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

/** `onSwipe` returns whether it went somewhere (there may be no unit that way). */
export function useSwipe(ref: RefObject<HTMLElement>, onSwipe: (dir: StepDir) => boolean, active = true): void {
  // the screen re-renders on ticks; keep one set of listeners for the gesture
  const handler = useRef(onSwipe);
  handler.current = onSwipe;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let start: { id: number; x: number; y: number; mouse: boolean } | null = null;
    let dragging = false;
    const stopDragging = () => {
      dragging = false;
      el.classList.remove("swiping");
    };

    const down = (e: PointerEvent) => {
      start = null;
      if (!e.isPrimary || ignored(e.target, el)) return;
      const mouse = e.pointerType === "mouse";
      // a mouse press on text starts a selection, not a swipe
      if (mouse && (e.button !== 0 || onText(e.clientX, e.clientY))) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, mouse };
    };
    const move = (e: PointerEvent) => {
      if (!start || dragging || !start.mouse || e.pointerId !== start.id) return;
      const dx = Math.abs(e.clientX - start.x);
      if (dx > 10 && dx > SWIPE_RATIO * Math.abs(e.clientY - start.y)) {
        // a sideways mouse drag: don't select the text it passes over
        dragging = true;
        el.classList.add("swiping");
        window.getSelection?.()?.removeAllRanges();
      }
    };
    const up = (e: PointerEvent) => {
      const s = start;
      start = null;
      stopDragging();
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return;
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
      stopDragging();
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [ref, active]);
}
