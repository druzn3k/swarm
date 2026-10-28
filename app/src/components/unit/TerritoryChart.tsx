// The territory screen's production chart (old ChartCtrl in
// views/desc/unit/territory.html): each military unit's share of territory
// captured, as pixel bars instead of a pie. Slices under 1% are grouped as
// "Other", like the old chart. Show/hide is the old `showCharts` option.
import type { Decimal, Unit } from "@swarmsim/engine";
import { useGame } from "../../game/GameContext";
import { useFormat } from "../../format";
import { useOptions } from "../../game/options";
import { tabByName, unitLabel } from "../../game/selectors";

const THRESHOLD = 0.01;

export function TerritoryChart() {
  const { game } = useGame();
  const fmt = useFormat();
  const [{ showCharts }, setOption] = useOptions();
  const total = game.unit("territory").velocity();
  if (total.isZero()) return null;

  const rows: { label: string; share: number }[] = [];
  let other = 0;
  const units = [...((tabByName(game, "territory")?.sortedUnits ?? []) as Unit[])].reverse();
  for (const unit of units) {
    if (!unit.isVisible() || unit.name === "territory") continue;
    const prod = unit.totalProduction().territory as Decimal | undefined;
    const share = prod ? prod.dividedBy(total).toNumber() : 0;
    if (share < THRESHOLD) other += share;
    else rows.push({ label: unitLabel(unit, true), share });
  }
  if (other >= 0.0005) rows.push({ label: "Other", share: other });

  return (
    <section className="section card chart" aria-labelledby="chart-title">
      <div className="chart-head">
        <h2 id="chart-title">Production rates</h2>
        <button type="button" className="btn btn-quiet btn-small" aria-expanded={showCharts} onClick={() => setOption("showCharts", !showCharts)}>
          {showCharts ? "Hide chart" : "Show chart"}
        </button>
      </div>
      {showCharts && (
        <ul className="chart-rows">
          {rows.map((r) => (
            <li key={r.label}>
              <span className="chart-label">{r.label}</span>
              <span className="chart-bar" aria-hidden="true">
                <span className="chart-fill" style={{ width: `${Math.max(1, Math.round(r.share * 100))}%` }} />
              </span>
              <span className="chart-value num">{fmt.percent(r.share, { places: 1 })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
