// The "More" bottom sheet: the buy-all-upgrades and undo actions, and links
// to the meta screens.
import { useEffect, useRef } from "react";
import { href, tabHref } from "../router";
import { MoreActions } from "./progression/MoreActions";

const LINKS = [
  { label: "Achievements", to: href({ name: "achievements" }) },
  { label: "Statistics", to: href({ name: "statistics" }) },
  { label: "Options", to: href({ name: "options" }) },
  { label: "About", to: href({ name: "about" }) },
  { label: "Show all units", to: tabHref("all") },
];

export function MoreSheet({ onClose }: { onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);

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
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="more-title" ref={sheet}>
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
      </div>
    </div>
  );
}
