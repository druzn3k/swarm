/**
 * Save storage for the desktop (Tauri) build of Swarm Simulator.
 *
 * The Tauri shell (rust/crates/tauri) serves the same built app (app/dist) and
 * exposes two commands that keep the save in a file in the app data directory
 * ($XDG_DATA_HOME/com.swarmsim.desktop/save.txt, the previous save kept as
 * save.prev.txt) instead of the webview's localStorage, which a user can't
 * find, back up, or keep when the webview's data is cleared:
 *
 *   load_save()          -> string | null   (null: no save yet)
 *   store_save({ text }) -> void            (atomic write; rejects with a message on I/O errors)
 *
 * `withGlobalTauri` is on, so `window.__TAURI__.core.invoke` exists in the shell
 * and nowhere else; no @tauri-apps/api dependency is needed.
 *
 * HOW THE APP SHOULD USE THIS (not wired up yet; that is the app's job):
 *   1. Copy this file into app/src (or import it) and route the app's save
 *      load/store through `saveStorage()` instead of calling localStorage
 *      directly. In a browser it falls back to localStorage under the app's
 *      existing key, so the web build behaves as before.
 *   2. Load once at startup with `await storage.load()` (it is async in the shell).
 *   3. Keep saving on the app's existing schedule (autosave, visibilitychange /
 *      pagehide); `store` is async, so don't block on it, but do log failures.
 *   4. Optional migration: if `isDesktop()` and `load()` returns null, read the
 *      old localStorage key once and `store` it, so a first desktop run keeps
 *      a save made earlier in the same webview profile.
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriGlobal {
  core: { invoke: Invoke };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

export interface SaveStorage {
  /** The save text, or null if there is none. */
  load(): Promise<string | null>;
  /** Replaces the save. */
  store(text: string): Promise<void>;
}

/** True inside the Tauri desktop shell. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.__TAURI__ !== undefined;
}

/** File-backed storage via the shell's commands. */
export function tauriStorage(invoke: Invoke): SaveStorage {
  return {
    load: () => invoke<string | null>("load_save"),
    store: (text) => invoke<void>("store_save", { text }),
  };
}

/** The browser's localStorage under `key`. */
export function localStorageStorage(key: string): SaveStorage {
  return {
    load: async () => window.localStorage.getItem(key),
    store: async (text) => window.localStorage.setItem(key, text),
  };
}

/** The shell's file storage when running in Tauri, else localStorage under `key`. */
export function saveStorage(key: string): SaveStorage {
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;
  return tauri ? tauriStorage(tauri.core.invoke) : localStorageStorage(key);
}
