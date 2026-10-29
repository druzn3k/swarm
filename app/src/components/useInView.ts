// Is an element on screen (or nearly)? One shared IntersectionObserver for
// all callers. Long lists use it to stop re-reading the game for cards
// nobody can see: a late game's meat tab has a dozen buyable units and a
// phone shows three or four at a time.
import { useEffect, useState } from "react";
import type { RefObject } from "react";

type Listener = (inView: boolean) => void;
const listeners = new WeakMap<Element, Listener>();
let observer: IntersectionObserver | null | undefined;

function shared(): IntersectionObserver | null {
  if (observer !== undefined) return observer;
  observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const e of entries) listeners.get(e.target)?.(e.isIntersecting);
          },
          // a screen's worth of margin: cards are fresh before they scroll in
          { rootMargin: "100% 0px" }
        );
  return observer;
}

/** true while the element is within about a screen of the viewport (always true without IntersectionObserver) */
export function useInView(ref: RefObject<Element>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    const io = shared();
    if (!el || !io) return;
    listeners.set(el, setInView);
    io.observe(el);
    return () => {
      io.unobserve(el);
      listeners.delete(el);
    };
  }, [ref]);
  return inView;
}
