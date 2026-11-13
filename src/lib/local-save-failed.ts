/**
 * Sent on `window` when the browser refuses one of the small saves behind a pilot's list — a tier move, a star, a swap,
 * the sort. They only live on this device, so a refused one is gone on the next load: the app state listens for this
 * and says so (`listSaveFailed`), the way it does for a pack the browser wouldn't keep.
 */
export const LOCAL_SAVE_FAILED_EVENT = "line-select:local-save-failed";

/** Writes `value` under `key`, and returns whether the browser kept it — telling the app when it didn't. */
export function saveOrReport(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Storage full or blocked: the change works for now, and the pilot is told it won't survive a refresh.
    if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(LOCAL_SAVE_FAILED_EVENT));
    return false;
  }
}
