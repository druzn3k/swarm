// One ability (energy spells like Swarmwarp or Clone Larvae): its live
// description, cost per use, progress toward affording it, cast buttons, a
// show/hide toggle (the old watched/manuallyHidden mechanism), and a note of
// what the last cast did.
import { useState } from "react";
import { Dec } from "@swarmsim/engine-wasm";
import { useStore } from "../../game/GameContext";
import type { UpgradeRef } from "../../game/view";
import { useFormat } from "../../format";
import type { Formatter } from "../../format";
import { UpgradeDescription } from "../../content/LiveDescription";
import { gainsSince, previewCast, snapshotCounts } from "../../game/progression";
import type { Gain } from "../../game/progression";
import { unitNoun } from "../../game/selectors";
import { CostList } from "../CostList";
import { ProgressBar } from "../ProgressBar";
import { UpgradeIcon } from "../Icon";
import { StackButton } from "../unit/BuyUnit";
import { upgradeEta } from "../unit/UpgradeItem";
import "../../styles/progression.css";

function gainText(gains: Gain[], fmt: Formatter): string {
  return gains.map((gain) => `+${fmt.num(gain.val)} ${unitNoun(gain.unit, gain.val)}`).join(", ");
}

export function AbilityItem({ upgrade }: { upgrade: UpgradeRef }) {
  const store = useStore();
  const fmt = useFormat();
  const [result, setResult] = useState<{ text: string; key: number } | null>(null);
  const t = upgrade.st;
  const label = upgrade.label;
  const shown = !upgrade.manuallyHidden;
  const ready = upgrade.costMet;
  const pct = ready ? 1 : Dec.from(upgrade.costMetPercent).toNumber();
  const eta = ready ? "" : upgradeEta(upgrade, fmt);
  const max = Dec.from(upgrade.maxCostMet);
  const quarter = Dec.from(upgrade.maxCostMetQuarter);
  const is25 = max.gt(quarter) && quarter.gt(1);
  const titleId = `ability-${upgrade.name}`;

  const toggle = () => {
    // old updateWatchedAbility: shown = 0 (never notify), hidden = -1
    store.act({ do: "watch", upgrade: upgrade.name, level: shown ? -1 : 0 });
  };

  const cast = (how: { num?: number; percent?: number }) => {
    // counts as of now, not as of the last view (time moves on every frame)
    store.refresh();
    const now = store.g.upgrade(upgrade.name);
    const preview = previewCast(now);
    const before = snapshotCounts(store.g, preview.units);
    const { error } = store.act(
      how.percent != null
        ? { do: "buy_max_upgrade", upgrade: upgrade.name, percent: how.percent, ui: "button" }
        : { do: "buy_upgrade", upgrade: upgrade.name, amount: { num: String(how.num ?? 1) }, ui: "button" }
    );
    if (error) {
      setResult({ text: `Couldn't cast ${label}: not enough energy.`, key: Date.now() });
      return;
    }
    const gains = gainsSince(store.g, before);
    const parts: string[] = [];
    if (preview.skipSecs > 0) parts.push(`skipped ${fmt.duration(preview.skipSecs)} ahead`);
    if (gains.length) parts.push(gainText(gains, fmt));
    const name = label.replace(/^./, (c) => c.toUpperCase());
    setResult({ text: `${name} cast${parts.length ? ": " + parts.join(" — ") : ""}.`, key: Date.now() });
  };

  return (
    <li className={"upgrade ability" + (shown ? "" : " upgrade-hidden")} data-upgrade={upgrade.name} aria-labelledby={titleId}>
      <div className="upgrade-top">
        <UpgradeIcon name={upgrade.name} size={32} />
        <h3 className="upgrade-name" id={titleId}>
          {label}
        </h3>
        <button type="button" className="toggle" aria-pressed={shown} onClick={toggle} aria-label={`Show ${label}`}>
          <span className="toggle-box" aria-hidden="true" />
          {shown ? "Shown" : "Hidden"}
        </button>
      </div>
      {shown && (
        <>
          <UpgradeDescription upgrade={upgrade} />
          {t.lol && <p className="lol">{t.lol}</p>}
          <p className="cost">
            This ability costs <CostList costs={upgrade.totalCost} period={false} /> per use.
          </p>
          <ProgressBar value={pct} ready={ready} label={`${label} progress`} />
          <p className="bar-label num">
            <span>{ready ? "Ready" : fmt.percent(pct, { floor: true })}</span>
            <span>{eta ? `ready in ${eta}` : ""}</span>
          </p>
          <div className="btn-row">
            {ready ? <StackButton verb="cast" amount="1" onClick={() => cast({ num: 1 })} /> : <StackButton verb="can't" amount="cast" />}
            <StackButton verb="cast" amount={is25 ? fmt.num(quarter) : "25%"} onClick={is25 ? () => cast({ percent: 0.25 }) : undefined} />
            <StackButton verb="cast" amount={max.gt(1) ? fmt.num(max) : "max"} onClick={max.gt(1) ? () => cast({ percent: 1 }) : undefined} />
          </div>
        </>
      )}
      <p className="cast-result" role="status" aria-live="polite">
        {result && (
          <span key={result.key} className="cast-flash">
            {result.text}
          </span>
        )}
      </p>
    </li>
  );
}
