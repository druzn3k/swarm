import { StrictMode } from "react";
import { initEngine } from "@swarmsim/engine-wasm";
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

const root = createRoot(document.getElementById("root")!);
// the engine is WebAssembly: fetched and compiled once, before the first render
initEngine().then(
  () =>
    root.render(
      <StrictMode>
        <Root />
      </StrictMode>
    ),
  (e) => {
    console.error("couldn't start the game engine", e);
    root.render(<p className="placeholder">Swarm Hive couldn't start its game engine in this browser. Try reloading, or a newer browser.</p>);
  }
);
