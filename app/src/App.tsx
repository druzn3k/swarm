import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Route } from "./router";
import { useRoute } from "./router";
import { useStore } from "./game/GameContext";
import { findUnit, tabByName } from "./game/selectors";
import { useWide } from "./layout";
import { restoredScroll } from "./scrollMemory";
import { Split } from "./components/Split";
import { Header } from "./components/Header";
import { TabBar } from "./components/TabBar";
import { MoreSheet } from "./components/MoreSheet";
import { Footer } from "./components/Footer";
import { TabScreen } from "./screens/TabScreen";
import { UnitScreen } from "./screens/UnitScreen";
import { AchievementsScreen } from "./screens/AchievementsScreen";
import { StatisticsScreen } from "./screens/StatisticsScreen";
import { OptionsScreen } from "./screens/OptionsScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { AchievementToast } from "./components/meta/AchievementToast";
import { WelcomeBack } from "./components/progression/WelcomeBack";
import { TutorialHint } from "./components/progression/TutorialHint";
import { ArtGalleryScreen } from "./screens/ArtGalleryScreen";

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "tab":
      return <TabScreen key={route.tab} tab={route.tab} />;
    case "unit":
      return <UnitScreen key={route.unit} unit={route.unit} />;
    case "achievements":
      return <AchievementsScreen />;
    case "statistics":
      return <StatisticsScreen />;
    case "options":
      return <OptionsScreen />;
    case "about":
      return <AboutScreen />;
    case "art":
      return <ArtGalleryScreen />;
  }
}

function routeKey(r: Route): string {
  return r.name === "tab" ? `tab:${r.tab}` : r.name === "unit" ? `unit:${r.unit}` : r.name;
}

export function App() {
  const route = useRoute();
  const { game } = useStore();
  const wide = useWide();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const moreButton = useRef<HTMLButtonElement>(null);
  const key = routeKey(route);

  // The tab whose list goes with this route: the tab itself, or the unit's
  // tab. A unit picked from "all units" keeps that list (laptop layout).
  const lastList = useRef<string>();
  const unitTab = route.name === "unit" ? findUnit(game, route.unit)?.tab?.name : undefined;
  const listTab = route.name === "tab" ? route.tab : route.name === "unit" ? (lastList.current === "all" ? "all" : (unitTab ?? "meat")) : undefined;
  lastList.current = listTab ?? lastList.current;

  // like the old game's tab.lastselected: a tab remembers the unit last opened on it
  useEffect(() => {
    if (route.name !== "unit" || !listTab) return;
    const tab = tabByName(game, listTab);
    const unit = findUnit(game, route.unit);
    if (tab && unit) tab.lastselected = unit;
  }, [game, route, listTab]);

  // switching between phone and laptop layouts moves the More button; close the sheet
  useEffect(() => setMoreOpen(false), [wide]);

  // a new screen starts at the top (a list you come back to from one of its
  // units, where you left it: scrollMemory.ts), and closes the sheet
  useLayoutEffect(() => {
    window.scrollTo(0, (!wide && restoredScroll(route)) || 0);
    setMoreOpen(false);
  }, [key]);

  const currentTab = route.name === "tab" ? route.tab : route.name === "unit" ? (wide ? listTab : unitTab) : undefined;
  const tabBar = <TabBar current={currentTab} moreOpen={moreOpen} onMore={() => setMoreOpen(true)} wide={wide} moreRef={moreButton} />;

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // a hash link would change the route; move focus instead
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className={wide ? "wrap wide" : "wrap"}>
        <Header />
        {/* laptop: the tabs are a strip under the header, before the content */}
        {wide && tabBar}
        {wide && listTab ? (
          <Split listTab={listTab} unit={route.name === "unit" ? route.unit : undefined} />
        ) : (
          <main className={wide ? "wrap page-wide" : "wrap"} id="main" tabIndex={-1}>
            <WelcomeBack />
            {(route.name === "tab" || route.name === "unit") && <TutorialHint />}
            <Screen route={route} />
          </main>
        )}
        <Footer />
      </div>
      {!wide && tabBar}
      <AchievementToast />
      {moreOpen && <MoreSheet onClose={closeMore} anchor={wide ? moreButton : undefined} />}
    </>
  );
}
