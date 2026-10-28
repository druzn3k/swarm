// Buying a unit: first-buy warnings, the typed amount with its live cost
// preview (buyunit-input.html), and the 1 / 25% / max buttons (buyunit.html).
import { useId, useState } from "react";
import { Decimal } from "@swarmsim/engine";
import type { Unit } from "@swarmsim/engine";
import { useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import { unitNoun } from "../../game/selectors";
import { CostList } from "../CostList";

const ONE = new Decimal(1);

function WarnFirst({ unit }: { unit: Unit }) {
  const [dismissed, setDismissed] = useState<number[]>([]);
  if (!unit.count().isZero() || !unit.isCostMet()) return null;
  return (
    <>
      {unit.warnfirst.map((warn, i) =>
        dismissed.includes(i) ? null : (
          <div className="alert" role="alert" key={i}>
            <p>{warn.text}</p>
            <button type="button" className="icon-btn" aria-label="Dismiss warning" onClick={() => setDismissed([...dismissed, i])}>
              ✕
            </button>
          </div>
        )
      )}
    </>
  );
}

function BuyHelp({ id, hidden }: { id: string; hidden: boolean }) {
  return (
    <div className="help" id={id} hidden={hidden}>
      <p>
        <code>10%</code> buys 10% of the maximum you can afford.
      </p>
      <p>
        <code>=1000</code> buys exactly 1,000 after accounting for twins, rounded up.
      </p>
      <p>
        <code>@1000</code> buys the number needed to have a total of 1,000. If you already have 200, this will buy up to 800.
      </p>
      <p>
        Numbers with suffixes work: <code>23 billion</code>, <code>23b</code>, or <code>23e9</code>.
      </p>
    </div>
  );
}

/** A buy button with the verb small on top and the amount below; disabled without onClick. */
export function StackButton({ verb, amount, onClick }: { verb: string; amount: string; onClick?: () => void }) {
  return (
    <button type="button" className="btn btn-stack" disabled={!onClick} onClick={onClick}>
      <span className="btn-verb">{verb}</span> <span className="btn-amount num">{amount}</span>
    </button>
  );
}

/** The 1 / 25% / max buttons. `num` is the typed amount (before twins). */
function BuyButtons({ unit, num }: { unit: Unit; num: Decimal }) {
  const store = useStore();
  const fmt = useFormat();
  const verb = (unit.unittype.verb as string) ?? "buy";
  const twin = unit.twinMult();
  const max = unit.maxCostMet();
  const quarter = unit.maxCostMet(0.25);
  let full = Decimal.max(1, Decimal.min(max, num.floor()));
  if (full.isNaN()) full = ONE;
  const is25 = max.greaterThan(quarter) && quarter.greaterThan(1);
  const buy = (n: Decimal) => store.act(({ commands }) => commands.buyUnit({ unit, num: n, ui: "button" }));
  const buyMax = (percent: number) => store.act(({ commands }) => commands.buyMaxUnit({ unit, percent, ui: "button" }));
  return (
    <div className="btn-row">
      {unit.isCostMet() ? (
        <StackButton verb={verb} amount={fmt.num(full.times(twin))} onClick={() => buy(full)} />
      ) : (
        <StackButton verb="can't" amount={verb} />
      )}
      <StackButton verb={verb} amount={is25 ? fmt.num(quarter.times(twin)) : "25%"} onClick={is25 ? () => buyMax(0.25) : undefined} />
      <StackButton verb={verb} amount={max.greaterThan(1) ? fmt.num(max.times(twin)) : "max"} onClick={max.greaterThan(1) ? () => buyMax(1) : undefined} />
    </div>
  );
}

export function BuyUnit({ unit, initial = "" }: { unit: Unit; initial?: string }) {
  const store = useStore();
  const fmt = useFormat();
  const [text, setText] = useState(initial);
  const [help, setHelp] = useState(false);
  const inputId = useId();
  const helpId = useId();
  const t = unit.unittype;
  const num = store.engine.parseNumber(text || "1", unit) ?? ONE;
  const twin = unit.twinMult();
  return (
    <div className="section card">
      <h2>{t.verb ?? "buy"}</h2>
      <WarnFirst unit={unit} />
      <form
        className="buy-form"
        onSubmit={(e) => {
          e.preventDefault();
          store.act(({ commands }) => commands.buyUnit({ unit, num, ui: "input" }));
        }}
      >
        <div className="buy-line">
          <label htmlFor={inputId}>{t.verbing}</label>
          <input
            id={inputId}
            className="buy-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={help ? helpId : undefined}
          />
          <button type="button" className="icon-btn" aria-expanded={help} aria-controls={helpId} aria-label="How to type amounts" onClick={() => setHelp(!help)}>
            ?
          </button>
        </div>
        <p aria-live="polite">
          <span className="num">{fmt.num(num)}</span> {unitNoun(unit, num)}
          {twin.greaterThan(1) && <span className="muted"> (×{fmt.num(twin)} twins)</span>} will cost <CostList costs={unit.eachCost()} num={num} />
        </p>
        <BuyHelp id={helpId} hidden={!help} />
        {/* PHASE B (B2): advanced unit data (cost as % of stock and income) when enabled in options */}
      </form>
      <BuyButtons unit={unit} num={num} />
    </div>
  );
}
