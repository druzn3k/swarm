import type { Unit } from "@swarmsim/engine";
import { useGame } from "../game/GameContext";
import { useFormat } from "../format";
import { TAB_ORDER, tabByName } from "../game/selectors";
import { tabHref } from "../router";
import { SpriteIcon } from "./Icon";

/** Bottom tab bar: the unlocked resource tabs plus "More". */
export function TabBar({ current, moreOpen, onMore }: { current?: string; moreOpen: boolean; onMore: () => void }) {
  const { game } = useGame();
  const fmt = useFormat();
  return (
    <nav className="tabbar" aria-label="Swarm tabs">
      <ul style={{ gridTemplateColumns: `repeat(${TAB_ORDER.filter((n) => tabByName(game, n)!.isVisible()).length + 1}, minmax(0, 1fr))` }}>
        {TAB_ORDER.map((name) => {
          const tab = tabByName(game, name)!;
          const lead = tab.leadunit as Unit;
          const label = lead.unittype.plural as string;
          // like the old tabs, locked tabs are hidden
          if (!tab.isVisible()) return null;
          const cap = lead.capValue();
          const count = fmt.num(lead.count());
          let extra = "";
          if (cap) extra = fmt.percent(lead.capPercent(), { floor: true });
          // special case from the old tabs: inactive mutagen waiting for ascension
          if (name === "mutagen") extra = `+${fmt.num(game.unit("premutagen").count())}`;
          const upgradable = tab.isNewlyUpgradable();
          return (
            <li key={name}>
              <a className="tab-btn" href={tabHref(name)} aria-current={current === name ? "page" : undefined} data-tab={name}>
                <SpriteIcon name={name} tab={name} size={28} />
                <span className="tab-label">{label}</span>
                <span className="tab-count num">{count}</span>
                {extra && <span className="tab-count tab-extra num">{extra}</span>}
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
