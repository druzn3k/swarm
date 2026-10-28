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

/**
 * Like useGameValue, but a tick re-reads only every `every`-th version of the
 * game (offset by `phase`); player actions are seen at once. A long list gives
 * its rows different phases to spread their work over ticks. With `every` 1
 * this is useGameValue.
 */
export function useGameValueEvery<T extends string | number | boolean | null | undefined>(
  select: (store: GameStore) => T,
  every: number,
  phase = 0
): T {
  const store = useStore();
  const last = useRef<{ version: number; actions: number; value: T } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const version = store.getVersion();
    const l = last.current;
    if (l && (l.version === version || (l.actions === store.actions && (version + phase) % every !== 0))) return l.value;
    const value = select(store);
    last.current = { version, actions: store.actions, value };
    return value;
  });
}

/** Subscribe to an engine event ("achieve", "command", "buyFirst", ...) for this component's lifetime. */
export function useEngineEvent<K extends keyof EngineEvents>(name: K, handler: (payload: EngineEvents[K]) => void): void {
  const store = useStore();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => store.events.on(name, (p) => ref.current(p as EngineEvents[K])), [store, name]);
}
