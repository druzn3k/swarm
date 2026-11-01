// Mutagen: ascension, respec and free respec (views/desc/unit/mutagen.html).
// Shown on the mutagen unit screen; the mutagen tab gets a short summary that
// links there.
import { useState } from "react";
import { Dec } from "@swarmsim/engine-wasm";
import type { AscensionView, Command } from "@swarmsim/engine-wasm";
import { useGame, useNeeds } from "../../game/GameContext";
import { useFormat } from "../../format";
import { unitHref } from "../../router";
import { ProgressBar } from "../ProgressBar";
import { ConfirmButton } from "./Confirm";
import { useOptions } from "../../game/options";
import { defaultWatch } from "../../game/progression";
import { estimateSecs } from "../../game/view";
import type { GameView } from "../../game/view";
import "../../styles/progression.css";

/** Seconds until energy covers the ascension cost; undefined when unknown, capped or already affordable. */
export function ascendEtaSecs(a: AscensionView): number | undefined {
  if (Dec.from(a.cap_diff).gt(0) || Dec.from(a.cost_percent).gte(1)) return undefined;
  return estimateSecs(a.eta);
}

function AscendProgress({ g, a }: { g: GameView; a: AscensionView }) {
  const fmt = useFormat();
  const energy = g.unit("energy").count;
  const pct = Dec.from(a.cost_percent);
  const capDiff = Dec.from(a.cap_diff);
  const eta = fmt.duration(ascendEtaSecs(a));
  return (
    <>
      <ProgressBar value={pct.toNumber()} ready={pct.gte(1)} label="Energy toward ascension" />
      <p className="bar-label num">
        <span>
          {fmt.long(energy)} energy, {fmt.percent(pct, { floor: true })}
        </span>
        <span>{eta ? `ready in ${eta}` : ""}</span>
      </p>
      {capDiff.gt(0) && (
        <p className="alert cap-note" role="note">
          <span>
            <b className="num">{fmt.long(capDiff)}</b> more than your max energy! Spend energy on abilities to lower the cost, or raise your max energy (more nightbugs).
          </span>
        </p>
      )}
    </>
  );
}

/** What resetting the upgrade notifiers does: every notify level back to its default. */
function resetWatchCommands(g: GameView): Command[] {
  return g
    .upgrades()
    .filter((u) => u.v && u.watched !== defaultWatch(u))
    .map((u) => ({ do: "watch", upgrade: u.name, level: defaultWatch(u) }));
}

export function AscensionPanel() {
  const store = useGame();
  useNeeds({ sections: ["ascension"] });
  const { g } = store;
  const fmt = useFormat();
  const [status, setStatus] = useState("");
  const [{ showAdvancedUnitData }] = useOptions();
  const a = g.v.ascension;
  if (!a) return null;
  const premutagen = a.premutagen;
  const cost = Dec.from(a.cost);
  const energy = g.unit("energy").count;
  const canAscend = !cost.gt(energy);
  const respecSpent = Dec.from(a.respec_spent);
  const freeRespecs = Dec.from(a.free_respecs);
  const respecCost = a.respec_cost;
  // the old respecRate(): all of it
  const refund = respecSpent;

  const run = (cmds: Command | Command[], done: string) => {
    const { error } = store.act(cmds);
    setStatus(error ? `That didn't work: ${error.message}` : done);
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
        <b className="num">{fmt.long(g.unit("ascension").count)}</b> new worlds so far.
      </p>
      <p>
        Ascending now will cost <b className="num">{fmt.long(cost)}</b> energy. Spend energy elsewhere to reduce this cost; you've spent{" "}
        <span className="num">{fmt.long(a.energy_spent)}</span> energy.
      </p>
      <AscendProgress g={g} a={a} />
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
        onConfirm={() => run({ do: "ascend" }, "Your swarm has ascended to a new world.")}
      />

      <h3 className="ascend-sub">Respec</h3>
      <p>
        Respeccing refunds all <b className="num">{fmt.long(refund)}</b> mutagen you've spent, but resets all mutagen units and
        upgrades to 0, and resets your next ascension's energy cost to <span className="num">{fmt.long(a.base_cost)}</span>.
      </p>
      <p>
        Respeccing now will cost <b className="num">{fmt.long(respecCost)}</b> energy ({fmt.percent(g.s.sv.respec_cost_rate)} of your next ascension's cost).
      </p>
      <ConfirmButton
        quiet
        label="Respec - refund mutagen, but reset ascension cost"
        confirmLabel="Respec"
        disabled={respecSpent.isZero() || !a.can_respec}
        warning={
          <>
            Respec for <b className="num">{fmt.long(respecCost)}</b> energy? All mutagen units and upgrades go back to 0 and you get{" "}
            <b className="num">{fmt.long(refund)}</b> mutagen back.
          </>
        }
        onConfirm={() => run({ do: "respec" }, "Respecced: your mutagen is refunded.")}
      />
      <p>
        One free respec is available every three ascensions. You have <b className="num">{fmt.long(freeRespecs)}</b> free respec
        {freeRespecs.eq(1) ? "" : "s"} remaining.
      </p>
      <ConfirmButton
        quiet
        label="Respec (free)"
        confirmLabel="Use free respec"
        disabled={respecSpent.isZero() || freeRespecs.lte(0)}
        warning={
          <>
            Use one of your <span className="num">{fmt.long(freeRespecs)}</span> free respecs? All mutagen units and upgrades go back to 0 and you get{" "}
            <b className="num">{fmt.long(refund)}</b> mutagen back.
          </>
        }
        onConfirm={() => run({ do: "respec_free" }, "Respecced for free: your mutagen is refunded.")}
      />

      {/* like the old page, only with advanced unit data */}
      {showAdvancedUnitData && (
        <>
      <h3 className="ascend-sub">Upgrade notifiers</h3>
      <ConfirmButton
        quiet
        label="Reset upgrade notifiers"
        confirmLabel="Reset"
        warning="Set every upgrade's notify setting back to its default? Hidden upgrades and abilities come back."
        onConfirm={() => {
          // every upgrade's notify level, not just the ones on screen
          const release = store.need({}, { upgrades: "all" });
          store.refresh();
          const cmds = resetWatchCommands(store.g);
          release();
          run(cmds, "Upgrade notifiers are back to their defaults.");
        }}
      />
        </>
      )}
      <p className="more-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

/** The mutagen tab's pointer to the ascension panel: progress and a link. */
export function AscendSummary() {
  const { g } = useGame();
  useNeeds({ sections: ["ascension"] });
  const fmt = useFormat();
  const a = g.v.ascension;
  if (!g.unit("mutagen").visible || !a) return null;
  const cost = a.cost;
  const pct = Dec.from(a.cost_percent);
  const pre = a.premutagen;
  const eta = fmt.duration(ascendEtaSecs(a));
  return (
    <a className="card ascend-summary" href={unitHref("mutagen")} data-slot="ascend-summary">
      <span className="ascend-summary-title">Ascend</span>
      <span className="num">
        +{fmt.num(pre)} mutagen · {fmt.percent(pct, { floor: true })} of {fmt.num(cost)} energy
        {eta ? ` · ${eta}` : ""}
      </span>
      <ProgressBar value={pct.toNumber()} ready={pct.gte(1)} label="Energy toward ascension" />
    </a>
  );
}
