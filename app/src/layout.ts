// Phone or laptop layout. Below WIDE_MIN the app is the phone column; from
// WIDE_MIN up it is two columns with a top tab strip (styles/wide.css uses the
// same width). CSS does the sizing; this hook is only for the few places where
// the structure differs (where the tab bar sits, the split, the More panel).
import { useSyncExternalStore } from "react";

export const WIDE_MIN = 1000;
export const WIDE_QUERY = `(min-width: ${WIDE_MIN}px)`;

function media(): MediaQueryList | undefined {
  return typeof window !== "undefined" ? window.matchMedia?.(WIDE_QUERY) : undefined;
}

function subscribe(fn: () => void): () => void {
  const m = media();
  m?.addEventListener?.("change", fn);
  return () => m?.removeEventListener?.("change", fn);
}

const getWide = () => !!media()?.matches;

/** true on laptop-sized viewports (two-column layout) */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, getWide, () => false);
}
