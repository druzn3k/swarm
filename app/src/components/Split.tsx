// The laptop layout of a tab or unit route: the tab (hive and unit list) on
// the left, a unit's screen on the right. With no unit in the route, the right
// shows the unit last opened on this tab (the old game's tab.lastselected),
// else the tab's lead unit if it has something to buy or cast, else the
// cheapest unit that does (game/selectors.ts defaultUnit).
import { useEffect, useRef, useState } from "react";
import { useGameValue, useStore } from "../game/GameContext";
import { defaultUnit, findUnit, tabByName, unitLabel } from "../game/selectors";
import { TabScreen } from "../screens/TabScreen";
import { UnitScreen } from "../screens/UnitScreen";
import { WelcomeBack } from "./progression/WelcomeBack";
import { TutorialHint } from "./progression/TutorialHint";

export function Split({ listTab, unit }: { listTab: string; unit?: string }) {
  const { game } = useStore();
  const tabVisible = useGameValue((s) => !!tabByName(s.game, listTab)?.isVisible());
  const fallback = useGameValue((s) => (unit === undefined ? defaultUnit(s.game, listTab) : ""));
  const shown = unit ?? fallback;
  const selected = unit === undefined ? fallback : (findUnit(game, unit)?.name ?? unit);

  // A new unit on the right: if the control that did it went away with the old
  // unit (prev/next), focus the new unit; if it stayed (a card in the list, a
  // tab), leave focus there and say what is shown.
  const [said, setSaid] = useState("");
  const prev = useRef(selected);
  useEffect(() => {
    if (prev.current === selected) return;
    prev.current = selected;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      document.getElementById("main")?.focus({ preventScroll: true });
      setSaid("");
    } else {
      const u = findUnit(game, selected);
      setSaid(u ? `Showing ${unitLabel(u, true)}` : "");
    }
  }, [game, selected]);

  return (
    <div className="split">
      <section className="split-side" aria-labelledby="list-title">
        <TabScreen key={listTab} tab={listTab} selected={selected} titleId="list-title" />
        <p className="sr-only" role="status" aria-live="polite" data-slot="split-status">
          {said}
        </p>
      </section>
      <main className="split-main wrap" id="main" tabIndex={-1}>
        {/* hints go first in the content, where there is room for them */}
        <WelcomeBack />
        <TutorialHint />
        {/* a locked tab sends the player back to meat (TabScreen); show nothing meanwhile */}
        {tabVisible && shown && <UnitScreen key={shown} unit={shown} listTab={listTab} />}
      </main>
    </div>
  );
}
