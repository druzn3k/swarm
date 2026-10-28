// The "More" bottom sheet: the buy-all-upgrades and undo actions, and links
// to the meta screens. On the laptop layout it is a panel dropping down from
// the More button in the tab strip (`anchor`).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { href, tabHref } from "../router";
import { promptInstall, useCanInstall } from "../pwa";
import { MoreActions } from "./progression/MoreActions";

const LINKS = [
  { label: "Achievements", to: href({ name: "achievements" }) },
  { label: "Statistics", to: href({ name: "statistics" }) },
  { label: "Options", to: href({ name: "options" }) },
  { label: "About", to: href({ name: "about" }) },
  { label: "Show all units", to: tabHref("all") },
];

/** Where the panel goes: just under the anchor, right edges lined up. */
function useAnchoredStyle(anchor?: RefObject<HTMLElement>): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const el = anchor?.current;
    if (!el) return setStyle(undefined);
    const place = () => {
      const r = el.getBoundingClientRect();
      const top = Math.round(r.bottom + 8);
      setStyle({ top, right: Math.max(8, Math.round(document.documentElement.clientWidth - r.right)), maxHeight: `calc(100vh - ${top + 16}px)` });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  return style;
}

export function MoreSheet({ onClose, anchor }: { onClose: () => void; anchor?: RefObject<HTMLElement> }) {
  const sheet = useRef<HTMLDivElement>(null);
  const placed = useAnchoredStyle(anchor);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // everything behind the sheet is out of reach while it's open
    const behind = [...(document.getElementById("root")?.children ?? [])].filter((el) => !el.contains(sheet.current));
    behind.forEach((el) => el.setAttribute("inert", ""));
    sheet.current?.querySelector<HTMLElement>("a, button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && sheet.current) {
        // keep focus inside the sheet
        const items = [...sheet.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), select, input, textarea")];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      behind.forEach((el) => el.removeAttribute("inert"));
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={anchor ? "sheet-backdrop popover" : "sheet-backdrop"} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={anchor ? "sheet popover" : "sheet"} style={placed} role="dialog" aria-modal="true" aria-labelledby="more-title" ref={sheet}>
        <div className="sheet-head">
          <h2 id="more-title">More</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <MoreActions />
        <hr />
        <ul aria-label="Screens">
          {LINKS.map((l) => (
            <li key={l.to}>
              <a className="sheet-item" href={l.to} onClick={onClose}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <InstallItem onDone={onClose} />
      </div>
    </div>
  );
}

/** "Install app", while the browser offers it (Chrome, Edge, Android). */
function InstallItem({ onDone }: { onDone: () => void }) {
  const canInstall = useCanInstall();
  if (!canInstall) return null;
  return (
    <>
      <hr />
      <button
        type="button"
        className="sheet-item"
        onClick={() => {
          onDone();
          void promptInstall();
        }}
      >
        Install app
      </button>
    </>
  );
}
