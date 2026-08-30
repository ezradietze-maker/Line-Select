import type { TimeMode } from "@/lib/trip-timeline";

const KEY = "line-select:time-mode:v1";

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
}
