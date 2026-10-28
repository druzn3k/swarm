// The "More" bottom sheet: links to the meta screens, and (phase B) the
// buy-all-upgrades and undo actions.
import { useEffect, useRef } from "react";
import { href, tabHref } from "../router";

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
    sheet.current?.querySelector<HTMLElement>("a, button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && sheet.current) {
        // keep focus inside the sheet
        const items = [...sheet.current.querySelectorAll<HTMLElement>("a, button:not(:disabled)")];
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
        {/* PHASE B (B1): actions go here — "Buy all N upgrades", "Buy cheapest N
            upgrades" (25%), and "Undo" with its countdown. Keep them above the links. */}
        <ul data-slot="more-actions" aria-label="Actions">
          <li>
            <button type="button" className="sheet-item" disabled>
              Buy all upgrades <small>coming soon</small>
            </button>
          </li>
          <li>
            <button type="button" className="sheet-item" disabled>
              Undo <small>coming soon</small>
            </button>
          </li>
        </ul>
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
