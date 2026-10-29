// Keeps the player's place in a tab's unit list (phone layout): when a unit
// screen is opened from a tab, the list's scroll position is remembered, and
// coming back to that tab from the unit (the in-app back arrow, the browser or
// Android back gesture, or the tab bar) puts the list back where it was. Kept
// per tab, in memory and in sessionStorage (so a reload on a unit screen
// still comes back to the right place).
//
// The position is read in a hashchange listener added before React's, while
// the old screen is still on the page. On the laptop layout the list has its
// own scroll container that stays mounted, so nothing needs restoring there.
import { parseHash } from "./router";
import type { Route } from "./router";

const KEY = "swarmhive-list-scroll";

interface Memory {
  /** scroll position of each tab's list when it was last left */
  pos: Record<string, number>;
  /** the tab whose list a unit screen was opened from */
  from?: string;
}

function load(): Memory {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object" && v.pos && typeof v.pos === "object") return v as Memory;
  } catch {
    /* no storage: memory only */
  }
  return { pos: {} };
}

function save(m: Memory): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* remembered for this page only */
  }
}

let memory: Memory = { pos: {} };
let hash = "";
/** the route that was left by the latest navigation */
let left: Route | undefined;

function onHashChange(): void {
  const prev = parseHash(hash);
  const next = parseHash(window.location.hash);
  hash = window.location.hash;
  left = prev;
  if (prev.name === "tab") {
    memory.pos[prev.tab] = Math.round(window.scrollY);
    memory.from = next.name === "unit" ? prev.tab : undefined;
  } else if (prev.name !== "unit") {
    memory.from = undefined;
  }
  save(memory);
}

/** Start remembering (call once, before the app renders). */
export function watchListScroll(win: Window = window): void {
  memory = load();
  hash = win.location.hash;
  // the app puts the page where it belongs; don't let the browser fight it on Back
  try {
    if ("scrollRestoration" in win.history) win.history.scrollRestoration = "manual";
  } catch {
    /* fine */
  }
  win.addEventListener("hashchange", onHashChange);
}

/**
 * Where the page should be scrolled to for a newly shown route: the list's
 * remembered position when coming back from a unit to the tab it was opened
 * from, else undefined (the top).
 */
export function restoredScroll(route: Route): number | undefined {
  if (route.name !== "tab" || left?.name !== "unit" || memory.from !== route.tab) return undefined;
  return memory.pos[route.tab];
}
