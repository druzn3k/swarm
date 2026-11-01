// The achievement-points row at the top of the larva tab (the old "filthy
// hack" in views/main.html): shown once the achievement bonus upgrade is owned.
import { useGame, useNeeds } from "../../game/GameContext";
import { useFormat } from "../../format";
import { href } from "../../router";
import { ACHIEVEMENT_BONUS_NEED, achievementBonus } from "./achievements";
import "../../styles/meta.css";

export function AchievementPointsRow() {
  const { g } = useGame();
  useNeeds(ACHIEVEMENT_BONUS_NEED);
  const fmt = useFormat();
  const bonus = achievementBonus(g);
  if (!bonus) return null;
  return (
    <ul className="unit-list" aria-label="Achievements">
      <li className="card">
        <a className="unit-card ach-row" href={href({ name: "achievements" })}>
          <span className="ach-row-icon" aria-hidden="true">
            ★
          </span>
          <span className="unit-names">
            <span className="unit-name">achievement points</span>
            <span className="unit-rate num">+{fmt.percent(bonus, { plusOne: true })} larvae</span>
          </span>
          <span className="unit-count num">{fmt.num(g.v.achievements?.points ?? 0)}</span>
          <span className="chevron" aria-hidden="true" />
        </a>
      </li>
    </ul>
  );
}
