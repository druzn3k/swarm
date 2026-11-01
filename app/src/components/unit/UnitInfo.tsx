// Ownership, production and cap lines (directive-unit.html). The unit screen
// focuses its unit, so production and stats are in the view.
import { Dec } from "@swarmsim/engine-wasm";
import type { NumString } from "@swarmsim/engine-wasm";
import { useNeeds, useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import type { Formatter } from "../../format";
import { joinAnd, unitNoun } from "../../game/selectors";
import type { UnitRef } from "../../game/view";
import { estimateSecs } from "../../game/view";
import { ProgressBar } from "../ProgressBar";

function prodList(byName: Record<string, NumString>, mult: number, fmt: Formatter, nameOf: (n: string) => UnitRef): string {
  return joinAnd(Object.keys(byName).map((n) => `${fmt.long(Dec.from(byName[n]).times(mult), 2)} ${unitNoun(nameOf(n), byName[n])}`));
}

function Bonus({ unit }: { unit: UnitRef }) {
  const fmt = useFormat();
  // the bonus is one of the unit's stats: a detail
  useNeeds({ focus: [unit.name] });
  const prod = unit.stat("prod");
  // (the old hasStat("prod", 1): whether the stat is set at all)
  if (prod === undefined) return null;
  return <span className="muted"> (×{fmt.num(prod, 10)} bonus)</span>;
}

export function OwnedLine({ unit }: { unit: UnitRef }) {
  const fmt = useFormat();
  if (unit.cap) return null;
  const count = Dec.from(unit.count);
  if (count.isZero()) return <p>You own no {unit.plural}.</p>;
  if (count.eq(1)) return <p>You own 1 {unit.label}.</p>;
  return (
    <p>
      You own <span className="num">{fmt.long(count)}</span> {unit.plural}.
    </p>
  );
}

export function ProductionLines({ unit }: { unit: UnitRef }) {
  const { g } = useStore();
  const fmt = useFormat();
  const nameOf = (n: string) => g.unit(n);
  const vuProd = fmt.velocityUnit({ prod: unit.name });
  const vuUnit = fmt.velocityUnit({ unit: unit.name });
  const capNote = unit.cap ? <> At 100%, you'll stop earning {unit.label}.</> : null;
  const earn = (
    <>
      You earn <span className="num">{fmt.long(Dec.from(unit.velocity).times(vuUnit.mult), 2)}</span> {unit.plural} per {vuUnit.label}.
    </>
  );
  const parent = unit.showparent;
  return (
    <>
      {unit.hasProd && (
        <>
          <p>
            Each produces <span className="num">{prodList(unit.eachProduction, vuProd.mult, fmt, nameOf)}</span> per {vuProd.label}.
            <Bonus unit={unit} />
          </p>
          {Dec.from(unit.count).gt(0) && (
            <p>
              In total, they produce <span className="num">{prodList(unit.totalProduction, vuProd.mult, fmt, nameOf)}</span> per{" "}
              {vuProd.label}.
            </p>
          )}
        </>
      )}
      {parent && parent.hasProd && (
        <p>
          {earn}
          <Bonus unit={parent} />
          {capNote}
        </p>
      )}
      {!parent && Dec.from(unit.velocity).gt(0) && (
        <p>
          {earn}
          {capNote}
        </p>
      )}
    </>
  );
}

/** For capped units (energy): how full, and how long until full. */
export function CapInfo({ unit }: { unit: UnitRef }) {
  const fmt = useFormat();
  const cap = unit.cap;
  if (!cap) return null;
  const pct = Dec.from(unit.capPercent ?? "0");
  const percent = fmt.percent(pct, { floor: true });
  const left = fmt.duration(estimateSecs(unit.capEta));
  return (
    <div className="section card" aria-label="Capacity">
      <h2>Capacity</h2>
      <ProgressBar value={pct.toNumber()} ready={pct.gte(1)} label={`${unit.label} capacity`} />
      <p className="bar-label">
        <span className="num">{percent} full</span>
        <span className="num">{left ? `full in ${left}` : ""}</span>
      </p>
      <p className="num">
        {fmt.long(unit.count, 0)} / {fmt.long(cap, 0)} {unit.label}
      </p>
    </div>
  );
}
