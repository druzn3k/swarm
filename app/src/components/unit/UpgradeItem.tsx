// One upgrade (or ability) on a unit screen: level, cost, progress toward
// affording it, time until affordable, and buy 1 / 25% / max buttons.
import type { ReactNode } from "react";
import type { Upgrade } from "@swarmsim/engine";
import { useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import type { Formatter } from "../../format";
import { UpgradeDescription } from "../../content/LiveDescription";
import { CostList } from "../CostList";
import { ProgressBar } from "../ProgressBar";
import { UpgradeIcon } from "../Icon";
import { StackButton } from "./BuyUnit";

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
  // old buyupgrade (views/buyunit.html): buy 1, 25% when it's more than 1 and less than max, and max when more than 1
  const max = upgrade.maxCostMet();
  const quarter = upgrade.maxCostMet(0.25);
  const is25 = max.greaterThan(quarter) && quarter.greaterThan(1);
  const buy = () => store.act(({ commands }) => commands.buyUpgrade({ upgrade, num: 1, ui: "button" }));
  const buyMax = (percent: number) => store.act(({ commands }) => commands.buyMaxUpgrade({ upgrade, percent, ui: "button" }));
  return (
    <li className="upgrade" data-upgrade={upgrade.name}>
      <div className="upgrade-top">
        <UpgradeIcon name={upgrade.name} size={32} />
        <h3 className="upgrade-name">{t.label}</h3>
        {t.maxlevel != 1 && !ability && <span className="upgrade-level num">Lv {fmt.num(upgrade.count())}</span>}
      </div>
      <UpgradeDescription upgrade={upgrade} />
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
      <div className="btn-row">
        {ready ? <StackButton verb={verb} amount="1" onClick={buy} /> : <StackButton verb="can't" amount={verb} />}
        <StackButton verb={verb} amount={is25 ? fmt.num(quarter) : "25%"} onClick={is25 ? () => buyMax(0.25) : undefined} />
        <StackButton verb={verb} amount={max.greaterThan(1) ? fmt.num(max) : "max"} onClick={max.greaterThan(1) ? () => buyMax(1) : undefined} />
      </div>
      {footer}
    </li>
  );
}
