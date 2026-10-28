// The statistics screen (old views/statistics.html): what you bought and
// when, per unit and upgrade, and totals for the whole game.
import type { Unit, Upgrade } from "@swarmsim/engine";
import { useGame } from "../game/GameContext";
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

function UnitRow({ unit, stats, fmt }: { unit: Unit; stats?: UnitStats; fmt: Formatter }) {
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
}

function UpgradeRow({ upgrade, stats }: { upgrade: Upgrade; stats: UnitStats }) {
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
}

export function StatisticsScreen() {
  const store = useGame();
  const fmt = useFormat();
  const { game, engine } = store;
  const statistics = (engine.session.state.statistics ?? {}) as {
    byUnit?: Record<string, UnitStats>;
    byUpgrade?: Record<string, UnitStats>;
    clicks?: number;
  };
  const byUnit = statistics.byUnit ?? {};
  const byUpgrade = statistics.byUpgrade ?? {};
  const has = (dict: Record<string, UnitStats>, name: string) => Object.prototype.hasOwnProperty.call(dict, name);
  // like the old screen: units you bought, plus visible units you can't buy (meat, larvae, ...)
  const units = game.unitlist().filter((u) => has(byUnit, u.name) || (!u.isBuyable() && u.isVisible()));
  const upgrades = game.upgradelist().filter((u) => has(byUpgrade, u.name));

  const started = game.dateStarted();
  const now = game.now;
  const playedSecs = game.elapsedStartMillis() / 1000;
  const skippedSecs = game.totalSkippedMillis() / 1000;
  const ascended = !game.unit("ascension").count().isZero();
  const restarted = engine.session.state.date.restarted;

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Statistics</h1>

      <section className="section card" aria-labelledby="stats-totals">
        <h2 id="stats-totals">Totals</h2>
        <dl className="stat-grid">
          <Stat label="Time played" value={fmt.duration(playedSecs) || "just started"} />
          <Stat label="Time skipped" value={fmt.duration(skippedSecs) || "none"} />
          <Stat label="Clicks" value={fmt.num(statistics.clicks ?? 0)} />
          <Stat label="Achievement points" value={fmt.num(game.achievementPoints())} />
          <Stat label="Ascensions" value={fmt.num(game.unit("ascension").count())} />
          <Stat label="Save size" value={`${engine.session.exportSave().length.toLocaleString("en-US")} chars`} />
        </dl>
        <p>
          Started {fromNow(started, now)} <span className="muted">({dateTime(started)})</span>
        </p>
        <p>
          Last ascended:{" "}
          {ascended && restarted ? (
            <>
              {fromNow(restarted, now)} <span className="muted">({dateTime(restarted)})</span>
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
              <UnitRow key={u.name} unit={u} stats={byUnit[u.name]} fmt={fmt} />
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
              <UpgradeRow key={u.name} upgrade={u} stats={byUpgrade[u.name]} />
            ))}
          </ul>
        )}
      </section>
      <p className="muted small">"First bought" is the game time since you started, when you first bought it.</p>
    </section>
  );
}
