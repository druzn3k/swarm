// React bindings for the GameStore.
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { EngineEvents } from "@swarmsim/engine";
import type { GameStore } from "./store";

const GameContext = createContext<GameStore | null>(null);

export function GameProvider({ store, children }: { store: GameStore; children: ReactNode }) {
  return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
}

/** The store: `.game`, `.commands`, `.events`, `.engine`, `.act()`. Does not re-render on ticks. */
export function useStore(): GameStore {
  const store = useContext(GameContext);
  if (!store) throw new Error("useStore outside <GameProvider>");
  return store;
}

/** Re-render on every tick and command. Returns the store. */
export function useGame(): GameStore {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/**
 * Re-render only when `select(store)` changes (compared with Object.is). Keep
 * the result a primitive, e.g. formatted text or a boolean, so a tick that
 * doesn't change what's shown doesn't re-render.
 */
export function useGameValue<T extends string | number | boolean | null | undefined>(select: (store: GameStore) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store));
}

/** Subscribe to an engine event ("achieve", "command", "buyFirst", ...) for this component's lifetime. */
export function useEngineEvent<K extends keyof EngineEvents>(name: K, handler: (payload: EngineEvents[K]) => void): void {
  const store = useStore();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => store.events.on(name, (p) => ref.current(p as EngineEvents[K])), [store, name]);
}
