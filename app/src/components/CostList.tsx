// "10 meat and 1 larva." — a cost list like the old <cost> directive: costs you
// can't afford are marked, and links take you to buy what's missing.
import type { Decimal, Unit } from "@swarmsim/engine";
import { useFormat } from "../format";
import { unitNoun } from "../game/selectors";

export interface CostLike {
  unit: Unit;
  val: Decimal;
}

function isRemainingBuyable(cost: CostLike, total: Decimal): boolean {
  const remaining = total.minus(cost.unit.count()).ceil();
  const buyable = cost.unit.isBuyable(true) && cost.unit.isBuyButtonVisible();
  return remaining.greaterThan(0) && (buyable || cost.unit.name === "energy");
}

export function CostList({ costs, num, period = true }: { costs: CostLike[]; num?: Decimal; period?: boolean }) {
  const fmt = useFormat();
  return (
    <>
      {costs.map((cost, i) => {
        const total = num ? cost.val.times(num.toString()) : cost.val;
        const text = `${fmt.num(total)} ${unitNoun(cost.unit, total)}`;
        const met = cost.unit.count().greaterThanOrEqualTo(total);
        const sep = i === 0 ? "" : i === costs.length - 1 ? " and " : ", ";
        // energy is bought as crystals
        const target = cost.unit.name === "energy" ? "crystal" : cost.unit.name;
        return (
          <span key={cost.unit.name}>
            {sep}
            {isRemainingBuyable(cost, total) ? (
              <a className={met ? undefined : "cost-not-met"} href={`#/unit/${target}?num=${encodeURIComponent("@" + total.ceil().toString())}`}>
                {text}
              </a>
            ) : (
              <span className={met ? undefined : "cost-not-met"}>{text}</span>
            )}
          </span>
        );
      })}
      {period && "."}
    </>
  );
}
