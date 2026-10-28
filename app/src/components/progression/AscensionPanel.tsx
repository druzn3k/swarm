// Mutagen: ascension, respec and free respec (views/desc/unit/mutagen.html).
// Shown on the mutagen unit screen; the mutagen tab gets a short summary that
// links there.
import { useState } from "react";
import type { Engine, Game } from "@swarmsim/engine";
import { useGame } from "../../game/GameContext";
import { useFormat } from "../../format";
import { unitHref } from "../../router";
import { ProgressBar } from "../ProgressBar";
import { ConfirmButton } from "./Confirm";
import "../../styles/progression.css";

/** Seconds until energy covers the ascension cost; undefined when unknown, capped or already affordable. */
export function ascendEtaSecs(game: Game): number | undefined {
  const cost = game.ascendCost();
  if (game.ascendCostCapDiff(cost).greaterThan(0) || game.ascendCostPercent(cost).greaterThanOrEqualTo(1)) return undefined;
  try {
    return game.ascendCostDurationSecs(cost);
  } catch {
    // the engine keeps an old-engine quirk: it throws once energy covers the cost
    return undefined;
  }
}

function AscendProgress({ game }: { game: Game }) {
  const fmt = useFormat();
  const cost = game.ascendCost();
  const energy = game.unit("energy").count();
  const pct = game.ascendCostPercent(cost);
  const capDiff = game.ascendCostCapDiff(cost);
  const eta = fmt.duration(ascendEtaSecs(game));
  return (
    <>
      <ProgressBar value={pct.toNumber()} ready={pct.greaterThanOrEqualTo(1)} label="Energy toward ascension" />
      <p className="bar-label num">
        <span>
          {fmt.long(energy)} energy, {fmt.percent(pct, { floor: true })}
        </span>
        <span>{eta ? `ready in ${eta}` : ""}</span>
      </p>
      {capDiff.greaterThan(0) && (
        <p className="alert cap-note" role="note">
          <span>
            <b className="num">{fmt.long(capDiff)}</b> more than your max energy! Spend energy on abilities to lower the cost, or raise your max energy (more nightbugs).
          </span>
        </p>
      )}
    </>
  );
}

