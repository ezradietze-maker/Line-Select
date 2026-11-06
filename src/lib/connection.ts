import { useSyncExternalStore } from "react";

/**
 * Whether Line Select can reach its server right now. The browser's own "online" flag isn't enough on its own: on a
 * hotel's Wi-Fi with no internet behind it, it still says online. So a request that fails to connect also marks the
 * app offline, and while offline a tiny request (`/api/ping`, which the offline worker never answers from its copy)
 * checks every few seconds until the server answers again.
 */

const PROBE_EVERY_MS = 5000;
let offline = typeof navigator !== "undefined" ? !navigator.onLine : false;
let probing: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === offline) return;
  offline = next;
  for (const l of listeners) l();
  if (offline) startProbing();
  else if (probing) {
    clearInterval(probing);
    probing = null;
  }
}

async function probe(): Promise<void> {
  try {
    const res = await fetch("/api/ping", { cache: "no-store" });
    if (res.ok) set(false);
  } catch {
    // Still offline.
  }
}

function startProbing() {
  if (probing || typeof window === "undefined") return;
  probing = setInterval(() => void probe(), PROBE_EVERY_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => set(true));
  window.addEventListener("online", () => void probe());
  if (offline) startProbing();
}

/** A request couldn't connect at all (no response, not a slow one): the app is offline until the server answers again. */
export function reportConnectionLost(): void {
  set(true);
}

export function isOffline(): boolean {
  return offline;
}

/** Resolves once the server can be reached again, or with false after `maxMs`. */
export function waitForConnection(maxMs: number): Promise<boolean> {
  if (!offline) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listeners.delete(check);
      resolve(false);
    }, maxMs);
    const check = () => {
      if (offline) return;
      clearTimeout(timer);
      listeners.delete(check);
      resolve(true);
    };
    listeners.add(check);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the app can't reach its server. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, () => offline, () => false);
}
