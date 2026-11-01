// Creates the app's one GameStore (and starts its frame loop) for the root component.
import { useEffect } from "react";
import { GameStore, SAVE_ID } from "./store";
import { openSaveStorage } from "./storage";

/** Loads the save (from the desktop shell's file when in Tauri, else localStorage) and creates the store. */
export async function createBrowserStore(): Promise<GameStore> {
  // "?forcewelcome" in the url shows the welcome-back summary (the old game's switch)
  const forceWelcomeBack = /[?&]forcewelcome\b/.test(window.location.hash + window.location.search);
  return new GameStore({ storage: await openSaveStorage(SAVE_ID), forceWelcomeBack });
}

/** Start the frame loop and autosaving while mounted. */
export function useRunningStore(store: GameStore): GameStore {
  useEffect(() => store.start(), [store]);
  return store;
}