export function AscensionPanel() {
  const store = useGame();
  const { game } = store;
  const fmt = useFormat();
  const [status, setStatus] = useState("");
  const premutagen = game.unit("premutagen").count();
  const cost = game.ascendCost();
  const energy = game.unit("energy").count();
  const canAscend = !cost.greaterThan(energy);
  const respecSpent = game.respecSpent();
  const freeRespecs = game.unit("freeRespec").count();

  const run = (fn: (engine: Engine) => void, done: string) => {
    const err = store.act(fn);
    setStatus(err ? `That didn't work: ${(err as Error).message ?? err}` : done);
  };

  return (
    <section className="section card ascend" aria-labelledby="ascend-title" data-slot="ascension">
      <h2 id="ascend-title">Ascension</h2>
      <p>
        To activate mutagen, your swarm must <b>ascend</b> - restart on a new world. Space travel is too harsh for most of your swarm, but mutagen strengthens a
        few of your swarm's larvae for the trip to their new planet. All the descendents of these larvae - your new swarm - will benefit from mutagen's power.
      </p>
      <p>
        Ascending will activate <b className="num">{fmt.long(premutagen)}</b> new mutagen. Your swarm has infested{" "}
        <b className="num">{fmt.long(game.unit("ascension").count())}</b> new worlds so far.
      </p>
      <p>
        Ascending now will cost <b className="num">{fmt.long(cost)}</b> energy. Spend energy elsewhere to reduce this cost; you've spent{" "}
        <span className="num">{fmt.long(game.ascendEnergySpent())}</span> energy.
      </p>
      <AscendProgress game={game} />
      <ConfirmButton
        label="Ascend - activate mutagen and restart"
        confirmLabel="Ascend"
        disabled={!canAscend}
        warning={
          <>
            Ascend now? Your swarm restarts on a new world: most units and upgrades reset to zero. You keep achievements, mutagen upgrades and crystals, and gain{" "}
            <b className="num">{fmt.long(premutagen)}</b> mutagen.
          </>
        }
        onConfirm={() => run(({ commands }) => commands.ascend({ game }), "Your swarm has ascended to a new world.")}
      />

      <h3 className="ascend-sub">Respec</h3>
      <p>
        Respeccing refunds all <b className="num">{fmt.long(respecSpent.times(game.respecRate()))}</b> mutagen you've spent, but resets all mutagen units and
        upgrades to 0, and resets your next ascension's energy cost to <span className="num">{fmt.long(game.ascendCost({ spent: 0 }))}</span>.
      </p>
      <p>
        Respeccing now will cost <b className="num">{fmt.long(game.respecCost())}</b> energy ({fmt.percent(game.respecCostRate)} of your next ascension's cost).
      </p>
      <ConfirmButton
        quiet
        label="Respec - refund mutagen, but reset ascension cost"
        confirmLabel="Respec"
        disabled={respecSpent.isZero() || !game.isRespecCostMet()}
        warning={
          <>
            Respec for <b className="num">{fmt.long(game.respecCost())}</b> energy? All mutagen units and upgrades go back to 0 and you get{" "}
            <b className="num">{fmt.long(respecSpent.times(game.respecRate()))}</b> mutagen back.
          </>
        }
        onConfirm={() => run(({ commands }) => commands.respec({ game }), "Respecced: your mutagen is refunded.")}
      />
      <p>
        One free respec is available every three ascensions. You have <b className="num">{fmt.long(freeRespecs)}</b> free respec
        {freeRespecs.equals(1) ? "" : "s"} remaining.
      </p>
      <ConfirmButton
        quiet
        label="Respec (free)"
        confirmLabel="Use free respec"
        disabled={respecSpent.isZero() || freeRespecs.lessThanOrEqualTo(0)}
        warning={
          <>
            Use one of your <span className="num">{fmt.long(freeRespecs)}</span> free respecs? All mutagen units and upgrades go back to 0 and you get{" "}
            <b className="num">{fmt.long(respecSpent.times(game.respecRate()))}</b> mutagen back.
          </>
        }
        onConfirm={() => run(({ commands }) => commands.respecFree({ game }), "Respecced for free: your mutagen is refunded.")}
      />

      <h3 className="ascend-sub">Upgrade notifiers</h3>
      <ConfirmButton
        quiet
        label="Reset upgrade notifiers"
        confirmLabel="Reset"
        warning="Set every upgrade's notify setting back to its default? Hidden upgrades and abilities come back."
        onConfirm={() =>
          run(() => {
            game.session.state.watched = {};
            game.session.save();
          }, "Upgrade notifiers are back to their defaults.")
        }
      />
      <p className="more-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

/** The mutagen tab's pointer to the ascension panel: progress and a link. */
export function AscendSummary() {
  const { game } = useGame();
  const fmt = useFormat();
  if (!game.unit("mutagen").isVisible()) return null;
  const cost = game.ascendCost();
  const pct = game.ascendCostPercent(cost);
  const pre = game.unit("premutagen").count();
  const eta = fmt.duration(ascendEtaSecs(game));
  return (
    <a className="card ascend-summary" href={unitHref("mutagen")} data-slot="ascend-summary">
      <span className="ascend-summary-title">Ascend</span>
      <span className="num">
        +{fmt.num(pre)} mutagen · {fmt.percent(pct, { floor: true })} of {fmt.num(cost)} energy
        {eta ? ` · ${eta}` : ""}
      </span>
      <ProgressBar value={pct.toNumber()} ready={pct.greaterThanOrEqualTo(1)} label="Energy toward ascension" />
    </a>
  );
}
