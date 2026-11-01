// "Show advanced unit data" (old buyunit-input.html): what your maximum
// purchase costs as a share of your stock, and how fast your income could buy
// this unit. Only shown when the option is on.
import { Dec } from "@swarmsim/engine-wasm";
import { useFormat } from "../../format";
import { useOptions } from "../../game/options";
import { joinAnd } from "../../game/selectors";
import type { Amount, UnitRef } from "../../game/view";
import "../../styles/meta.css";

const MAX = Dec.from(9999.99);

function costAsPercent(unit: UnitRef, cost: Amount): Dec {
  const count = Dec.from(cost.unit.count);
  if (count.lte(0)) return MAX;
  const num = Dec.max(1, unit.maxCostMet);
  return Dec.min(MAX, Dec.from(cost.val).times(num).div(count));
}

function costAsPercentOfVelocity(unit: UnitRef, cost: Amount): Dec {
  const velocity = Dec.from(cost.unit.velocity);
  if (velocity.lte(0)) return MAX;
  return Dec.min(MAX, Dec.from(cost.val).times(unit.maxCostMetOfVelocity ?? "0").div(velocity));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Needs the unit focused (its income detail): BuyUnit asks for it. */
export function AdvancedUnitData({ unit }: { unit: UnitRef }) {
  const fmt = useFormat();
  const [options] = useOptions();
  if (!options.showAdvancedUnitData) return null;
  const t = unit.st;
  const costs = unit.eachCost;
  if (costs.length === 0) return null;
  const twin = unit.twinMult;
  const max = Dec.from(unit.maxCostMet);
  const maxTwins = max.times(twin);
  const noun = (n: Dec) => (n.eq(1) ? unit.label : unit.plural);
  const vu = fmt.velocityUnit({ unit: unit.name });
  const perVelocity = Dec.from(unit.maxCostMetOfVelocity ?? "0");
  const perUnit = perVelocity.times(twin).times(vu.mult);
  let every: string | null = null;
  if (perVelocity.gt(0)) {
    if (perUnit.gte(1)) {
      every = `You can ${unit.verb} ${fmt.long(perUnit)} ${noun(perUnit)} every ${vu.label}, using`;
    } else {
      const secs = Dec.ONE.div(perVelocity).div(twin).div(vu.mult);
      every = `You can ${unit.verb} one ${unit.label} every ${fmt.long(secs)} ${secs.eq(1) ? vu.label : vu.plural}, using`;
    }
  }
  return (
    <div className="advanced" aria-label="Advanced unit data" role="group">
      <p>
        {max.gt(0)
          ? `${capitalize(t.verbing ?? "")} your maximum of ${fmt.long(maxTwins)} ${noun(maxTwins)}`
          : `${capitalize(t.verbing ?? "")} your next ${unit.label}`}{" "}
        will cost{" "}
        <span className="num">
          {joinAnd(costs.map((c) => `${fmt.percent(costAsPercent(unit, c))} of your ${c.unit.plural}`))}
        </span>
        .
      </p>
      {every && (
        <p>
          {every}{" "}
          <span className="num">
            {joinAnd(costs.map((c) => `${fmt.percent(costAsPercentOfVelocity(unit, c))} of your ${c.unit.label} income`))}
          </span>
          .
        </p>
      )}
    </div>
  );
}
