/**
 * "Start over" heard in every tab. A second tab left open on the rankings kept the deleted pack and profile on screen,
 * and its next star, tier move or tick wrote them back: the profile to the account, the list to the device. So the tab
 * that starts over leaves a mark on the device; the others hear it (a storage event, or on being looked at again, for
 * a tab the browser had put to sleep) and drop what they hold, and a tab that hasn't caught up yet sends no profile.
 */
const KEY = "line-select:started-over:v1";

interface StartOverMark {
  /** Whose work was deleted: the signed-in pilot's id, or null for a guest. */
  userId: string | null;
  at: number;
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): StartOverMark | null {
  try {
    const mark = raw ? (JSON.parse(raw) as StartOverMark) : null;
    return mark && typeof mark.at === "number" ? { userId: typeof mark.userId === "string" ? mark.userId : null, at: mark.at } : null;
  } catch {
    return null;
  }
}

/** The mark as this tab last knew it: on loading, its own Start over, or the last one it caught up with. */
let seen: string | null = typeof window === "undefined" ? null : read();

/** Called by the tab starting over, after it has deleted the work. */
export function announceStartOver(userId: string | null): void {
  const value = JSON.stringify({ userId, at: Date.now() } satisfies StartOverMark);
  seen = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Storage unavailable: no other tab could have kept anything here to put back either.
  }
}

/** Whose work another tab deleted since this one last caught up — null when nothing has been, or it was another pilot's. */
function startedOverElsewhereFor(userId: string | null): StartOverMark | null {
  const now = read();
  if (now === seen) return null;
  const mark = parse(now);
  return mark && mark.userId === userId ? mark : null;
}

/** Whether `userId`'s work was deleted in another tab and this one hasn't caught up: its saves would put it back. */
export const staleAfterStartOver = (userId: string | null): boolean => startedOverElsewhereFor(userId) !== null;

/** This tab has dropped what it held: its saves from here on are of new work. */
export function caughtUpWithStartOver(): void {
  seen = read();
}

/**
 * Calls `onStartedOver` when another tab starts over for `userId`: straight away for a tab open alongside it, and when
 * a tab put to sleep in the background is looked at again.
 */
export function onStartOverElsewhere(userId: string | null, onStartedOver: () => void): () => void {
  const check = () => {
    if (startedOverElsewhereFor(userId)) onStartedOver();
    // Another pilot's Start over (an account signed in here before) isn't this one's to act on.
    else if (read() !== seen) caughtUpWithStartOver();
  };
  const onStorage = (e: StorageEvent) => e.key === KEY && check();
  const onVisible = () => document.visibilityState === "visible" && check();
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", check);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
