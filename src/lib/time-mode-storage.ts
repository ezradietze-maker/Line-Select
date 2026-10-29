import { useSyncExternalStore } from "react";
import type { TimeMode } from "@/lib/trip-timeline";

const KEY = "line-select:time-mode:v1";
/** Told to every month calendar on the page when the pilot switches clocks, so they all switch together. */
const CHANGED = "line-select:time-mode-changed";

/** Local — a pilot's actual lived experience of a trip only makes sense in local time, and every other timestamp already shown elsewhere in this app (report times, layover durations) is local-first, so a first-time visitor lands on the toggle's more familiar side. */
const DEFAULT_MODE: TimeMode = "local";

export function loadTimeMode(): TimeMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "local" || raw === "zulu" ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function saveTimeMode(mode: TimeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // ignore — quota exceeded or unavailable
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The pilot's clock, Local or Zulu, as one setting every month calendar on the page reads — switching one switches
 * them all, and it's remembered. The server and the first paint are always Local.
 */
export function useTimeMode(): [TimeMode, (mode: TimeMode) => void] {
  const mode = useSyncExternalStore(subscribe, loadTimeMode, () => DEFAULT_MODE);
  return [mode, saveTimeMode];
}
