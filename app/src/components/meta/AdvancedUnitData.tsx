// "Show advanced unit data" (old buyunit-input.html): what your maximum
// purchase costs as a share of your stock, and how fast your income could buy
// this unit. Only shown when the option is on.
import { Decimal } from "@swarmsim/engine";
import type { Unit } from "@swarmsim/engine";
import { useFormat } from "../../format";
import { useOptions } from "../../game/options";
import { joinAnd } from "../../game/selectors";
import "../../styles/meta.css";

const MAX = new Decimal(9999.99);

interface Cost {
  unit: Unit;
  val: Decimal;
}

function costAsPercent(unit: Unit, cost: Cost): Decimal {
  const count = cost.unit.count();
  if (count.lessThanOrEqualTo(0)) return MAX;
  const num = Decimal.max(1, unit.maxCostMet());
  return Decimal.min(MAX, cost.val.times(num).dividedBy(count));
}

function costAsPercentOfVelocity(unit: Unit, cost: Cost): Decimal {
  const velocity = cost.unit.velocity();
  if (velocity.lessThanOrEqualTo(0)) return MAX;
  return Decimal.min(MAX, cost.val.times(unit.maxCostMetOfVelocity()).dividedBy(velocity));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AdvancedUnitData({ unit }: { unit: Unit }) {
  const fmt = useFormat();
  const [options] = useOptions();
  if (!options.showAdvancedUnitData) return null;
  const t = unit.unittype;
  const costs = unit.eachCost() as unknown as Cost[];
  if (costs.length === 0) return null;
  const twin = unit.twinMult();
  const max = unit.maxCostMet();
  const maxTwins = max.times(twin);
  const noun = (n: Decimal) => (n.equals(1) ? t.label : t.plural) as string;
  const vu = fmt.velocityUnit({ unit: unit.name });
  const perVelocity = unit.maxCostMetOfVelocity();
  const perUnit = perVelocity.times(twin).times(vu.mult);
  let every: string | null = null;
  if (perVelocity.greaterThan(0)) {
    if (perUnit.greaterThanOrEqualTo(1)) {
      every = `You can ${t.verb} ${fmt.long(perUnit)} ${noun(perUnit)} every ${vu.label}, using`;
    } else {
      const secs = unit.maxCostMetOfVelocityReciprocal().dividedBy(twin).dividedBy(vu.mult);
      every = `You can ${t.verb} one ${t.label} every ${fmt.long(secs)} ${secs.equals(1) ? vu.label : vu.plural}, using`;
    }
  }
  return (
    <div className="advanced" aria-label="Advanced unit data" role="group">
      <p>
        {max.greaterThan(0)
          ? `${capitalize(t.verbing as string)} your maximum of ${fmt.long(maxTwins)} ${noun(maxTwins)}`
          : `${capitalize(t.verbing as string)} your next ${t.label}`}{" "}
        will cost{" "}
        <span className="num">
          {joinAnd(costs.map((c) => `${fmt.percent(costAsPercent(unit, c))} of your ${c.unit.unittype.plural}`))}
        </span>
        .
      </p>
      {every && (
        <p>
          {every}{" "}
          <span className="num">
            {joinAnd(costs.map((c) => `${fmt.percent(costAsPercentOfVelocity(unit, c))} of your ${c.unit.unittype.label} income`))}
          </span>
          .
        </p>
      )}
    </div>
  );
}
