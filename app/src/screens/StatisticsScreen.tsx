// The statistics screen (old views/statistics.html): what you bought and
// when, per unit and upgrade, and totals for the whole game.
import { memo } from "react";
import type { ItemStatistics } from "@swarmsim/engine-wasm";
import { useGameValue, useGameValueEvery, useNeeds, useStore } from "../game/GameContext";
import type { UnitRef, UpgradeRef } from "../game/view";
import { useFormat } from "../format";
import type { Formatter } from "../format";
import { dateTime, fromNow, utcdoy } from "../components/meta/time";
import "../styles/meta.css";

type UnitStats = ItemStatistics;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

/** ticks between re-reads of the totals and the lists (~1/s; player actions at once) */
const EVERY = 10;

// Rows re-render after player actions only (`actions`, the store's action
// counter): every view brings new objects, so their identity says nothing.
const sameRow = (a: { actions: number; fmt?: Formatter; unit?: UnitRef; upgrade?: UpgradeRef }, b: typeof a) =>
  a.actions === b.actions && a.fmt === b.fmt && a.unit?.id === b.unit?.id && a.upgrade?.id === b.upgrade?.id;
const UnitRow = memo(function UnitRow({ unit, stats, fmt }: { unit: UnitRef; stats?: UnitStats; fmt: Formatter; actions: number }) {
  return (
    <li className="stat-row">
      <h3>{unit.label}</h3>
      {stats ? (
        <dl className="stat-grid">
          <Stat label="First bought" value={utcdoy(stats.elapsed_first)} />
          <Stat label="Clicks" value={fmt.num(stats.clicks)} />
          <Stat label="Bought manually" value={fmt.num(stats.num)} />
          <Stat label="Twins" value={fmt.num(stats.twinnum)} />
        </dl>
      ) : (
        <p className="muted">Never bought: produced by other units.</p>
      )}
    </li>
  );
}, sameRow);

const UpgradeRow = memo(function UpgradeRow({ upgrade, stats }: { upgrade: UpgradeRef; stats: UnitStats; actions: number }) {
  return (
    <li className="stat-row">
      <h3>{upgrade.label}</h3>
      <dl className="stat-grid">
        <Stat label="First bought" value={utcdoy(stats.elapsed_first)} />
        <Stat label="Clicks" value={stats.clicks.toLocaleString("en-US")} />
        <Stat label="Total bought" value={Number(stats.num).toLocaleString("en-US")} />
      </dl>
    </li>
  );
}, sameRow);

interface Totals {
  played: string;
  skipped: string;
  clicks: string;
  points: string;
  ascensions: string;
  saveSize: string;
  started: string;
  startedAt: string;
  ascendedAgo: string;
  ascendedAt: string;
}

/**
 * Re-renders about once a second (time played, save size...) and after
 * player actions; the rows only after player actions.
 */
export function StatisticsScreen() {
  const store = useStore();
  useNeeds({ sections: ["statistics"] });
  const fmt = useFormat();
  const { g } = store;
  const statistics = g.v.statistics;
  const byUnit = new Map((statistics?.units ?? []).map((s) => [s.id, s]));
  const byUpgrade = new Map((statistics?.upgrades ?? []).map((s) => [s.id, s]));
  const actions = useGameValue((s) => s.actions);
  const lists = useGameValueEvery(({ g }) => {
    const statistics = g.v.statistics;
    const bought = new Set((statistics?.units ?? []).map((s) => s.id));
    // like the old screen: units you bought, plus visible units you can't buy (meat, larvae, ...)
    const units = g.units().filter((u) => bought.has(u.id) || (!u.buyable && u.visible));
    const upgrades = (statistics?.upgrades ?? []).map((s) => s.id);
    return units.map((u) => u.id).join(",") + "|" + upgrades.join(",");
  }, EVERY);
  const [unitIds, upgradeIds] = lists.split("|");
  const units = unitIds ? unitIds.split(",").map((i) => g.unit(+i)) : [];
  const upgrades = upgradeIds ? upgradeIds.split(",").map((i) => g.upgrade(+i)) : [];

  const totalsJson = useGameValueEvery((s) => {
    const { g } = s;
    const started = new Date(g.startedMs);
    const now = new Date(g.nowMs);
    const ascended = g.unit("ascension").count !== "0";
    const restarted = g.v.restarted_ms;
    const totals: Totals = {
      played: fmt.duration(g.v.elapsed_ms / 1000) || "just started",
      skipped: fmt.duration(g.v.total_skipped_ms / 1000) || "none",
      clicks: fmt.num(g.v.statistics?.clicks ?? 0),
      points: fmt.num(g.v.achievements?.points ?? 0),
      ascensions: fmt.num(g.unit("ascension").count),
      saveSize: `${s.exportSave().length.toLocaleString("en-US")} chars`,
      started: fromNow(started, now),
      startedAt: dateTime(started),
      ascendedAgo: ascended && restarted ? fromNow(new Date(restarted), now) : "",
      ascendedAt: ascended && restarted ? dateTime(new Date(restarted)) : "",
    };
    return JSON.stringify(totals);
  }, EVERY);
  const totals = JSON.parse(totalsJson) as Totals;

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Statistics</h1>

      <section className="section card" aria-labelledby="stats-totals">
        <h2 id="stats-totals">Totals</h2>
        <dl className="stat-grid">
          <Stat label="Time played" value={totals.played} />
          <Stat label="Time skipped" value={totals.skipped} />
          <Stat label="Clicks" value={totals.clicks} />
          <Stat label="Achievement points" value={totals.points} />
          <Stat label="Ascensions" value={totals.ascensions} />
          <Stat label="Save size" value={totals.saveSize} />
        </dl>
        <p>
          Started {totals.started} <span className="muted">({totals.startedAt})</span>
        </p>
        <p>
          Last ascended:{" "}
          {totals.ascendedAgo ? (
            <>
              {totals.ascendedAgo} <span className="muted">({totals.ascendedAt})</span>
            </>
          ) : (
            "never"
          )}
        </p>
      </section>

      <section className="section card" aria-labelledby="stats-units">
        <h2 id="stats-units">Units</h2>
        {units.length === 0 ? (
          <p className="muted">No units purchased.</p>
        ) : (
          <ul className="stat-list">
            {units.map((u) => (
              <UnitRow key={u.name} unit={u} stats={byUnit.get(u.id)} fmt={fmt} actions={actions} />
            ))}
          </ul>
        )}
      </section>

      <section className="section card" aria-labelledby="stats-upgrades">
        <h2 id="stats-upgrades">Upgrades</h2>
        {upgrades.length === 0 ? (
          <p className="muted">No upgrades purchased.</p>
        ) : (
          <ul className="stat-list">
            {upgrades.map((u) => (
              <UpgradeRow key={u.name} upgrade={u} stats={byUpgrade.get(u.id)!} actions={actions} />
            ))}
          </ul>
        )}
      </section>
      <p className="muted small">"First bought" is the game time since you started, when you first bought it.</p>
    </section>
  );
}
