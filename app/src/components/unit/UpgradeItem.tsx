// One upgrade (or ability) on a unit screen: level, cost, progress toward
// affording it, time until affordable, and buy buttons.
import type { ReactNode } from "react";
import type { Upgrade } from "@swarmsim/engine";
import { useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import type { Formatter } from "../../format";
import { upgradeDescription } from "../../content/descriptions";
import { CostList } from "../CostList";
import { ProgressBar } from "../ProgressBar";

/** Time until affordable, like the old estimateUpgradeSecs + duration filter ("" when unknown or never). */
export function upgradeEta(upgrade: Upgrade, fmt: Formatter): string {
  try {
    const est = upgrade.estimateSecsUntilBuyable();
    const val = est.val.toNumber();
    if (!isFinite(val)) return "";
    const exact = est.unit?.isEstimateExact?.() ?? true;
    return fmt.duration(val, { nonexact: !exact });
  } catch {
    // the engine keeps an old-engine crash for some max-level cases
    return "";
  }
}

export function UpgradeItem({ upgrade, ability = false, footer }: { upgrade: Upgrade; ability?: boolean; footer?: ReactNode }) {
  const store = useStore();
  const fmt = useFormat();
  const t = upgrade.type;
  const verb = ability ? "cast" : "buy";
  const ready = upgrade.isCostMet();
  // a ready upgrade shows a full bar; otherwise progress toward the next level
  const pct = ready ? 1 : upgrade.costMetPercent().toNumber();
  const eta = ready ? "" : upgradeEta(upgrade, fmt);
  // the old game's special case: only twin upgrades get a buy-max button
  const twin = !ability && upgrade.name.indexOf("twin") >= 0;
  const max = upgrade.maxCostMet();
  const desc = upgradeDescription(upgrade.name, t.description);
  const buy = () => store.act(({ commands }) => commands.buyUpgrade({ upgrade, num: 1, ui: "button" }));
  const buyMax = () => store.act(({ commands }) => commands.buyMaxUpgrade({ upgrade, percent: 1, ui: "button" }));
  return (
    <li className="upgrade" data-upgrade={upgrade.name}>
      <div className="upgrade-top">
        <h3 className="upgrade-name">{t.label}</h3>
        {t.maxlevel != 1 && !ability && <span className="upgrade-level num">Lv {fmt.num(upgrade.count())}</span>}
      </div>
      {desc && <p className="desc">{desc}</p>}
      {t.lol && <p className="lol">{t.lol}</p>}
      <p className="cost">
        {ability ? (
          <>
            This ability costs <CostList costs={upgrade.totalCost()} period={false} /> per use.
          </>
        ) : (
          <>
            {t.maxlevel == 1 ? "This" : "Next"} upgrade costs <CostList costs={upgrade.totalCost()} />
          </>
        )}
      </p>
      <ProgressBar value={pct} ready={ready} label={`${t.label} progress`} />
      <p className="bar-label num">
        <span>{ready ? "Ready" : fmt.percent(pct, { floor: true })}</span>
        <span>{eta}</span>
      </p>
      <div className={"btn-row " + (twin ? "two" : "one")}>
        <button type="button" className="btn" disabled={!ready} onClick={buy}>
          {ready ? `${verb} 1` : `Can't ${verb}`}
        </button>
        {twin && (
          <button type="button" className="btn" disabled={!max.greaterThan(1)} onClick={buyMax}>
            {verb} {max.greaterThan(1) ? fmt.num(max) : "max"}
          </button>
        )}
      </div>
      {footer}
    </li>
  );
}
