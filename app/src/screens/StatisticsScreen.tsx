// The statistics screen (old views/statistics.html): what you bought and
// when, per unit and upgrade, and totals for the whole game.
import type { Unit, Upgrade } from "@swarmsim/engine";
import { memo } from "react";
import { useGameValue, useGameValueEvery, useStore } from "../game/GameContext";
import { useFormat } from "../format";
import type { Formatter } from "../format";
import { dateTime, fromNow, utcdoy } from "../components/meta/time";
import "../styles/meta.css";

interface UnitStats {
  clicks: number;
  num: unknown;
  twinnum?: unknown;
  elapsedFirst: number;
}

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
// counter): the engine updates the statistics objects in place, after a
// purchase, so their identity says nothing.
const UnitRow = memo(function UnitRow({ unit, stats, fmt }: { unit: Unit; stats?: UnitStats; fmt: Formatter; actions: number }) {
  return (
    <li className="stat-row">
      <h3>{unit.unittype.label}</h3>
      {stats ? (
        <dl className="stat-grid">
          <Stat label="First bought" value={utcdoy(stats.elapsedFirst)} />
          <Stat label="Clicks" value={fmt.num(stats.clicks)} />
          <Stat label="Bought manually" value={fmt.num(stats.num as number)} />
          <Stat label="Twins" value={fmt.num(stats.twinnum as number)} />
        </dl>
      ) : (
        <p className="muted">Never bought: produced by other units.</p>
      )}
    </li>
  );
});

const UpgradeRow = memo(function UpgradeRow({ upgrade, stats }: { upgrade: Upgrade; stats: UnitStats; actions: number }) {
  return (
    <li className="stat-row">
      <h3>{upgrade.type.label}</h3>
      <dl className="stat-grid">
        <Stat label="First bought" value={utcdoy(stats.elapsedFirst)} />
        <Stat label="Clicks" value={stats.clicks.toLocaleString("en-US")} />
        <Stat label="Total bought" value={Number(stats.num).toLocaleString("en-US")} />
      </dl>
    </li>
  );
});

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
  const fmt = useFormat();
  const { game, engine } = store;
  const statistics = (engine.session.state.statistics ?? {}) as {
    byUnit?: Record<string, UnitStats>;
    byUpgrade?: Record<string, UnitStats>;
    clicks?: number;
  };
  const byUnit = statistics.byUnit ?? {};
  const byUpgrade = statistics.byUpgrade ?? {};
  const actions = useGameValue((s) => s.actions);
  const lists = useGameValueEvery(({ game, engine }) => {
    const statistics = (engine.session.state.statistics ?? {}) as { byUnit?: Record<string, UnitStats>; byUpgrade?: Record<string, UnitStats> };
    const byUnit = statistics.byUnit ?? {};
    const byUpgrade = statistics.byUpgrade ?? {};
    const has = (dict: Record<string, UnitStats>, name: string) => Object.prototype.hasOwnProperty.call(dict, name);
    // like the old screen: units you bought, plus visible units you can't buy (meat, larvae, ...)
    const units = game.unitlist().filter((u) => has(byUnit, u.name) || (!u.isBuyable() && u.isVisible()));
    const upgrades = game.upgradelist().filter((u) => has(byUpgrade, u.name));
    return units.map((u) => u.name).join(",") + "|" + upgrades.map((u) => u.name).join(",");
  }, EVERY);
  const [unitNames, upgradeNames] = lists.split("|");
  const units = unitNames ? unitNames.split(",").map((n) => game.unit(n)) : [];
  const upgrades = upgradeNames ? upgradeNames.split(",").map((n) => game.upgrade(n)) : [];

  const totalsJson = useGameValueEvery(({ game, engine }) => {
    const statistics = (engine.session.state.statistics ?? {}) as { clicks?: number };
    const started = game.dateStarted();
    const now = game.now;
    const ascended = !game.unit("ascension").count().isZero();
    const restarted = engine.session.state.date.restarted;
    const totals: Totals = {
      played: fmt.duration(game.elapsedStartMillis() / 1000) || "just started",
      skipped: fmt.duration(game.totalSkippedMillis() / 1000) || "none",
      clicks: fmt.num(statistics.clicks ?? 0),
      points: fmt.num(game.achievementPoints()),
      ascensions: fmt.num(game.unit("ascension").count()),
      saveSize: `${engine.session.exportSave().length.toLocaleString("en-US")} chars`,
      started: fromNow(started, now),
      startedAt: dateTime(started),
      ascendedAgo: ascended && restarted ? fromNow(restarted, now) : "",
      ascendedAt: ascended && restarted ? dateTime(restarted) : "",
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
              <UnitRow key={u.name} unit={u} stats={byUnit[u.name]} fmt={fmt} actions={actions} />
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
              <UpgradeRow key={u.name} upgrade={u} stats={byUpgrade[u.name]} actions={actions} />
            ))}
          </ul>
        )}
      </section>
      <p className="muted small">"First bought" is the game time since you started, when you first bought it.</p>
    </section>
  );
}
