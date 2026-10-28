// Installable web app: registers the service worker (build/service-worker.ts),
// asks the browser to keep the save from being evicted, and remembers
// Chrome's install prompt so the More menu can offer "Install app".
import { useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setupPwa(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // offer it from the More menu instead of a browser bar
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        /* no offline support; the game still runs */
      });
    });
  }
  // saves live in localStorage; ask the browser not to clear it under storage pressure
  navigator.storage?.persist?.().catch(() => {});
}

/** Whether the browser offered to install the app (and it isn't installed yet). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
    () => false
  );
}

/** Shows the browser's install dialog; true if the player accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  notify();
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}
