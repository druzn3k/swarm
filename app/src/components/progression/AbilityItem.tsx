// One ability (energy spells like Swarmwarp or Clone Larvae): its live
// description, cost per use, progress toward affording it, cast buttons, a
// show/hide toggle (the old watched/manuallyHidden mechanism), and a note of
// what the last cast did.
import { useState } from "react";
import type { ReactNode } from "react";
import type { Decimal, Upgrade } from "@swarmsim/engine";
import { useStore } from "../../game/GameContext";
import { useFormat } from "../../format";
import type { Formatter } from "../../format";
import { upgradeDescription } from "../../content/descriptions";
import { gainsSince, previewCast, snapshotCounts } from "../../game/progression";
import type { Gain } from "../../game/progression";
import { unitNoun } from "../../game/selectors";
import { unitHref } from "../../router";
import { CostList } from "../CostList";
import { ProgressBar } from "../ProgressBar";
import { StackButton } from "../unit/BuyUnit";
import { upgradeEta } from "../unit/UpgradeItem";
import "../../styles/progression.css";

function out(upgrade: Upgrade, i: number): Decimal | undefined {
  try {
    return upgrade.effect[i]?.output();
  } catch {
    return undefined;
  }
}

/** The live parts of the old ability descriptions (views/desc/upgrade/*.html). */
function AbilityDescription({ upgrade }: { upgrade: Upgrade }) {
  const { game } = useStore();
  const fmt = useFormat();
  const fallback = upgradeDescription(upgrade.name, upgrade.type.description);
  let body: ReactNode = fallback;
  try {
    switch (upgrade.name) {
      case "larvarush":
      case "meatrush":
      case "territoryrush": {
        const n = out(upgrade, 0)!.plus(out(upgrade, 1)!);
        const what = { larvarush: "give birth to", meatrush: "create", territoryrush: "capture" }[upgrade.name];
        const noun = { larvarush: "larvae", meatrush: "meat", territoryrush: "territory" }[upgrade.name];
        body = (
          <>
            Instantly {what} <span className="num">{fmt.long(n)}</span> new {noun}.
          </>
        );
        break;
      }
      case "swarmwarp":
        body = (
          <>
            Warp time around your swarm. Instantly travel into the future, gaining <span className="num">{fmt.duration(out(upgrade, 0)!)}</span> of
            production. Does not produce energy.
          </>
        );
        break;
      case "clonelarvae": {
        const effect = upgrade.effect[0];
        const cap = effect.cap() as Decimal;
        const cocoon = game.unit("cocoon");
        const vu = fmt.velocityUnit({ unit: "larva" });
        const capText = `${fmt.long(cap)} larvae`;
        body = (
          <>
            Clone <span className="num">{fmt.long(effect.output())}</span> new larvae. You produce{" "}
            <span className="num">{fmt.long(game.unit("larva").velocity().times(vu.mult))}</span> larvae per {vu.label}, allowing you to clone up to{" "}
            {cocoon.isVisible() && cocoon.count().greaterThanOrEqualTo(cap) ? (
              <span className="num">{capText}</span>
            ) : (
              <a className="num" href={`${unitHref("cocoon")}?num=${encodeURIComponent("@" + cap.ceil().toString())}`}>
                {capText}
              </a>
            )}
            . You have <span className="num">{fmt.long(effect.bank())}</span> larvae and cocoons available to clone.
          </>
        );
        break;
      }
      case "clonearmy": {
        const lines = upgrade.effect
          .map((e) => ({ unit: e.unit, n: e.output() as Decimal }))
          .filter((x) => x.n.greaterThan(0))
          .map((x) => `${fmt.long(x.n)} ${unitNoun(x.unit, x.n)}`);
        body = (
          <>
            {fallback}
            {lines.length > 0 && <> Create {lines.join(", ")}.</>}
          </>
        );
        break;
      }
    }
  } catch {
    body = fallback;
  }
  return body ? <p className="desc">{body}</p> : null;
}

function gainText(gains: Gain[], fmt: Formatter): string {
  return gains.map((g) => `+${fmt.num(g.val)} ${unitNoun(g.unit, g.val)}`).join(", ");
}

export function AbilityItem({ upgrade }: { upgrade: Upgrade }) {
  const store = useStore();
  const fmt = useFormat();
  const [result, setResult] = useState<{ text: string; key: number } | null>(null);
  const t = upgrade.type;
  const shown = !upgrade.isManuallyHidden();
  const ready = upgrade.isCostMet();
  const pct = ready ? 1 : upgrade.costMetPercent().toNumber();
  const eta = ready ? "" : upgradeEta(upgrade, fmt);
  const max = upgrade.maxCostMet();
  const quarter = upgrade.maxCostMet(0.25);
  const is25 = max.greaterThan(quarter) && quarter.greaterThan(1);
  const titleId = `ability-${upgrade.name}`;

  const toggle = () => {
    // old updateWatchedAbility: shown = 0 (never notify), hidden = -1
    upgrade.watch(shown ? -1 : 0);
    store.bump();
  };

  const cast = (how: { num?: number; percent?: number }) => {
    const preview = previewCast(upgrade);
    const before = snapshotCounts(store.game, preview.units);
    const err = store.act(({ commands }) =>
      how.percent != null
        ? commands.buyMaxUpgrade({ upgrade, percent: how.percent, ui: "button" })
        : commands.buyUpgrade({ upgrade, num: how.num ?? 1, ui: "button" })
    );
    if (err) {
      setResult({ text: `Couldn't cast ${t.label}: not enough energy.`, key: Date.now() });
      return;
    }
    const gains = gainsSince(store.game, before);
    const parts: string[] = [];
    if (preview.skipSecs > 0) parts.push(`skipped ${fmt.duration(preview.skipSecs)} ahead`);
    if (gains.length) parts.push(gainText(gains, fmt));
    const name = String(t.label).replace(/^./, (c) => c.toUpperCase());
    setResult({ text: `${name} cast${parts.length ? ": " + parts.join(" — ") : ""}.`, key: Date.now() });
  };

  return (
    <li className={"upgrade ability" + (shown ? "" : " upgrade-hidden")} data-upgrade={upgrade.name} aria-labelledby={titleId}>
      <div className="upgrade-top">
        <h3 className="upgrade-name" id={titleId}>
          {t.label}
        </h3>
        <button type="button" className="toggle" aria-pressed={shown} onClick={toggle} aria-label={`Show ${t.label}`}>
          <span className="toggle-box" aria-hidden="true" />
          {shown ? "Shown" : "Hidden"}
        </button>
      </div>
      {shown && (
        <>
          <AbilityDescription upgrade={upgrade} />
          {t.lol && <p className="lol">{t.lol}</p>}
          <p className="cost">
            This ability costs <CostList costs={upgrade.totalCost()} period={false} /> per use.
          </p>
          <ProgressBar value={pct} ready={ready} label={`${t.label} progress`} />
          <p className="bar-label num">
            <span>{ready ? "Ready" : fmt.percent(pct, { floor: true })}</span>
            <span>{eta ? `ready in ${eta}` : ""}</span>
          </p>
          <div className="btn-row">
            {ready ? <StackButton verb="cast" amount="1" onClick={() => cast({ num: 1 })} /> : <StackButton verb="can't" amount="cast" />}
            <StackButton verb="cast" amount={is25 ? fmt.num(quarter) : "25%"} onClick={is25 ? () => cast({ percent: 0.25 }) : undefined} />
            <StackButton verb="cast" amount={max.greaterThan(1) ? fmt.num(max) : "max"} onClick={max.greaterThan(1) ? () => cast({ percent: 1 }) : undefined} />
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
