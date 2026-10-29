import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { GameProvider } from "./game/GameContext";
import { useRunningStore } from "./game/useGameStore";
import { FormatContext } from "./format";
import type { ReactNode } from "react";
import { useOptionsFormatter } from "./game/options";
import { setupPwa } from "./pwa";
import { watchListScroll } from "./scrollMemory";
import "./styles.css";
import "./styles/wide.css";

function FormatProvider({ children }: { children: ReactNode }) {
  return <FormatContext.Provider value={useOptionsFormatter()}>{children}</FormatContext.Provider>;
}

function Root() {
  const store = useRunningStore();
  return (
    <GameProvider store={store}>
      {/* the formatter follows the player's options (game/options.ts) */}
      <FormatProvider>
        <App />
      </FormatProvider>
    </GameProvider>
  );
}

setupPwa();
// before React subscribes to the hash: it reads the list's position while it is still on the page
watchListScroll();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
