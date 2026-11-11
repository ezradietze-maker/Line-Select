/**
 * Which trade offers a pilot has looked at in the Inbox, kept per account on this device: held only in memory, a
 * reload counted every one of them on the Inbox badge again.
 */

/** Far more than one month's board: the oldest go first. */
const MAX_KEPT = 500;

function seenKey(userId: string): string {
  return `line-select:trade-offers-seen:${userId}:v1`;
}

export function loadSeenOfferIds(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(seenKey(userId)) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveSeenOfferIds(userId: string, ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(seenKey(userId), JSON.stringify([...ids].slice(-MAX_KEPT)));
  } catch {
    // ignore — the badge just counts them again next visit
  }
}

/** The offers already there when a pilot's board for one pack was first loaded, and since. */
export interface ToastBaseline {
  /** Whose board, and which pack's. */
  key: string;
  known: ReadonlySet<string>;
}

/**
 * Which offers have just arrived, to toast. The first successful load of a pilot's board for a pack is the baseline:
 * what's there already is the backlog the Inbox badge counts, not news. Starting from an empty list before that load
 * toasted the whole backlog on every page load. A new pilot or pack starts a new baseline.
 */
export function newArrivals(prev: ToastBaseline | null, key: string, ids: readonly string[]): { baseline: ToastBaseline; fresh: string[] } {
  const baseline = { key, known: new Set(ids) };
  if (!prev || prev.key !== key) return { baseline, fresh: [] };
  return { baseline, fresh: ids.filter((id) => !prev.known.has(id)) };
}
