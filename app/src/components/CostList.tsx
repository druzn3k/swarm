// "10 meat and 1 larva." — a cost list like the old <cost> directive: costs you
// can't afford are marked, and links take you to buy what's missing.
import { Dec } from "@swarmsim/engine-wasm";
import type { NumString } from "@swarmsim/engine-wasm";
import { useFormat } from "../format";
import { unitNoun } from "../game/selectors";
import type { Amount } from "../game/view";

export type CostLike = Amount;

function isRemainingBuyable(cost: CostLike, total: Dec): boolean {
  const remaining = total.minus(cost.unit.count).ceil();
  const buyable = cost.unit.buyButtonVisible && !cost.unit.st.unbuyable;
  return remaining.gt(0) && (buyable || cost.unit.name === "energy");
}

export function CostList({ costs, num, period = true }: { costs: CostLike[]; num?: NumString | Dec; period?: boolean }) {
  const fmt = useFormat();
  return (
    <>
      {costs.map((cost, i) => {
        const total = num !== undefined ? Dec.from(cost.val).times(num) : Dec.from(cost.val);
        const text = `${fmt.num(total)} ${unitNoun(cost.unit, total)}`;
        const met = Dec.from(cost.unit.count).gte(total);
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
