// Buying from the unit list: a compact row under each buyable unit's card
// with "+1" (one purchase, times twins, like the unit screen's buy 1), "Max N"
// (all you can afford) and "Upgrade" (one level of the first affordable,
// shown upgrade, in the unit screen's order). Same commands as the unit
// screen, so statistics, achievements, undo and the hive's burst behave the
// same. The card head above stays the link to the unit screen.
import { useEffect, useRef, useState } from "react";
import type { Unit, Upgrade } from "@swarmsim/engine";
import { useGameValueEvery, useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import { isUnitBuyable, unitNoun, visibleUpgrades } from "../../game/selectors";
import { UpgradeIcon } from "../Icon";
import { QuickBuy } from "./QuickBuy";

const SEP = "\u0001";
/** ticks between re-reads of a row (phone: 0.4 s) */
export const ROW_EVERY = 4;

/**
 * Can the player pay for the upgrade's next level? The engine's isCostMet
 * works out how many levels are affordable (logarithms for every cost), which
 * is too slow for every row on every refresh; this compares the next level's
 * cost (the engine's totalCost, cached until a purchase) with the counts. If
 * the two ever disagree at the boundary, the purchase is refused by the
 * engine and nothing happens.
 */
function canBuyOne(upgrade: Upgrade): boolean {
  const max = upgrade.type.maxlevel;
  if (max != null && upgrade.count().greaterThanOrEqualTo(max)) return false;
  return upgrade.totalCost().every((c) => c.unit.count().greaterThanOrEqualTo(c.val));
}

/** The first upgrade the "Upgrade" button would buy: shown (not hidden by its notify setting) and affordable, in the unit screen's order. */
export function quickUpgrade(unit: Unit): Upgrade | undefined {
  return visibleUpgrades(unit, "upgrade").find((u) => !u.isManuallyHidden() && canBuyOne(u));
}

/**
 * The action row, or nothing for units that can't be bought (meat, larvae,
 * territory, energy...). Re-renders only when its labels change. Working out
 * what each unit can afford costs more than a card's text, so a row re-reads
 * the game every `every` ticks (a list gives its rows different `phase`s);
 * player actions are seen at once. With "advanced unit data" it also holds
 * the old quick-buy dropdown's other choices.
 */
export function CardActions({
  unit,
  every = ROW_EVERY,
  phase = 0,
  advanced = false,
  announce,
}: {
  unit: Unit;
  every?: number;
  phase?: number;
  advanced?: boolean;
  /** says what a purchase did, in the list's one status line */
  announce: (text: string) => void;
}) {
  const store = useStore();
  const fmt = useFormat();
  const snapshot = useGameValueEvery(
    () => {
      if (!isUnitBuyable(unit)) return "";
      const twin = unit.twinMult();
      const max = unit.maxCostMet();
      const up = quickUpgrade(unit);
      // (isCostMet is maxCostMet > 0)
      return [max.greaterThan(0) ? fmt.num(twin) : "", max.greaterThan(1) ? fmt.num(max.times(twin)) : "", up?.name ?? ""].join(SEP);
    },
    every,
    phase
  );
  const [pop, setPop] = useState<{ text: string; slot: number; key: number } | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!snapshot) return null;
  const [one, max, upName] = snapshot.split(SEP);
  const upgrade = upName ? store.game.upgrade(upName) : undefined;
  const plural = String(unit.unittype.plural);
  const verb = String(unit.unittype.verb ?? "buy");

  const feedback = (slot: number, text: string, status: string) => {
    setPop({ text, slot, key: Date.now() });
    announce(status);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPop(null), 900);
  };
  const buyUnit = (slot: number, how: "one" | "max") => {
    const before = unit.count();
    const err = store.act(({ commands }) =>
      how === "one" ? commands.buyUnit({ unit, num: 1, ui: "button" }) : commands.buyMaxUnit({ unit, percent: 1, ui: "button" }),
    );
    const gained = unit.count().minus(before);
    if (err || !gained.greaterThan(0)) return;
    const n = fmt.num(gained);
    feedback(slot, `+${n}`, `+${n} ${unitNoun(unit, gained)}`);
  };
  const buyUpgrade = () => {
    if (!upgrade) return;
    const label = String(upgrade.type.label);
    const err = store.act(({ commands }) => commands.buyUpgrade({ upgrade, num: 1, ui: "button" }));
    if (!err) feedback(2, "+1", `Bought ${label}`);
  };

  return (
    <div className="card-actions" data-actions={unit.name}>
      <div className="card-actions-row" role="group" aria-label={`Quick buy: ${plural}`}>
        <button type="button" className="btn btn-mini" disabled={!one} onClick={() => buyUnit(0, "one")}>
          <span className="btn-verb">{verb}</span>
          <span className="btn-amount num">
            +{one || fmt.num(unit.twinMult())}
            <span className="sr-only"> {one === "1" ? String(unit.unittype.label) : plural}</span>
          </span>
        </button>
        <button type="button" className="btn btn-mini" disabled={!max} onClick={() => buyUnit(1, "max")}>
          <span className="btn-verb">max</span>
          <span className="btn-amount num">
            {max || "–"}
            <span className="sr-only"> {plural}</span>
          </span>
        </button>
        <button
          type="button"
          className="btn btn-mini"
          disabled={!upgrade}
          onClick={buyUpgrade}
          aria-label={upgrade ? `Upgrade: buy ${upgrade.type.label}` : "Upgrade: none affordable"}
          title={upgrade ? `Buy ${upgrade.type.label}` : undefined}
          data-upgrade-target={upgrade?.name}
        >
          <span className="btn-verb">upgrade</span>
          <span className="btn-amount btn-upgrade">{upgrade ? <UpgradeIcon name={upgrade.name} size={20} /> : "–"}</span>
        </button>
        {pop && (
          <span key={pop.key} className="buy-pop num" data-slot={pop.slot} aria-hidden="true">
            {pop.text}
          </span>
        )}
      </div>
      {advanced && <QuickBuy unit={unit} />}
    </div>
  );
}
