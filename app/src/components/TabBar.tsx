import { useMemo } from "react";
import type { Game, Unit } from "@swarmsim/engine";
import { useGameValue } from "../game/GameContext";
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

/** Bottom tab bar: the unlocked resource tabs plus "More". Re-renders only when what it shows changes. */
export function TabBar({ current, moreOpen, onMore }: { current?: string; moreOpen: boolean; onMore: () => void }) {
  const fmt = useFormat();
  const snapshot = useGameValue((s) => JSON.stringify(tabInfos(s.game, fmt)));
  const tabs = useMemo(() => JSON.parse(snapshot) as TabInfo[], [snapshot]);
  return (
    <nav className="tabbar" aria-label="Swarm tabs">
      <ul style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map(({ name, label, count, extra, upgradable }) => (
          <li key={name}>
            <a className="tab-btn" href={tabHref(name)} aria-current={current === name ? "page" : undefined} data-tab={name}>
              <SpriteIcon name={name} tab={name} size={28} />
              <span className="tab-label">{label}</span>
              <span className="tab-count num">{count}</span>
              {extra && <span className="tab-count tab-extra num">{extra}</span>}
              {upgradable && <span className="upgrade-dot" role="img" aria-label="New upgrade available" />}
            </a>
          </li>
        ))}
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
