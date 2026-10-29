import { useMemo } from "react";
import type { RefObject } from "react";
import type { Game, Unit } from "@swarmsim/engine";
import { useGameValueEvery } from "../game/GameContext";
import { useFormat } from "../format";
import type { Formatter } from "../format";
import { TAB_ORDER, tabByName } from "../game/selectors";
import { tabHref } from "../router";
import { SpriteIcon } from "./Icon";

interface TabInfo {
  name: string;
  label: string;
  count: string;
  extra: string;
  upgradable: boolean;
}

/** What each unlocked tab shows. */
function tabInfos(game: Game, fmt: Formatter): TabInfo[] {
  const out: TabInfo[] = [];
  for (const name of TAB_ORDER) {
    const tab = tabByName(game, name)!;
    // like the old tabs, locked tabs are hidden
    if (!tab.isVisible()) continue;
    const lead = tab.leadunit as Unit;
    let extra = "";
    if (lead.capValue()) extra = fmt.percent(lead.capPercent(), { floor: true });
    // special case from the old tabs: inactive mutagen waiting for ascension
    if (name === "mutagen") extra = `+${fmt.num(game.unit("premutagen").count())}`;
    out.push({ name, label: lead.unittype.plural as string, count: fmt.num(lead.count()), extra, upgradable: tab.isNewlyUpgradable() });
  }
  return out;
}

/**
 * The unlocked resource tabs plus "More": a bottom bar on the phone, a strip
 * under the header on the laptop layout (`wide`). Re-renders only when what it
 * shows changes, and reads the game on every other tick.
 */
export function TabBar({
  current,
  moreOpen,
  onMore,
  wide = false,
  moreRef,
}: {
  current?: string;
  moreOpen: boolean;
  onMore: () => void;
  wide?: boolean;
  moreRef?: RefObject<HTMLButtonElement>;
}) {
  const fmt = useFormat();
  // every other tick (5 a second; the "new upgrade" markers walk every unit of
  // every tab): the tab bar shows totals, not a ticker. Player actions show at once.
  const snapshot = useGameValueEvery((s) => JSON.stringify(tabInfos(s.game, fmt)), 2);
  const tabs = useMemo(() => JSON.parse(snapshot) as TabInfo[], [snapshot]);
  return (
    <nav className={wide ? "tabbar strip" : "tabbar"} aria-label="Swarm tabs">
      <ul style={wide ? undefined : { gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map(({ name, label, count, extra, upgradable }) => (
          <li key={name}>
            <a className="tab-btn" href={tabHref(name)} aria-current={current === name ? "page" : undefined} data-tab={name}>
              <SpriteIcon name={name} tab={name} size={28} />
              <span className="tab-text">
                <span className="tab-label">{label}</span>
                <span className="tab-count num">{count}</span>
                {extra && <span className="tab-count tab-extra num">{extra}</span>}
              </span>
              {upgradable && <span className="upgrade-dot" role="img" aria-label="New upgrade available" />}
            </a>
          </li>
        ))}
        <li>
          <button type="button" className="tab-btn tab-more" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={onMore} ref={moreRef}>
            <span className="more-glyph" aria-hidden="true">
              ⋯
            </span>
            <span className="tab-text">
              <span className="tab-label">More</span>
              <span className="tab-count">&nbsp;</span>
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
