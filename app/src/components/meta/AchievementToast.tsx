// The "Achievement!" toast (old FlashQueueCtrl in index.html): one at a time,
// queued, shown for a few seconds above the tab bar. Close clears the queue,
// like the old close button.
import { useEffect, useRef, useState } from "react";
import type { Achievement } from "@swarmsim/engine";
import { useEngineEvent } from "../../game/GameContext";
import { useFormat } from "../../format";
import { href } from "../../router";
import "../../styles/meta.css";

export const TOAST_MILLIS = 6000;

interface Toast {
  id: number;
  label: string;
  points: number;
  description: string;
  longdesc?: string;
}

export function AchievementToast() {
  const fmt = useFormat();
  const [queue, setQueue] = useState<Toast[]>([]);
  const [paused, setPaused] = useState(false);
  const next = useRef(0);

  useEngineEvent("achieve", (a: Achievement) => {
    const toast: Toast = {
      id: next.current++,
      label: a.type.label,
      points: a.pointsEarned(),
      description: a.description((n) => fmt.long(n)),
      longdesc: a.type.longdesc || undefined,
    };
    setQueue((q) => [...q, toast]);
  });

  const current = queue[0];
  // auto-dismiss, unless the player is reading it (focus or pointer inside)
  useEffect(() => {
    if (!current || paused) return;
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), TOAST_MILLIS);
    return () => window.clearTimeout(t);
  }, [current, paused]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {current && (
        <div
          className="toast frame"
          key={current.id}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
        >
          <span className="toast-badge" aria-hidden="true">
            ★
          </span>
          <div className="toast-body">
            <p className="toast-kicker">
              Achievement{current.points > 0 && <span className="num"> +{current.points.toLocaleString("en-US")} pts</span>}
            </p>
            <a className="toast-title" href={href({ name: "achievements" })} onClick={() => setQueue([])}>
              {current.label}
            </a>
            <p className="toast-desc">{current.description}</p>
            {current.longdesc && <p className="toast-long">{current.longdesc}</p>}
            {queue.length > 1 && <p className="toast-more muted">+{queue.length - 1} more</p>}
          </div>
          <button
            type="button"
            className="icon-btn toast-close"
            aria-label="Close achievement notice"
            onClick={() => {
              setPaused(false);
              setQueue([]);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
