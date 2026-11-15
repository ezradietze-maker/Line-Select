import { useSyncExternalStore } from "react";

/**
 * Whether Line Select can reach its server right now. The browser's own "online" flag isn't enough on its own: on a
 * hotel's Wi-Fi with no internet behind it, it still says online. So a request that fails to connect also marks the
 * app offline, and while offline a tiny request (`/api/ping`, which the offline worker never answers from its copy)
 * checks at once and then every few seconds until the server answers again.
 */

const PROBE_EVERY_MS = 5000;
/** A ping with no answer in this long has none: on a hotel's Wi-Fi that's there but crawling, it may never answer. */
const PROBE_WAIT_MS = 4000;
let offline = typeof navigator !== "undefined" ? !navigator.onLine : false;
/**
 * Offline, and checked: the browser says so, or the ping failed too. Only then is the pilot told (`OfflineNotice`). A
 * request that gave up marks the app offline at once, so its load goes to this device's copies, but the server may only
 * have been slow on that one request: "Flying offline" went up for as long as 13 seconds while the ping was answered.
 */
let shown = offline;
let probing: ReturnType<typeof setInterval> | null = null;
let checking = false;
const listeners = new Set<() => void>();

function set(next: boolean, checked = next) {
  if (next === offline && (next && checked) === shown) return;
  offline = next;
  shown = next && checked;
  for (const l of listeners) l();
  if (offline) startProbing();
  else if (probing) {
    clearInterval(probing);
    probing = null;
  }
}

async function probe(): Promise<void> {
  if (checking) return;
  checking = true;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), PROBE_WAIT_MS);
  try {
    const res = await fetch("/api/ping", { cache: "no-store", signal: stop.signal });
    if (res.ok) {
      set(false);
      return;
    }
  } catch {
    // No answer, or none in time.
  } finally {
    clearTimeout(timer);
    checking = false;
  }
  // Offline for sure: the pilot is told.
  if (offline) set(true, true);
}

function startProbing() {
  if (probing || typeof window === "undefined") return;
  probing = setInterval(() => void probe(), PROBE_EVERY_MS);
  void probe();
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => set(true, true));
  window.addEventListener("online", () => void probe());
  if (offline) startProbing();
}

/** A request couldn't connect at all (no response, not a slow one): the app is offline until the server answers again. */
export function reportConnectionLost(): void {
  if (!offline) set(true, false);
}

export function isOffline(): boolean {
  return offline;
}

/** Offline and checked (`shown`): what the offline notice says. */
export function offlineShown(): boolean {
  return shown;
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

/** True while the pilot should be told they're offline: the ping has failed too, or the browser says so. */
export function useOfflineShown(): boolean {
  return useSyncExternalStore(subscribe, offlineShown, () => false);
}
