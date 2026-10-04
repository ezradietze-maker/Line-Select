/**
 * A pilot-entered bid-close date/time, per bid pack. Deliberately not
 * derived from anything printed in the pack — `BidPack` only carries
 * `bidPeriodStart` (when the SCHEDULE period begins), not when bidding
 * itself closes, and the two are different dates. Guessing one from the
 * other would risk telling a pilot the wrong real-world deadline for
 * something that actually matters, so this stays exactly what they typed,
 * nothing inferred.
 */

function deadlineKey(bidPackId: string): string {
  return `line-select:bid-deadline:${bidPackId}:v1`;
}

/** ISO datetime string, or null if the pilot hasn't set one for this bid pack. */
export function getBidDeadline(bidPackId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(deadlineKey(bidPackId));
  } catch {
    return null;
  }
}

export function setBidDeadline(bidPackId: string, iso: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (iso) window.localStorage.setItem(deadlineKey(bidPackId), iso);
    else window.localStorage.removeItem(deadlineKey(bidPackId));
  } catch {
    // ignore, same as the rest of this storage family
  }
}
