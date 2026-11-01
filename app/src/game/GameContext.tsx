// React bindings for the GameStore.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { GameStore, Need, StoreEvents } from "./store";
import type { GameView } from "./view";

const GameContext = createContext<GameStore | null>(null);

export function GameProvider({ store, children }: { store: GameStore; children: ReactNode }) {
  return <GameContext.Provider value={store}>{children}</GameContext.Provider>;
}

/** The store: `.g` (the latest view), `.act()`, `.on()`. Does not re-render on ticks. */
export function useStore(): GameStore {
  const store = useContext(GameContext);
  if (!store) throw new Error("useStore outside <GameProvider>");
  return store;
}

/** Re-render on every view and action. Returns the store. */
export function useGame(): GameStore {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

type Primitive = string | number | boolean | null | undefined;

/**
 * Re-render only when `select(store)` changes (compared with Object.is). Keep
 * the result a primitive, e.g. formatted text or a boolean, so a tick that
 * doesn't change what's shown doesn't re-render.
 */
export function useGameValue<T extends Primitive>(select: (store: GameStore) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store));
}

/** useGameValue over the view facade: `useView((g) => fmt.num(g.unit("meat").count))`. */
export function useView<T extends Primitive>(select: (g: GameView) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store.g));
}

/**
 * Like useGameValue, but a view re-reads only every `every`-th version of the
 * game (offset by `phase`); player actions are seen at once. A long list gives
 * its rows different phases to spread their work over ticks. With `every` 1
 * this is useGameValue.
 */
export function useGameValueEvery<T extends Primitive>(select: (store: GameStore) => T, every: number, phase = 0): T {
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

/**
 * Ask for parts of the view while mounted: units to focus (their production,
 * stats, effects and upgrade estimates) and optional sections. Changes to the
 * need are keyed by its contents, so pass literals freely.
 */
export function useNeeds(need: Need): void {
  const store = useStore();
  const key = JSON.stringify(need);
  useLayoutEffect(() => store.need({}, JSON.parse(key) as Need), [store, key]);
}

/** Subscribe to a store event ("achieve", "command", "save") for this component's lifetime. */
export function useStoreEvent<K extends keyof StoreEvents>(name: K, handler: (payload: StoreEvents[K]) => void): void {
  const store = useStore();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => store.on(name, (p) => ref.current(p)), [store, name]);
}
