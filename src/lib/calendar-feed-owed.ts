/**
 * "Start over" turns the pilot's calendar link off (it showed the line the deleted ranking put first). Sent once, a
 * failure (no signal, the server busy) left the link on for good. So the device keeps it owed, for that account, until
 * the server says it's off: asked again on the next load and when the connection comes back (app-state), and dropped
 * when the pilot makes a new link. Apart from `calendar-feed-client` so every screen can check it without loading that.
 * It keeps when it was owed too: paid later, it turns off only a link made by then, not one the pilot has made since on
 * another device.
 */
const KEY = "line-select:calendar-feed-off-owed:v1";

interface Owed {
  userId: string;
  /** When the Start over was, as an ISO time; null for a note kept before the time was. */
  at: string | null;
}

function readOwed(): Owed | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const owed = JSON.parse(raw) as Partial<Owed> | null;
    if (owed && typeof owed.userId === "string") return { userId: owed.userId, at: typeof owed.at === "string" ? owed.at : null };
  } catch {
    // An account id on its own, as the note was first kept.
  }
  return { userId: raw, at: null };
}

/** The account whose link this device still owes turning off, if any. */
export function feedOffOwed(): string | null {
  return readOwed()?.userId ?? null;
}

/** When the turning off still owed was asked for (an ISO time), if this device keeps it. */
export function feedOffOwedSince(): string | null {
  return readOwed()?.at ?? null;
}

export function oweFeedOff(userId: string | null, at = new Date().toISOString()): void {
  try {
    if (userId) window.localStorage.setItem(KEY, JSON.stringify({ userId, at }));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: only this visit's try.
  }
}
