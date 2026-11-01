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
 * STATUS: the app now imports its save storage from app/src/game/storage.ts
 * (openSaveStorage / tauriBackend), which includes the one-time copy of a
 * browser-side save into the desktop file. This file is kept only as a
 * standalone reference of the command contract and is not used by the build.
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
