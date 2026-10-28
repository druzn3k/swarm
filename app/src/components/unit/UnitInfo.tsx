// Ownership, production and cap lines (directive-unit.html).
import type { Decimal, Unit } from "@swarmsim/engine";
import { useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import type { Formatter } from "../../format";
import { joinAnd, unitNoun } from "../../game/selectors";
import { ProgressBar } from "../ProgressBar";

function prodList(byName: { [name: string]: Decimal }, mult: number, fmt: Formatter, nameOf: (n: string) => Unit): string {
  return joinAnd(Object.keys(byName).map((n) => `${fmt.long(byName[n].times(mult), 2)} ${unitNoun(nameOf(n), byName[n])}`));
}

function Bonus({ unit }: { unit: Unit }) {
  const fmt = useFormat();
  if (!unit.hasStat("prod", 1)) return null;
  return <span className="muted"> (×{fmt.num(unit.stat("prod"), 10)} bonus)</span>;
}

export function OwnedLine({ unit }: { unit: Unit }) {
  const fmt = useFormat();
  if (unit.capValue()) return null;
  const count = unit.count();
  const t = unit.unittype;
  if (count.isZero()) return <p>You own no {t.plural}.</p>;
  if (count.equals(1)) return <p>You own 1 {t.label}.</p>;
  return (
    <p>
      You own <span className="num">{fmt.long(count)}</span> {t.plural}.
    </p>
  );
}

export function ProductionLines({ unit }: { unit: Unit }) {
  const { game } = useStore();
  const fmt = useFormat();
  const t = unit.unittype;
  const nameOf = (n: string) => game.unit(n);
  const vuProd = fmt.velocityUnit({ prod: unit.name });
  const vuUnit = fmt.velocityUnit({ unit: unit.name });
  const capNote = unit.capValue() ? <> At 100%, you'll stop earning {t.label}.</> : null;
  const earn = (
    <>
      You earn <span className="num">{fmt.long(unit.velocity().times(vuUnit.mult), 2)}</span> {t.plural} per {vuUnit.label}.
    </>
  );
  return (
    <>
      {unit.prod.length > 0 && (
        <>
          <p>
            Each produces <span className="num">{prodList(unit.eachProduction(), vuProd.mult, fmt, nameOf)}</span> per {vuProd.label}.
            <Bonus unit={unit} />
          </p>
          {unit.count().greaterThan(0) && (
            <p>
              In total, they produce <span className="num">{prodList(unit.totalProduction(), vuProd.mult, fmt, nameOf)}</span> per{" "}
              {vuProd.label}.
            </p>
          )}
        </>
      )}
      {unit.showparent && unit.showparent.prod.length > 0 && (
        <p>
          {earn}
          <Bonus unit={unit.showparent} />
          {capNote}
        </p>
      )}
      {!unit.showparent && unit.velocity().greaterThan(0) && (
        <p>
          {earn}
          {capNote}
        </p>
      )}
    </>
  );
}

/** For capped units (energy): how full, and how long until full. */
export function CapInfo({ unit }: { unit: Unit }) {
  const fmt = useFormat();
  const cap = unit.capValue();
  if (!cap) return null;
  const pct = unit.capPercent()!;
  let secs: number | undefined;
  try {
    secs = unit.capDurationSeconds();
  } catch {
    secs = undefined;
  }
  const percent = fmt.percent(pct, { floor: true });
  const left = fmt.duration(secs);
  return (
    <div className="section card" aria-label="Capacity">
      <h2>Capacity</h2>
      <ProgressBar value={pct.toNumber()} ready={pct.greaterThanOrEqualTo(1)} label={`${unit.unittype.label} capacity`} />
      <p className="bar-label">
        <span className="num">{percent} full</span>
        <span className="num">{left ? `full in ${left}` : ""}</span>
      </p>
      <p className="num">
        {fmt.long(unit.count(), 0)} / {fmt.long(cap, 0)} {unit.unittype.label}
      </p>
    </div>
  );
}
