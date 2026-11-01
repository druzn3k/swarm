// The achievements screen (old views/achievements.html): points and percent,
// filters and order (kept in the save, like the old game), and the list.
import { memo, useId, useRef, useState } from "react";
import { useGameValue, useGameValueEvery, useNeeds, useStore } from "../game/GameContext";
import { Dec } from "@swarmsim/engine-wasm";
import { useInView } from "../components/useInView";
import { useFormat } from "../format";
import { ProgressBar } from "../components/ProgressBar";
import { ACHIEVEMENT_BONUS_NEED, achievementBonus, achievementState, earnedDate, listAchievements, readShown, writeShown } from "../components/meta/achievements";
import type { AchievementsShown } from "../components/meta/achievements";
import { dateTime, fromNow } from "../components/meta/time";
import "../styles/meta.css";

const SEP = "\u0001";
/** ticks between re-reads of a card near the screen (they take turns, by index) */
const CARD_EVERY = 2;
/** ticks between re-reads of a card far off screen */
const OFFSCREEN_EVERY = 50;
/** ticks between re-reads of the list's order and the "earned … ago" texts (~1/s) */
const LIST_EVERY = 10;

/**
 * One achievement. Re-renders only when what it shows changes: its state,
 * progress, earned date, or (about once a second) how long ago it was earned.
 */
const AchievementCard = memo(function AchievementCard({ name, index }: { name: string; index: number }) {
  const store = useStore();
  const a = store.g.achievement(name);
  const fmt = useFormat();
  const item = useRef<HTMLLIElement>(null);
  const near = useInView(item);
  const snapshot = useGameValueEvery(
    ({ g }) => {
      const a = g.achievement(name);
      const state = achievementState(a);
      if (state === "earned") return [state, earnedDate(g, a)?.getTime() ?? ""].join(SEP);
      const max = state === "unearned" ? a.progressMax : undefined;
      const val = max ? a.progressVal : undefined;
      if (!max || !val || !Dec.from(max).gt(0)) return state;
      const pct = Dec.from(val).div(max).toNumber();
      return [state, "", pct, fmt.percent(Math.min(1, pct), { floor: true }), `${fmt.num(val)} of ${fmt.num(max)}`].join(SEP);
    },
    near ? CARD_EVERY : OFFSCREEN_EVERY,
    index
  );
  const [state, earnedAt, pct, pctText, ofText] = snapshot.split(SEP);
  // "3 minutes ago", re-read about once a second; worked out at once for a newly earned card
  const agoSnap = useGameValueEvery(({ g }) => (earnedAt ? earnedAt + SEP + fromNow(new Date(+earnedAt), new Date(g.nowMs)) : ""), LIST_EVERY, index);
  const ago = !earnedAt ? "" : agoSnap.startsWith(earnedAt + SEP) ? agoSnap.slice(earnedAt.length + 1) : fromNow(new Date(+earnedAt), new Date(store.g.nowMs));
  // the old game emitted 'achieveclick' on every click; one secret achievement listens for it
  const onClick = () => store.act({ do: "ui_event", name: "achieveclick", params: { name: a.name } });
  const points = a.points;
  if (state === "masked") {
    return (
      <li ref={item}>
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
  return (
    <li ref={item}>
      <button type="button" className={"ach frame " + state} onClick={onClick} data-achievement={a.name}>
        <span className="ach-icon" aria-hidden="true">
          {earned ? "✓" : "★"}
        </span>
        <span className="ach-main">
          <span className="ach-title">{a.label}</span>
          <span className="ach-desc">{a.description((n) => fmt.long(n))}</span>
          {a.st.longdesc && <span className="ach-long">{a.st.longdesc}</span>}
          {earnedAt && (
            <span className="ach-date">
              Earned {ago} · {dateTime(new Date(+earnedAt))}
            </span>
          )}
          {!earned && pctText !== undefined && (
            <span className="ach-progress">
              <ProgressBar value={+pct} label={`${a.label} progress`} />
              <span className="bar-label num">
                <span>{pctText}</span>
                <span>{ofText}</span>
              </span>
            </span>
          )}
        </span>
        {points > 0 && <span className="ach-points num">{earned ? `+${points}` : points}</span>}
      </button>
    </li>
  );
});

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="chip">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Re-renders when the summary or the list's order changes: the summary is
 * re-read every tick, the order on player actions and about once a second.
 * Cards update themselves.
 */
export function AchievementsScreen() {
  const store = useStore();
  useNeeds(ACHIEVEMENT_BONUS_NEED);
  const fmt = useFormat();
  const [shown, setShownState] = useState<AchievementsShown>(() => readShown(store));
  const orderName = useId();
  const setShown = (patch: Partial<AchievementsShown>) => {
    const next = { ...shown, ...patch };
    setShownState(next);
    writeShown(store, next);
  };

  const summary = useGameValue(({ g }) => {
    const bonus = achievementBonus(g);
    const a = g.v.achievements;
    return [fmt.long(a?.points ?? 0), a?.percent ?? 0, a?.earned ?? 0, bonus ? fmt.percent(bonus, { plusOne: true }) : ""].join(SEP);
  });
  const [points, percentText, earnedCount, bonus] = summary.split(SEP);
  const percent = +percentText;
  // `shown` changes through store.act, so the list is re-read at once then
  const names = useGameValueEvery(({ g }) => listAchievements(g, shown).map((a) => a.name).join(","), LIST_EVERY);
  const list = names ? names.split(",") : [];

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Achievements</h1>
      <div className="section card ach-summary">
        <p className="ach-total">
          <b className="num">{points}</b> achievement points
        </p>
        <ProgressBar value={percent} ready={percent >= 1} label="Achievement points earned" />
        <p className="bar-label num">
          <span>{fmt.percent(percent, { floor: true })} complete</span>
          <span>
            {earnedCount} of {store.statics.achievements.length} earned
          </span>
        </p>
        {bonus && (
          <p>
            Your achievements grant a <b className="num">+{bonus}</b> bonus to larva production.
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
          {list.map((name, i) => (
            <AchievementCard key={name} name={name} index={i} />
          ))}
        </ul>
      )}
    </section>
  );
}
