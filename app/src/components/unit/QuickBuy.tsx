// The old unit table's quick-buy dropdown (views/buyunit-dropdown.html),
// shown with "advanced unit data". Buy 1 and max of the unit are on every
// card's action row (CardActions.tsx); this keeps the dropdown's other
// choices, so nothing the old table offered is lost: 25% of the unit, and
// buy 1 / 25% / max of each visible upgrade. Its contents only render while
// it is open.
import { useState } from "react";
import { Dec } from "@swarmsim/engine-wasm";
import { useGame, useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import type { UnitRef, UpgradeRef } from "../../game/view";
import { StackButton } from "./BuyUnit";

/** Buy 25%: the one unit choice of the old dropdown that the card's row doesn't have. */
function QuarterButton({ unit }: { unit: UnitRef }) {
  const store = useStore();
  const fmt = useFormat();
  const max = Dec.from(unit.maxCostMet);
  const quarter = Dec.from(unit.maxCostMetQuarter);
  const is25 = max.gt(quarter) && quarter.gt(1);
  const buy = () => store.act({ do: "buy_max_unit", unit: unit.name, percent: 0.25, ui: "button" });
  return (
    <div className="quickbuy-upgrade">
      <p className="quickbuy-title">{unit.plural}</p>
      <div className="btn-row one">
        <StackButton verb={`${unit.verb} 25%`} amount={is25 ? fmt.num(quarter.times(unit.twinMult)) : "–"} onClick={is25 ? buy : undefined} />
      </div>
    </div>
  );
}

export function UpgradeButtons({ upgrade, verb = "buy" }: { upgrade: UpgradeRef; verb?: string }) {
  const store = useStore();
  const fmt = useFormat();
  const max = Dec.from(upgrade.maxCostMet);
  const quarter = Dec.from(upgrade.maxCostMetQuarter);
  const is25 = max.gt(quarter) && quarter.gt(1);
  const buy = () => store.act({ do: "buy_upgrade", upgrade: upgrade.name, amount: { num: "1" }, ui: "button" });
  const buyMax = (percent: number) => store.act({ do: "buy_max_upgrade", upgrade: upgrade.name, percent, ui: "button" });
  return (
    <div className="quickbuy-upgrade">
      <p className="quickbuy-title">{upgrade.label}</p>
      <div className="btn-row">
        {upgrade.costMet ? <StackButton verb={verb} amount="1" onClick={buy} /> : <StackButton verb="can't" amount={verb} />}
        <StackButton verb={verb} amount={is25 ? fmt.num(quarter) : "25%"} onClick={is25 ? () => buyMax(0.25) : undefined} />
        <StackButton verb={verb} amount={max.gt(1) ? fmt.num(max) : "max"} onClick={max.gt(1) ? () => buyMax(1) : undefined} />
      </div>
    </div>
  );
}

/** The open dropdown: re-renders every tick. */
function QuickBuyBody({ unit }: { unit: string }) {
  const { g } = useGame();
  const u = g.unit(unit);
  return (
    <div className="quickbuy-body">
      <QuarterButton unit={u} />
      {g.s.upgradesOf(u.id, "upgrade").concat(g.s.upgradesOf(u.id, "ability")).sort((a, b) => a - b)
        .map((i) => g.upgrade(i))
        .filter((up) => up.visible)
        .map((up) => (
          <UpgradeButtons key={up.name} upgrade={up} />
        ))}
    </div>
  );
}

/**
 * Under a buyable unit's card, with "advanced unit data": the old dropdown's
 * choices that the card's row (+1, max, upgrade) doesn't offer: 25% of the
 * unit, and buy 1 / 25% / max of each visible upgrade.
 */
export function QuickBuy({ unit }: { unit: string }) {
  const [open, setOpen] = useState(false);
  const store = useStore();
  const plural = store.g.unit(unit).plural;
  return (
    <details className="quickbuy" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-quickbuy={unit}>
      <summary>
        More: 25%, each upgrade<span className="sr-only"> ({plural})</span>
      </summary>
      {open && <QuickBuyBody unit={unit} />}
    </details>
  );
}
