// A stand-in for `window` in unit tests of GameStore.start(): timers come from
// globalThis (use vi.useFakeTimers()), the page's visibility can be switched,
// and pagehide can be fired.
import type { SaveStorage } from "@swarmsim/engine";

export class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

export class FakeWindow extends EventTarget {
  document = new FakeDocument();
  setInterval = (fn: () => void, ms: number) => globalThis.setInterval(fn, ms) as unknown as number;
  clearInterval = (id: number) => globalThis.clearInterval(id);
  setTimeout = (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number;
  clearTimeout = (id: number) => globalThis.clearTimeout(id);

  setVisibility(state: DocumentVisibilityState): void {
    this.document.visibilityState = state;
    this.document.dispatchEvent(new Event("visibilitychange"));
  }

  asWindow(): Window {
    return this as unknown as Window;
  }
}

/** In-memory storage that counts writes per key. */
export function countingStorage(): SaveStorage & { writes: Map<string, number> } {
  const data = new Map<string, string>();
  const writes = new Map<string, number>();
  return {
    writes,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
      writes.set(k, (writes.get(k) ?? 0) + 1);
    },
    removeItem: (k) => void data.delete(k),
  };
}
