// Where saves live: localStorage that never throws (private windows, blocked
// storage, quota), behind a three-method interface tests can fake.

/** The bits of `Storage` the store uses. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function safeLocalStorage(): SaveStorage {
  return {
    getItem(key: string) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* not saved; the game keeps running */
      }
    },
    removeItem(key: string) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** In-memory storage (tests, and when nothing else is given). */
export function memoryStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

// --- the save file: localStorage in a browser, the Tauri shell's file on the desktop ---
//
// The game store is synchronous (`SaveStorage` above), so the desktop build
// loads the save once at startup (`openSaveStorage`) and keeps it in memory:
// reads come from there, writes update it and go to the shell's `store_save`
// command without waiting (fire and forget, which is what a `pagehide` save
// needs). In a browser every call goes straight to localStorage, as before.
// Only the save itself (`saveId`) goes to the shell; the heartbeat, the v1
// save and other keys stay in the webview's localStorage.

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: Invoke } };
  }
}

/** The shell's invoke, or undefined outside Tauri. */
export function tauriInvoke(): Invoke | undefined {
  return typeof window === "undefined" ? undefined : window.__TAURI__?.core?.invoke;
}

/** True inside the Tauri desktop shell. */
export function isDesktop(): boolean {
  return tauriInvoke() !== undefined;
}

/** Async access to the one save. */
export interface SaveBackend {
  /** The save text, or null if there is none. */
  load(): Promise<string | null>;
  /** Replaces the save. */
  store(text: string): Promise<void>;
}

/** The shell's file storage (commands `load_save` and `store_save`). */
export function tauriBackend(invoke: Invoke): SaveBackend {
  return {
    load: async () => (await invoke<string | null>("load_save")) ?? null,
    store: async (text) => {
      await invoke<void>("store_save", { text });
    },
  };
}

/** localStorage under `key`; throws if the browser blocks it. */
export function localBackend(key: string): SaveBackend {
  return {
    load: async () => window.localStorage.getItem(key),
    store: async (text) => window.localStorage.setItem(key, text),
  };
}

/** The shell's backend inside Tauri, else localStorage under `key`. */
export function saveBackend(key: string): SaveBackend {
  const invoke = tauriInvoke();
  return invoke ? tauriBackend(invoke) : localBackend(key);
}

/** Save problems for the UI (a toast); the game keeps running. */
const errorListeners = new Set<(message: string) => void>();
let pendingError: string | null = null;
export function onSaveError(fn: (message: string) => void): () => void {
  // a problem from before anything was listening (startup) is delivered to the first listener
  if (pendingError !== null && errorListeners.size === 0) fn(pendingError);
  errorListeners.add(fn);
  return () => void errorListeners.delete(fn);
}
/** For tests. */
export function clearSaveErrors(): void {
  pendingError = null;
  errorListeners.clear();
}
export function reportSaveError(what: string, e: unknown): void {
  const detail = e instanceof Error ? e.message : String(e);
  console.warn(what, e);
  pendingError = `${what}: ${detail}`;
  for (const fn of [...errorListeners]) fn(`${what}: ${detail}`);
}

/**
 * The store's storage for the app. Browser: safeLocalStorage(). Desktop: the
 * save is read from the shell now (async), after copying a browser-side save
 * into the shell's file once if that file is empty; later writes of `saveId`
 * go to the shell without waiting. A shell that can't be read falls back to
 * the browser's localStorage and tells the player.
 */
export async function openSaveStorage(saveId: string, invoke: Invoke | undefined = tauriInvoke()): Promise<SaveStorage> {
  const local = safeLocalStorage();
  if (!invoke) return local;
  const backend = tauriBackend(invoke);
  let text: string | null;
  try {
    text = await backend.load();
    if (text === null) {
      // first desktop run: keep a save made earlier in this webview
      const old = local.getItem(saveId);
      if (old) {
        await backend.store(old);
        text = old;
      }
    }
  } catch (e) {
    reportSaveError("Couldn't read the saved game from the desktop app's folder; using browser storage", e);
    return local;
  }
  let current = text;
  let failing = false;
  return {
    getItem: (key) => (key === saveId ? current : local.getItem(key)),
    setItem(key, value) {
      if (key !== saveId) return local.setItem(key, value);
      current = value;
      backend.store(value).then(
        () => {
          failing = false;
        },
        (e) => {
          // once per streak, not at every autosave
          if (!failing) reportSaveError("Couldn't save the game", e);
          failing = true;
        }
      );
    },
    removeItem(key) {
      if (key === saveId) current = null;
      else local.removeItem?.(key);
    },
  };
}
