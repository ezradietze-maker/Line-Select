import { monthAnchorZulu } from "@/lib/pdf-parser/build-bidpack";
import { tripDutyPeriods } from "@/lib/duty-periods";
import { backfillDeadheads } from "@/lib/deadhead";
import { backfillStandby } from "@/lib/standby";
import { anchorTripToItsDate } from "@/lib/trip-anchor";
import type { BidPack, Trip, TripDutyPeriod } from "@/types/bidpack";

function bidPackKey(userId: string | null): string {
  return userId ? `line-select:bidpack:${userId}:v1` : "line-select:bidpack:guest:v1";
}

function zuluAt(anchorISO: string, minutes: number): string {
  return new Date(new Date(anchorISO).getTime() + minutes * 60_000).toISOString();
}

/** Backfills a trip saved before the Zulu/Local toggle existed — same anchor-plus-elapsed-minutes math `build-bidpack.ts` uses for a freshly-parsed trip, just applied after the fact using the bid pack's own saved month. */
function backfillZuluFields(trip: Trip, bidPackMonth: string): Trip {
  // A trip with its own anchor just needs any left-out per-leg timestamps rebuilt from it (see `compactBidPack`); one without an anchor predates the Zulu toggle entirely and gets the month's.
  const anchor = trip.zuluAnchor || monthAnchorZulu(bidPackMonth);
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
 * Pins a saved trip to its own real date. Packs saved before trips were
 * anchored that way carry an anchor on the 1st of the month, which draws a
 * trip on the far side of a daylight-saving change an hour off its printed
 * local times (see `trip-anchor.ts`); re-anchoring here fixes them without a
 * re-upload. A merged run of one-day trips keeps its days' spacing.
 */
function anchorStored(pack: BidPack, trip: Trip): Trip {
  return pack.base ? anchorTripToItsDate(pack, trip) : trip;
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
          anchorStored(parsed, backfillDeadheads(backfillStandby(backfillZuluFields(
            {
              ...trip,
              layoverDetails: trip.layoverDetails ?? [],
              schedule: trip.schedule ?? [],
              pairingNumber: trip.pairingNumber ?? null,
              // Departures are landings — a trip saved when they were counted another way (duty periods, or with standby days mixed in) is corrected here.
              departures: trip.landings,
              // Saved before duty periods were tracked as their own number: the old "departures" was exactly this count (layovers + 1), so rebuild it from the trip itself.
              dutyPeriods: trip.dutyPeriods ?? (trip.layoverDetails?.length ?? 0) + 1,
            },
            parsed.month
          ))))
      );
      return {
        ...line,
        trips,
        // Always the sum of the (possibly just-corrected) trips, never a stored total that may predate a change to how departures are counted.
        totalDepartures: trips.reduce((s, t) => s + t.departures, 0),
        totalDutyPeriods: line.totalDutyPeriods ?? trips.reduce((s, t) => s + tripDutyPeriods(t), 0),
      };
    }),
  };
}

/**
 * What's actually written to the browser. A parsed pack repeats every
 * pairing once for each line that flies it (a busy pack has the same trip in
 * dozens of lines) and carries a full ISO timestamp on every leg that's just
 * the trip's anchor plus its elapsed minutes. Stored as-is, the biggest real
 * packs came to 4.5MB — right at a browser's roughly 5MB limit, where a save
 * that failed silently meant the pilot's pack vanished on the next refresh.
 * So each distinct trip is written once and lines point at it, and the
 * derivable timestamps are left out and rebuilt on load.
 */
interface CompactPack extends Omit<BidPack, "lines"> {
  format: 2;
  tripTable: Record<string, Trip>;
  lines: (Omit<BidPack["lines"][number], "trips"> & { trips: { ref: string; startDayIndex: number | null }[] })[];
}

/** A trip without what loading rebuilds: each leg's instants, and — for a trip the grid dated — its anchor, which comes back from its date (see `anchorStored`), so every run of a pairing is stored once. */
function withoutDerivedZulu(trip: Trip, dated = false): Trip {
  if (!trip.zuluAnchor && !dated) return trip;
  return {
    ...trip,
    ...(dated ? { zuluAnchor: "" } : {}),
    schedule: trip.schedule.map((duty) => ({
      ...duty,
      legs: duty.legs.map((leg) => {
        const { depTimeZulu: _dep, arrTimeZulu: _arr, ...rest } = leg;
        void _dep;
        void _arr;
        return rest as typeof leg;
      }),
    })),
  };
}

export function compactBidPack(pack: BidPack): CompactPack {
  const tripTable: Record<string, Trip> = {};
  const lines = pack.lines.map((line) => ({
    ...line,
    trips: line.trips.map((trip, i) => {
      const { startDayIndex, ...rest } = trip;
      const stored = withoutDerivedZulu({ ...rest, startDayIndex: null }, startDayIndex !== null && !!pack.bidPeriodStart && !!pack.base);
      // Same id, different content (a layover whose hotel changes with the trip's date) is kept under its own key rather than losing data.
      let key = trip.id;
      const existing = tripTable[key];
      if (existing && JSON.stringify(existing) !== JSON.stringify(stored)) key = `${trip.id}#${line.id}#${i}`;
      tripTable[key] ??= stored;
      return { ref: key, startDayIndex };
    }),
  }));
  return { ...pack, format: 2, tripTable, lines };
}

function isCompact(value: unknown): value is CompactPack {
  return typeof value === "object" && value !== null && (value as { format?: unknown }).format === 2;
}

export function expandBidPack(stored: BidPack | CompactPack): BidPack {
  if (!isCompact(stored)) return stored;
  const { tripTable, format: _format, lines, ...rest } = stored;
  void _format;
  return {
    ...rest,
    lines: lines.map((line) => ({
      ...line,
      trips: line.trips.map(({ ref, startDayIndex }) => ({ ...tripTable[ref], startDayIndex })),
    })),
  } as BidPack;
}

/** A stored pack exactly as the app loads it (expanded, with every left-out field rebuilt) — for scripts working outside the browser. */
export function restoreBidPack(stored: BidPack | CompactPack): BidPack {
  return normalizeBidPack(expandBidPack(stored));
}

/** Returns false when the browser refused the write (storage full or unavailable), so the caller can tell the pilot their pack won't survive a refresh. */
export function saveBidPack(userId: string | null, bidPack: BidPack): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(bidPackKey(userId), JSON.stringify(compactBidPack(bidPack)));
    return true;
  } catch {
    return false;
  }
}

export function loadBidPack(userId: string | null): BidPack | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(bidPackKey(userId));
    return raw ? normalizeBidPack(expandBidPack(JSON.parse(raw) as BidPack | CompactPack)) : null;
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
