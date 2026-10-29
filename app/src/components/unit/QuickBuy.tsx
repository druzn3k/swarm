// The old unit table's quick-buy dropdown (views/buyunit-dropdown.html),
// shown with "advanced unit data". Buy 1 and max of the unit are on every
// card's action row (CardActions.tsx); this keeps the dropdown's other
// choices, so nothing the old table offered is lost: 25% of the unit, and
// buy 1 / 25% / max of each visible upgrade. Its contents only render while
// it is open.
import { useState } from "react";
import type { Unit, Upgrade } from "@swarmsim/engine";
import { useGame, useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import { StackButton } from "./BuyUnit";

/** Buy 25%: the one unit choice of the old dropdown that the card's row doesn't have. */
function QuarterButton({ unit }: { unit: Unit }) {
  const store = useStore();
  const fmt = useFormat();
  const verb = String(unit.unittype.verb ?? "buy");
  const max = unit.maxCostMet();
  const quarter = unit.maxCostMet(0.25);
  const is25 = max.greaterThan(quarter) && quarter.greaterThan(1);
  const buy = () => store.act(({ commands }) => commands.buyMaxUnit({ unit, percent: 0.25, ui: "button" }));
  return (
    <div className="quickbuy-upgrade">
      <p className="quickbuy-title">{String(unit.unittype.plural)}</p>
      <div className="btn-row one">
        <StackButton verb={`${verb} 25%`} amount={is25 ? fmt.num(quarter.times(unit.twinMult())) : "–"} onClick={is25 ? buy : undefined} />
      </div>
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
      <QuarterButton unit={unit} />
      {unit.upgrades.list
        .filter((u) => u.isVisible())
        .map((u) => (
          <UpgradeButtons key={u.name} upgrade={u} />
        ))}
    </div>
  );
}

/**
 * Under a buyable unit's card, with "advanced unit data": the old dropdown's
 * choices that the card's row (+1, max, upgrade) doesn't offer: 25% of the
 * unit, and buy 1 / 25% / max of each visible upgrade.
 */
export function QuickBuy({ unit }: { unit: Unit }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="quickbuy" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-quickbuy={unit.name}>
      <summary>
        More: 25%, each upgrade<span className="sr-only"> ({String(unit.unittype.plural)})</span>
      </summary>
      {open && <QuickBuyBody unit={unit} />}
    </details>
  );
}
