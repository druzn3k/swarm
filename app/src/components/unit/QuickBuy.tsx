// The old unit table's quick-buy dropdown (views/buyunit-dropdown.html),
// shown with "advanced unit data": buy the unit or any of its visible
// upgrades without opening the unit screen. Its contents only render while
// it is open.
import { useState } from "react";
import type { Unit, Upgrade } from "@swarmsim/engine";
import { useGame, useGameValue, useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import { StackButton } from "./BuyUnit";

function UnitButtons({ unit }: { unit: Unit }) {
  const store = useStore();
  const fmt = useFormat();
  const twin = unit.twinMult();
  const max = unit.maxCostMet();
  const quarter = unit.maxCostMet(0.25);
  const is25 = max.greaterThan(quarter) && quarter.greaterThan(1);
  const buy = () => store.act(({ commands }) => commands.buyUnit({ unit, num: 1, ui: "button" }));
  const buyMax = (percent: number) => store.act(({ commands }) => commands.buyMaxUnit({ unit, percent, ui: "button" }));
  return (
    <div className="btn-row">
      {unit.isCostMet() ? <StackButton verb="buy" amount={fmt.num(twin)} onClick={buy} /> : <StackButton verb="can't" amount="buy" />}
      <StackButton verb="buy" amount={is25 ? fmt.num(quarter.times(twin)) : "25%"} onClick={is25 ? () => buyMax(0.25) : undefined} />
      <StackButton verb="buy" amount={max.greaterThan(1) ? fmt.num(max.times(twin)) : "max"} onClick={max.greaterThan(1) ? () => buyMax(1) : undefined} />
    </div>
  );
}

function UpgradeButtons({ upgrade }: { upgrade: Upgrade }) {
  const store = useStore();
  const fmt = useFormat();
  const max = upgrade.maxCostMet();
  const quarter = upgrade.maxCostMet(0.25);
  const is25 = max.greaterThan(quarter) && quarter.greaterThan(1);
  const buy = () => store.act(({ commands }) => commands.buyUpgrade({ upgrade, num: 1, ui: "button" }));
  const buyMax = (percent: number) => store.act(({ commands }) => commands.buyMaxUpgrade({ upgrade, percent, ui: "button" }));
  return (
    <div className="quickbuy-upgrade">
      <p className="quickbuy-title">{upgrade.type.label}</p>
      <div className="btn-row">
        {upgrade.isCostMet() ? <StackButton verb="buy" amount="1" onClick={buy} /> : <StackButton verb="can't" amount="buy" />}
        <StackButton verb="buy" amount={is25 ? fmt.num(quarter) : "25%"} onClick={is25 ? () => buyMax(0.25) : undefined} />
        <StackButton verb="buy" amount={max.greaterThan(1) ? fmt.num(max) : "max"} onClick={max.greaterThan(1) ? () => buyMax(1) : undefined} />
      </div>
    </div>
  );
}

/** The open dropdown: re-renders every tick. */
function QuickBuyBody({ unit }: { unit: Unit }) {
  useGame();
  return (
    <div className="quickbuy-body">
      <UnitButtons unit={unit} />
      {unit.upgrades.list
        .filter((u) => u.isVisible())
        .map((u) => (
          <UpgradeButtons key={u.name} upgrade={u} />
        ))}
    </div>
  );
}

/** "Buy up to N" under a unit card. Re-renders when its label changes. */
export function QuickBuy({ unit }: { unit: Unit }) {
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  const label = useGameValue(() => {
    if (!unit.isBuyButtonVisible()) return null;
    const max = unit.maxCostMet();
    return max.isZero() ? "Can't buy" : `Buy up to ${fmt.num(max.times(unit.twinMult()))}`;
  });
  if (label == null) return null;
  return (
    <details className="quickbuy" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-quickbuy={unit.name}>
      <summary>
        <span className="num">{label}</span>
        <span className="sr-only"> {String(unit.unittype.plural)}</span>
      </summary>
      {open && <QuickBuyBody unit={unit} />}
    </details>
  );
}
