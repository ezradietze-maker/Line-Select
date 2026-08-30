import { monthAnchorZulu } from "@/lib/pdf-parser/build-bidpack";
import type { BidPack, Trip, TripDutyPeriod } from "@/types/bidpack";

function bidPackKey(userId: string | null): string {
  return userId ? `line-select:bidpack:${userId}:v1` : "line-select:bidpack:guest:v1";
}

function zuluAt(anchorISO: string, minutes: number): string {
  return new Date(new Date(anchorISO).getTime() + minutes * 60_000).toISOString();
}

/** Backfills a trip saved before the Zulu/Local toggle existed — same anchor-plus-elapsed-minutes math `build-bidpack.ts` uses for a freshly-parsed trip, just applied after the fact using the bid pack's own saved month. */
function backfillZuluFields(trip: Trip, bidPackMonth: string): Trip {
  if (trip.zuluAnchor) return trip;
  const anchor = monthAnchorZulu(bidPackMonth);
  const schedule: TripDutyPeriod[] = trip.schedule.map((duty) => ({
    ...duty,
    legs: duty.legs.map((leg) => ({
      ...leg,
      depTimeZulu: leg.depTimeZulu ?? zuluAt(anchor, leg.startMinutes),
      arrTimeZulu: leg.arrTimeZulu ?? zuluAt(anchor, leg.endMinutes),
    })),
  }));
  return { ...trip, schedule, zuluAnchor: anchor };
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
    lines: parsed.lines.map((line) => {
      const trips = line.trips.map(
        (trip): Trip =>
          backfillZuluFields(
            {
              ...trip,
              layoverDetails: trip.layoverDetails ?? [],
              schedule: trip.schedule ?? [],
              pairingNumber: trip.pairingNumber ?? null,
              departures: trip.departures ?? (trip.layoverDetails?.length ?? 0) + 1,
            },
            parsed.month
          )
      );
      return {
        ...line,
        trips,
        totalDepartures: line.totalDepartures ?? trips.reduce((s, t) => s + t.departures, 0),
      };
    }),
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
