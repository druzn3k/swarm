// "Welcome back! While you were away for 3 hours, your swarm produced: ..."
// (the old #welcomeback alert). Computed once on load by the store.
import { useGameValue, useStore } from "../../game/GameContext";
import { formatDuration, useFormat } from "../../format";
import { unitHref } from "../../router";
import { unitLabel } from "../../game/selectors";
import { SpriteIcon } from "../Icon";
import "../../styles/progression.css";

export function WelcomeBack() {
  const store = useStore();
  const fmt = useFormat();
  // re-render when it's dismissed or replaced (after an import)
  useGameValue((s) => (s.welcomeBack ? `${s.welcomeBack.away_ms}:${s.welcomeBack.closed_ms}:${s.welcomeBack.gains.length}` : ""));
  const wb = store.welcomeBack;
  if (!wb) return null;
  const close = () => store.dismissWelcomeBack();
  return (
    <section className="hint welcome" aria-labelledby="welcome-title" data-slot="welcome-back">
      <div className="hint-head">
        <h2 id="welcome-title">Welcome back!</h2>
        <button type="button" className="icon-btn" aria-label="Dismiss welcome back" onClick={close}>
          ✕
        </button>
      </div>
      <p title="Please don't go. The drones need you. They look up to you.">
        While you were away for {formatDuration(wb.away_ms / 1000, { format: "human" }) || "a few seconds"}, your swarm produced
        {wb.gains.length ? ":" : " nothing new."}
      </p>
      {wb.gains.length > 0 && (
        <ul className="gains">
          {wb.gains.map((gain) => {
            const unit = store.g.unit(gain.unit);
            return (
              <li key={unit.name}>
                <a href={unitHref(unit.name)} onClick={close}>
                  <SpriteIcon name={unit.name} tab={unit.tabName} size={24} />
                  <span className="gain-text">
                    <b className="num">{fmt.long(gain.val)}</b> <span className="gain-name">{unitLabel(unit, true)}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
