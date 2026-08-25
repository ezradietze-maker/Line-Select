import type { BidPack, Trip } from "@/types/bidpack";

function bidPackKey(userId: string | null): string {
  return userId ? `line-select:bidpack:${userId}:v1` : "line-select:bidpack:guest:v1";
}

/**
 * Backfills fields that didn't exist yet when a bid pack was saved (same
 * reasoning as `normalizeProfile` in storage.ts) — a bid pack saved by an
 * older version of the app shouldn't crash the newer one just because a
 * trip predates a field like `layoverDetails`.
 */
function normalizeBidPack(parsed: BidPack): BidPack {
  return {
    ...parsed,
    lines: parsed.lines.map((line) => ({
      ...line,
      trips: line.trips.map(
        (trip): Trip => ({
          ...trip,
          layoverDetails: trip.layoverDetails ?? [],
          schedule: trip.schedule ?? [],
        })
      ),
    })),
  };
}

export function saveBidPack(userId: string | null, bidPack: BidPack): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(bidPackKey(userId), JSON.stringify(bidPack));
  } catch {
    // ignore — quota exceeded or unavailable
  }
}

export function loadBidPack(userId: string | null): BidPack | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(bidPackKey(userId));
    return raw ? normalizeBidPack(JSON.parse(raw) as BidPack) : null;
  } catch {
    return null;
  }
}

export function clearBidPack(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(bidPackKey(userId));
  } catch {
    // ignore
  }
}
