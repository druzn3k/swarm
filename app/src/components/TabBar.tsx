import type { Unit } from "@swarmsim/engine";
import { useGame } from "../game/GameContext";
import { useFormat } from "../format";
import { TAB_ORDER, tabByName } from "../game/selectors";
import { tabHref } from "../router";
import { SpriteIcon } from "./Icon";

/** Bottom tab bar: the five resource tabs plus "More". Locked tabs are dimmed. */
export function TabBar({ current, moreOpen, onMore }: { current?: string; moreOpen: boolean; onMore: () => void }) {
  const { game } = useGame();
  const fmt = useFormat();
  return (
    <nav className="tabbar" aria-label="Swarm tabs">
      <ul>
        {TAB_ORDER.map((name) => {
          const tab = tabByName(game, name)!;
          const lead = tab.leadunit as Unit;
          const label = lead.unittype.plural as string;
          if (!tab.isVisible()) {
            return (
              <li key={name}>
                <span className="tab-btn" aria-disabled="true" data-tab={name}>
                  <SpriteIcon name={name} tab={name} size={28} />
                  <span className="tab-label">{label}</span>
                  <span className="tab-count">Locked</span>
                </span>
              </li>
            );
          }
          const cap = lead.capValue();
          let count = fmt.num(lead.count());
          if (cap) count += ` ${fmt.percent(lead.capPercent(), { floor: true })}`;
          // special case from the old tabs: inactive mutagen waiting for ascension
          if (name === "mutagen") {
            const pre = game.unit("premutagen").count();
            if (pre.greaterThan(0)) count += ` +${fmt.num(pre)}`;
          }
          const upgradable = tab.isNewlyUpgradable();
          return (
            <li key={name}>
              <a className="tab-btn" href={tabHref(name)} aria-current={current === name ? "page" : undefined} data-tab={name}>
                <SpriteIcon name={name} tab={name} size={28} />
                <span className="tab-label">{label}</span>
                <span className="tab-count num">{count}</span>
                {upgradable && <span className="upgrade-dot" role="img" aria-label="New upgrade available" />}
              </a>
            </li>
          );
        })}
        <li>
          <button type="button" className="tab-btn" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={onMore}>
            <span className="more-glyph" aria-hidden="true">
              ⋯
            </span>
            <span className="tab-label">More</span>
            <span className="tab-count">&nbsp;</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
