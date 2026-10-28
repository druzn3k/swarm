import { useEffect } from "react";
import { useGameValue, useStore } from "../game/GameContext";
import { tabByName, tabTitle } from "../game/selectors";
import { tabHref } from "../router";
import { HiveCanvas } from "../components/HiveCanvas";
import { UnitList } from "../components/UnitList";
import { AscendSummary } from "../components/progression/AscensionPanel";

export function TabScreen({ tab: name }: { tab: string }) {
  const { game } = useStore();
  const tab = tabByName(game, name);
  const visible = useGameValue((s) => !!tabByName(s.game, name)?.isVisible());
  // like the old game: unknown or still-locked tabs go back to meat
  useEffect(() => {
    if (!visible) window.location.replace(tabHref("meat"));
  }, [visible]);
  if (!tab || !visible) return null;
  return (
    <>
      {/* PHASE B (B3): per-tab hive scenes (territory war band, energy nexus, mutagen lab) */}
      <HiveCanvas />
      <h1 className="tab-title">{tabTitle(tab)}</h1>
      {/* PHASE B: on the larva tab the old game listed achievement points here */}
      {tab.name === "mutagen" && <AscendSummary />}
      <UnitList tab={tab} />
    </>
  );
}
