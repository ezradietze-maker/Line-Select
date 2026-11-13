import { useSyncExternalStore } from "react";

/**
 * Whether a recovery code is on screen anywhere in the app. It's shown once and only once, so nothing else (the
 * confirm-email notice and its checks) may change the page while it is.
 */
let showing = 0;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

export function recoveryCodeShown(): () => void {
  showing++;
  tell();
  return () => {
    showing--;
    tell();
  };
}

export function useRecoveryCodeShowing(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => showing > 0,
    () => false
  );
}
