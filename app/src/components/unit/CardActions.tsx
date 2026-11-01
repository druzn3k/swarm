// Buying from the unit list: a compact row under each buyable unit's card
// with "+1" (one purchase, times twins, like the unit screen's buy 1), "Max N"
// (all you can afford) and "Upgrade" (one level of the first affordable,
// shown upgrade, in the unit screen's order). Same commands as the unit
// screen, so statistics, achievements, undo and the hive's burst behave the
// same. The card head above stays the link to the unit screen.
import { useEffect, useRef, useState } from "react";
import { Dec } from "@swarmsim/engine-wasm";
import { useGameValueEvery, useStore } from "../../game/GameContext";
import type { UnitRef, UpgradeRef } from "../../game/view";
import { useFormat } from "../../format";
import { isUnitBuyable, unitNoun } from "../../game/selectors";
import { UpgradeIcon } from "../Icon";
import { QuickBuy } from "./QuickBuy";

const SEP = "\u0001";
/** ticks between re-reads of a row (phone: 0.4 s) */
export const ROW_EVERY = 4;

/** The first upgrade the "Upgrade" button would buy: shown (not hidden by its notify setting) and affordable, in the unit screen's order. */
export function quickUpgrade(unit: UnitRef): UpgradeRef | undefined {
  return unit.upgrades("upgrade").find((u) => !u.manuallyHidden && u.canBuyOne());
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
  /** the unit's name */
  unit: string;
  every?: number;
  phase?: number;
  advanced?: boolean;
  /** says what a purchase did, in the list's one status line */
  announce: (text: string) => void;
}) {
  const store = useStore();
  const fmt = useFormat();
  const snapshot = useGameValueEvery(
    (s) => {
      const u = s.g.unit(unit);
      if (!isUnitBuyable(u)) return "";
      const twin = u.twinMult;
      const max = Dec.from(u.maxCostMet);
      const up = quickUpgrade(u);
      // (isCostMet is maxCostMet > 0)
      return [max.gt(0) ? fmt.num(twin) : "", max.gt(1) ? fmt.num(max.times(twin)) : "", up?.name ?? "", fmt.num(twin)].join(SEP);
    },
    every,
    phase
  );
  const [pop, setPop] = useState<{ text: string; slot: number; key: number } | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!snapshot) return null;
  const [one, max, upName, twin] = snapshot.split(SEP);
  const u = store.g.unit(unit);
  const upgrade = upName ? store.g.upgrade(upName) : undefined;
  const plural = u.plural;
  const verb = u.verb;

  const feedback = (slot: number, text: string, status: string) => {
    setPop({ text, slot, key: Date.now() });
    announce(status);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPop(null), 900);
  };
  const buyUnit = (slot: number, how: "one" | "max") => {
    const { error, outcome } = store.act(
      how === "one"
        ? { do: "buy_unit", unit, amount: { num: "1" }, ui: "button" }
        : { do: "buy_max_unit", unit, percent: 1, ui: "button" }
    );
    const gained = Dec.from(outcome?.bought?.twinnum ?? "0");
    if (error || !gained.gt(0)) return;
    const n = fmt.num(gained);
    feedback(slot, `+${n}`, `+${n} ${unitNoun(store.g.unit(unit), gained)}`);
  };
  const buyUpgrade = () => {
    if (!upgrade) return;
    const label = upgrade.label;
    const { error } = store.act({ do: "buy_upgrade", upgrade: upgrade.name, amount: { num: "1" }, ui: "button" });
    if (!error) feedback(2, "+1", `Bought ${label}`);
  };

  return (
    <div className="card-actions" data-actions={unit}>
      <div className="card-actions-row" role="group" aria-label={`Quick buy: ${plural}`}>
        <button type="button" className="btn btn-mini" disabled={!one} onClick={() => buyUnit(0, "one")}>
          <span className="btn-verb">{verb}</span>{" "}
          <span className="btn-amount num">
            +{one || twin}
            <span className="sr-only"> {one === "1" ? u.label : plural}</span>
          </span>
        </button>
        <button type="button" className="btn btn-mini" disabled={!max} onClick={() => buyUnit(1, "max")}>
          <span className="btn-verb">max</span>{" "}
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
          aria-label={upgrade ? `Upgrade: buy ${upgrade.label}` : "Upgrade: none affordable"}
          title={upgrade ? `Buy ${upgrade.label}` : undefined}
          data-upgrade-target={upgrade?.name}
        >
          <span className="btn-verb">upgrade</span>{" "}
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
