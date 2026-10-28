import { useCallback, useEffect, useState } from "react";
import type { Route } from "./router";
import { useRoute } from "./router";
import { useStore } from "./game/GameContext";
import { findUnit } from "./game/selectors";
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
  }
}

function routeKey(r: Route): string {
  return r.name === "tab" ? `tab:${r.tab}` : r.name === "unit" ? `unit:${r.unit}` : r.name;
}

export function App() {
  const route = useRoute();
  const { game } = useStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const key = routeKey(route);

  // a new screen starts at the top, and closes the sheet
  useEffect(() => {
    window.scrollTo(0, 0);
    setMoreOpen(false);
  }, [key]);

  const currentTab = route.name === "tab" ? route.tab : route.name === "unit" ? findUnit(game, route.unit)?.tab?.name : undefined;

  return (
    <>
      <div className="wrap">
        <Header />
        <main className="wrap" id="main">
          <Screen route={route} />
        </main>
        <Footer />
      </div>
      <TabBar current={currentTab} moreOpen={moreOpen} onMore={() => setMoreOpen(true)} />
      <AchievementToast />
      {moreOpen && <MoreSheet onClose={closeMore} />}
    </>
  );
}
