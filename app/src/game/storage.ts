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
