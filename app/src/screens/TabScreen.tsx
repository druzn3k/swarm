import { useEffect } from "react";
import { useGameValue, useStore } from "../game/GameContext";
import { tabByName, tabTitle } from "../game/selectors";
import { tabHref } from "../router";
import { HiveCanvas } from "../components/HiveCanvas";
import { UnitList } from "../components/UnitList";
import { AchievementPointsRow } from "../components/meta/AchievementPointsRow";
import { AscendSummary } from "../components/progression/AscensionPanel";

/**
 * A tab: the hive, the tab's title and its units. On the phone this is the
 * whole screen; on the laptop layout it is the left column, with `selected`
 * marking the unit shown on the right and the title one level down (the unit
 * has the page's h1).
 */
export function TabScreen({ tab: name, selected, titleId }: { tab: string; selected?: string; titleId?: string }) {
  const { game } = useStore();
  const tab = tabByName(game, name);
  const visible = useGameValue((s) => !!tabByName(s.game, name)?.isVisible());
  // like the old game: unknown or still-locked tabs go back to meat
  useEffect(() => {
    if (!visible) window.location.replace(tabHref("meat"));
  }, [visible]);
  if (!tab || !visible) return null;
  const Title = selected === undefined ? "h1" : "h2";
  return (
    <>
      <HiveCanvas tab={name} />
      <Title className="tab-title" id={titleId}>
        {tabTitle(tab)}
      </Title>
      {/* on the larva tab the old game listed achievement points here */}
      {name === "larva" && <AchievementPointsRow />}
      {/* (on the laptop layout the full panel is right there when mutagen is shown) */}
      {tab.name === "mutagen" && selected !== "mutagen" && <AscendSummary />}
      <UnitList tab={tab} selected={selected} />
    </>
  );
}
