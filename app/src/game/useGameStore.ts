// Creates the app's one GameStore (and starts its frame loop) for the root component.
import { useEffect, useState } from "react";
import { GameStore } from "./store";
import { safeLocalStorage } from "./storage";

export function createBrowserStore(): GameStore {
  // "?forcewelcome" in the url shows the welcome-back summary (the old game's switch)
  const forceWelcomeBack = /[?&]forcewelcome\b/.test(window.location.hash + window.location.search);
  return new GameStore({ storage: safeLocalStorage(), forceWelcomeBack });
}

/** Start the frame loop and autosaving while mounted. The engine must be initialised (initEngine). */
export function useRunningStore(factory: () => GameStore = createBrowserStore): GameStore {
  const [store] = useState(factory);
  useEffect(() => store.start(), [store]);
  return store;
}
