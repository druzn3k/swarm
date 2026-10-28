// The per-upgrade notify setting (views/directive-unit.html): hide the
// upgrade, never notify, or notify when buyable / at 2x / at 4x its cost. It
// is stored in the save like the old game (upgrade.watch()), and drives the
// "new upgrade" markers on tabs and unit cards (isNewlyUpgradable).
import { useId } from "react";
import type { Upgrade } from "@swarmsim/engine";
import { useStore } from "../../game/GameContext";
import { UpgradeIcon } from "../Icon";
import { NOTIFY_OPTIONS } from "../../game/progression";
import "../../styles/progression.css";

export function UpgradeNotify({ upgrade }: { upgrade: Upgrade }) {
  const store = useStore();
  const id = useId();
  const value = upgrade.watchedAt();
  const marked = upgrade.isNewlyUpgradable();
  return (
    <div className="notify">
      <label htmlFor={id}>
        <span className={"notify-dot" + (marked ? " on" : "")} aria-hidden="true" />
        Notify
      </label>
      <select
        id={id}
        className="notify-select"
        value={NOTIFY_OPTIONS.some((o) => o.value === value) ? value : 1}
        onChange={(e) => {
          upgrade.watch(Number(e.target.value));
          store.bump();
        }}
      >
        {NOTIFY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A hidden upgrade: collapsed to its name and the setting that brings it back. */
export function HiddenUpgrade({ upgrade }: { upgrade: Upgrade }) {
  return (
    <li className="upgrade upgrade-hidden" data-upgrade={upgrade.name} data-hidden="true">
      <div className="upgrade-top">
        <UpgradeIcon name={upgrade.name} size={32} />
        <h3 className="upgrade-name">{upgrade.type.label}</h3>
        <span className="upgrade-level">Hidden</span>
      </div>
      <UpgradeNotify upgrade={upgrade} />
    </li>
  );
}
