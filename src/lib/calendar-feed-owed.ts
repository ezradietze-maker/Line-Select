/**
 * "Start over" turns the pilot's calendar link off (it showed the line the deleted ranking put first). Sent once, a
 * failure (no signal, the server busy) left the link on for good. So the device keeps it owed, for that account, until
 * the server says it's off: asked again on the next load and when the connection comes back (app-state), and dropped
 * when the pilot makes a new link. Apart from `calendar-feed-client` so every screen can check it without loading that.
 */
const KEY = "line-select:calendar-feed-off-owed:v1";

/** The account whose link this device still owes turning off, if any. */
export function feedOffOwed(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function oweFeedOff(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(KEY, userId);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: only this visit's try.
  }
}
