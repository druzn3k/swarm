// The More sheet's actions (views/tabs.html, directives/tabs.coffee): buy all
// upgrades, buy the cheapest upgrades (spending at most 25%), and undo with
// its 30-second countdown.
import { useState } from "react";
import { useGameValue, useStore } from "../../game/GameContext";
import { buyAllList, buyCheapestList, CHEAPEST_PERCENT, undoSecondsLeft } from "../../game/progression";
import "../../styles/progression.css";

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export function MoreActions() {
  const store = useStore();
  const all = useGameValue((s) => buyAllList(s.game).length);
  const cheapest = useGameValue((s) => buyCheapestList(s.game).length);
  const undoLeft = useGameValue((s) => undoSecondsLeft(s.game, s.commands));
  const [status, setStatus] = useState("");

  const buy = (percent: number) => {
    const upgrades = percent === 1 ? buyAllList(store.game) : buyCheapestList(store.game);
    // don't buy zero upgrades, it would invalidate undo (old #628)
    if (!upgrades.length) return;
    const err = store.act(({ commands }) => commands.buyAllUpgrades({ upgrades, percent }));
    setStatus(err ? "Couldn't buy every upgrade; prices changed. Some were bought." : `Bought ${plural(upgrades.length, "upgrade")}.`);
  };
  const undo = () => {
    if (undoSecondsLeft(store.game, store.commands) <= 0) return;
    const err = store.act(({ commands }) => commands.undo());
    setStatus(err ? "Nothing to undo." : "Undone.");
  };

  return (
    <>
      <ul data-slot="more-actions" aria-label="Actions" className="more-actions">
        <li>
          <button type="button" className="sheet-item" disabled={all <= 0} onClick={() => buy(1)} data-action="buy-all">
            <span className="more-glyph-sm" aria-hidden="true">
              ▲
            </span>
            Buy all {plural(all, "upgrade")}
          </button>
        </li>
        <li>
          <button type="button" className="sheet-item" disabled={cheapest <= 0} onClick={() => buy(CHEAPEST_PERCENT)} data-action="buy-cheapest">
            <span className="more-glyph-sm" aria-hidden="true">
              △
            </span>
            Buy cheapest {plural(cheapest, "upgrade")}
            <small>max 25% each</small>
          </button>
        </li>
        <li>
          <button type="button" className="sheet-item" disabled={undoLeft <= 0} onClick={undo} data-action="undo">
            <span className="more-glyph-sm" aria-hidden="true">
              ↶
            </span>
            Undo
            {undoLeft > 0 && <small className="num">({undoLeft} sec)</small>}
          </button>
        </li>
      </ul>
      <p className="more-status" role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
