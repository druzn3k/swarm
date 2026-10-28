// A tiny hash router: the app works from any static host and path.
//   #/tab/<tab>  #/unit/<unit>  #/achievements  #/statistics  #/options  #/about
// Anything else shows the meat tab.
import { useSyncExternalStore } from "react";

export type Route =
  | { name: "tab"; tab: string }
  | { name: "unit"; unit: string }
  | { name: "achievements" }
  | { name: "statistics" }
  | { name: "options" }
  | { name: "about" }
  | { name: "art" };

export const DEFAULT_ROUTE: Route = { name: "tab", tab: "meat" };
const PAGES = ["achievements", "statistics", "options", "about", "art"] as const;

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\?.*$/, "");
  const parts = path.split("/").filter(Boolean).map(safeDecode);
  const [head, arg] = parts;
  if (head === "tab" && arg) {
    // old-game form: #/tab/<tab>/unit/<unit>
    if (parts[2] === "unit" && parts[3]) return { name: "unit", unit: parts[3] };
    return { name: "tab", tab: arg };
  }
  if (head === "unit" && arg) return { name: "unit", unit: arg };
  if ((PAGES as readonly string[]).includes(head) && parts.length === 1) return { name: head as (typeof PAGES)[number] };
  return DEFAULT_ROUTE;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Query parameters after the route, e.g. "#/unit/drone?num=@100" -> {num: "@100"} */
export function parseQuery(hash: string): URLSearchParams {
  const i = hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : "");
}

export function href(route: Route): string {
  switch (route.name) {
    case "tab":
      return `#/tab/${encodeURIComponent(route.tab)}`;
    case "unit":
      return `#/unit/${encodeURIComponent(route.unit)}`;
    default:
      return `#/${route.name}`;
  }
}

export const tabHref = (tab: string) => href({ name: "tab", tab });
export const unitHref = (unit: string) => href({ name: "unit", unit });

export function navigate(to: Route | string): void {
  window.location.hash = typeof to === "string" ? to : href(to);
}

function subscribe(fn: () => void): () => void {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
}
const getHash = () => window.location.hash;

/** The current hash (re-renders on change). */
export function useHash(): string {
  return useSyncExternalStore(subscribe, getHash, () => "");
}

export function useRoute(): Route {
  return parseHash(useHash());
}
