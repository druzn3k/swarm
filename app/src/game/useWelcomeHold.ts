// While a modal is open (a confirm dialog), the welcome back waits.
import { useEffect } from "react";
import { useStore } from "./GameContext";

export function useWelcomeHold(open: boolean): void {
  const store = useStore();
  useEffect(() => {
    if (!open) return;
    return store.holdWelcome({});
  }, [open, store]);
}
