// The achievements screen (old views/achievements.html): points and percent,
// filters and order (kept in the save, like the old game), and the list.
import { useId, useState } from "react";
import type { Achievement } from "@swarmsim/engine";
import { useGame } from "../game/GameContext";
import { useFormat } from "../format";
import { ProgressBar } from "../components/ProgressBar";
import { achievementBonus, achievementState, earnedDate, listAchievements, readShown, writeShown } from "../components/meta/achievements";
import type { AchievementsShown } from "../components/meta/achievements";
import { dateTime, fromNow } from "../components/meta/time";
import "../styles/meta.css";

function AchievementCard({ a, onClick }: { a: Achievement; onClick: () => void }) {
  const store = useGame();
  const fmt = useFormat();
  const state = achievementState(a);
  const points = a.type.points as number;
  if (state === "masked") {
    return (
      <li>
        <button type="button" className="ach frame masked" onClick={onClick} data-achievement={a.name}>
          <span className="ach-icon" aria-hidden="true">
            ?
          </span>
          <span className="ach-main">
            <span className="ach-title">???</span>
            <span className="ach-desc">A hidden achievement.</span>
          </span>
          <span className="ach-points num">{points}</span>
        </button>
      </li>
    );
  }
  const earned = state === "earned";
  const date = earned ? earnedDate(store.game, a) : undefined;
  const max = a.hasProgress() ? a.progressMax() : undefined;
  const val = max ? a.progressVal() : undefined;
  return (
    <li>
      <button type="button" className={"ach frame " + state} onClick={onClick} data-achievement={a.name}>
        <span className="ach-icon" aria-hidden="true">
          {earned ? "✓" : "★"}
        </span>
        <span className="ach-main">
          <span className="ach-title">{a.type.label}</span>
          <span className="ach-desc">{a.description((n) => fmt.long(n))}</span>
          {a.type.longdesc && <span className="ach-long">{a.type.longdesc}</span>}
          {date && (
            <span className="ach-date">
              Earned {fromNow(date, store.game.now)} · {dateTime(date)}
            </span>
          )}
          {!earned && max && val && max.greaterThan(0) && (
            <span className="ach-progress">
              <ProgressBar value={a.progressPercent().toNumber()} label={`${a.type.label} progress`} />
              <span className="bar-label num">
                <span>{fmt.percent(Math.min(1, a.progressPercent().toNumber()), { floor: true })}</span>
                <span>
                  {fmt.num(val)} of {fmt.num(max)}
                </span>
              </span>
            </span>
          )}
        </span>
        {points > 0 && <span className="ach-points num">{earned ? `+${points}` : points}</span>}
      </button>
    </li>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="chip">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function AchievementsScreen() {
  const store = useGame();
  const fmt = useFormat();
  const { game } = store;
  const [shown, setShownState] = useState<AchievementsShown>(() => readShown(game));
  const orderName = useId();
  const setShown = (patch: Partial<AchievementsShown>) => {
    const next = { ...shown, ...patch };
    setShownState(next);
    store.act(({ game }) => writeShown(game, next));
  };

  const points = game.achievementPoints();
  const percent = game.achievementPercent();
  const bonus = achievementBonus(game);
  const list = listAchievements(game, shown);
  const earnedCount = game.achievementlist().filter((a) => a.isEarned()).length;

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Achievements</h1>
      <div className="section card ach-summary">
        <p className="ach-total">
          <b className="num">{fmt.long(points)}</b> achievement points
        </p>
        <ProgressBar value={percent} ready={percent >= 1} label="Achievement points earned" />
        <p className="bar-label num">
          <span>{fmt.percent(percent, { floor: true })} complete</span>
          <span>
            {earnedCount} of {game.achievementlist().length} earned
          </span>
        </p>
        {bonus && (
          <p>
            Your achievements grant a <b className="num">+{fmt.percent(bonus, { plusOne: true })}</b> bonus to larva production.
          </p>
        )}
      </div>

      <fieldset className="section card filters">
        <legend className="sr-only">Show and sort achievements</legend>
        <p className="filter-label">Show</p>
        <div className="chips">
          <Toggle label="Earned" checked={shown.earned} onChange={(v) => setShown({ earned: v })} />
          <Toggle label="Unearned" checked={shown.unearned} onChange={(v) => setShown({ unearned: v })} />
          <Toggle label="Masked" checked={shown.masked} onChange={(v) => setShown({ masked: v })} />
        </div>
        <p className="filter-label">Sort by</p>
        <div className="chips" role="radiogroup" aria-label="Sort by">
          <label className="chip">
            <input type="radio" name={orderName} checked={shown.order === "default"} onChange={() => setShown({ order: "default" })} />
            <span>Date earned</span>
          </label>
          <label className="chip">
            <input
              type="radio"
              name={orderName}
              checked={shown.order === "percentComplete"}
              onChange={() => setShown({ order: "percentComplete" })}
            />
            <span>% complete</span>
          </label>
        </div>
        <div className="chips" role="radiogroup" aria-label="Order">
          <label className="chip">
            <input type="radio" name={orderName + "r"} checked={!shown.reverse} onChange={() => setShown({ reverse: false })} />
            <span>Lowest first</span>
          </label>
          <label className="chip">
            <input type="radio" name={orderName + "r"} checked={shown.reverse} onChange={() => setShown({ reverse: true })} />
            <span>Highest first</span>
          </label>
        </div>
      </fieldset>

      {list.length === 0 ? (
        <p className="placeholder">No achievements match these filters.</p>
      ) : (
        <ul className="ach-list" aria-label="Achievements">
          {list.map((a) => (
            // the old game emitted 'achieveclick' on every click; one secret achievement listens for it
            <AchievementCard key={a.name} a={a} onClick={() => store.act(({ events }) => events.emit("achieveclick", a))} />
          ))}
        </ul>
      )}
    </section>
  );
}
