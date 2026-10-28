// localStorage that never throws (private windows, blocked storage, quota).
import type { SaveStorage } from "@swarmsim/engine";

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
