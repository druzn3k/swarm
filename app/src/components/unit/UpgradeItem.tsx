// One upgrade (or ability) on a unit screen: level, cost, progress toward
// affording it, time until affordable, and buy 1 / 25% / max buttons.
import type { ReactNode } from "react";
import { Dec } from "@swarmsim/engine-wasm";
import { useStore } from "../../game/GameContext";
import type { UpgradeRef } from "../../game/view";
import { estimateSecs } from "../../game/view";
import { useFormat } from "../../format";
import type { Formatter } from "../../format";
import { UpgradeDescription } from "../../content/LiveDescription";
import { CostList } from "../CostList";
import { ProgressBar } from "../ProgressBar";
import { UpgradeIcon } from "../Icon";
import { StackButton } from "./BuyUnit";

/** Time until affordable, like the old estimateUpgradeSecs + duration filter ("" when unknown or never). */
/**
 * Time until affordable, like the old estimateUpgradeSecs + duration filter
 * ("" when unknown or never). Bisection estimates are exact enough not to
 * say "or less". Needs the upgrade's unit focused (the estimate is a detail).
 */
export function upgradeEta(upgrade: UpgradeRef, fmt: Formatter): string {
  const eta = upgrade.eta;
  if (!eta || typeof eta === "string") return "";
  return fmt.duration(estimateSecs(eta.wait.secs));
}

export function UpgradeItem({ upgrade, ability = false, footer }: { upgrade: UpgradeRef; ability?: boolean; footer?: ReactNode }) {
  const store = useStore();
  const fmt = useFormat();
  const t = upgrade.st;
  const verb = ability ? "cast" : "buy";
  const ready = upgrade.costMet;
  // a ready upgrade shows a full bar; otherwise progress toward the next level
  const pct = ready ? 1 : Dec.from(upgrade.costMetPercent).toNumber();
  const eta = ready ? "" : upgradeEta(upgrade, fmt);
  // old buyupgrade (views/buyunit.html): buy 1, 25% when it's more than 1 and less than max, and max when more than 1
  const max = Dec.from(upgrade.maxCostMet);
  const quarter = Dec.from(upgrade.maxCostMetQuarter);
  const is25 = max.gt(quarter) && quarter.gt(1);
  const buy = () => store.act({ do: "buy_upgrade", upgrade: upgrade.name, amount: { num: "1" }, ui: "button" });
  const buyMax = (percent: number) => store.act({ do: "buy_max_upgrade", upgrade: upgrade.name, percent, ui: "button" });
  const single = t.maxlevel !== undefined && Dec.from(t.maxlevel).eq(1);
  return (
    <li className="upgrade" data-upgrade={upgrade.name}>
      <div className="upgrade-top">
        <UpgradeIcon name={upgrade.name} size={32} />
        <h3 className="upgrade-name">{upgrade.label}</h3>
        {!single && !ability && <span className="upgrade-level num">Lv {fmt.num(upgrade.count)}</span>}
      </div>
      <UpgradeDescription upgrade={upgrade} />
      {t.lol && <p className="lol">{t.lol}</p>}
      <p className="cost">
        {ability ? (
          <>
            This ability costs <CostList costs={upgrade.totalCost} period={false} /> per use.
          </>
        ) : (
          <>
            {single ? "This" : "Next"} upgrade costs <CostList costs={upgrade.totalCost} />
          </>
        )}
      </p>
      <ProgressBar value={pct} ready={ready} label={`${upgrade.label} progress`} />
      <p className="bar-label num">
        <span>{ready ? "Ready" : fmt.percent(pct, { floor: true })}</span>
        <span>{eta}</span>
      </p>
      <div className="btn-row">
        {ready ? <StackButton verb={verb} amount="1" onClick={buy} /> : <StackButton verb="can't" amount={verb} />}
        <StackButton verb={verb} amount={is25 ? fmt.num(quarter) : "25%"} onClick={is25 ? () => buyMax(0.25) : undefined} />
        <StackButton verb={verb} amount={max.gt(1) ? fmt.num(max) : "max"} onClick={max.gt(1) ? () => buyMax(1) : undefined} />
      </div>
      {footer}
    </li>
  );
}
