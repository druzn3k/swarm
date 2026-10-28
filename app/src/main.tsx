import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { GameProvider } from "./game/GameContext";
import { useRunningStore } from "./game/useGameStore";
import { FormatContext, defaultFormatter } from "./format";
import "./styles.css";

function Root() {
  const store = useRunningStore();
  return (
    <GameProvider store={store}>
      {/* PHASE B (B2): build the formatter from the player's options */}
      <FormatContext.Provider value={defaultFormatter}>
        <App />
      </FormatContext.Provider>
    </GameProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
