import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { distanceKm } from "@/lib/metrics/home-travel";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * The airline travel each trip asks of a commuter, in real time: getting to
 * base before a report, flying from home straight to where a trip's flying
 * starts (deviating onto a front-end deadhead), and getting home after the
 * last flight — each a window of real clock time, with the pilot's own
 * buffers. The flight data (`lib/flights/itineraries.ts`, `/api/flights/travel`)
 * then counts the real flights that fit each window.
 */

export type NeedKind = "toBase" | "deviateOut" | "homeFromBase" | "deviateHome";

export interface TravelNeed {
  /** Trip key + kind — the same trip in many lines asks the same thing once. */
  id: string;
  /** The trip's `travelKey`. */
  tripId: string;
  kind: NeedKind;
  from: string[];
  to: string[];
  /** For getting somewhere: the latest arrival that still works, and the earliest departure worth counting. For getting home: the earliest departure. Epoch ms. */
  arriveBy?: number;
  departAfter: number;
  /** The end of the window: departures after this don't count. */
  departBefore: number;
}

export interface TravelParams {
  homeAirports: string[];
  /** Hours at base before a report. */
  commuteBufferHours: number;
  /** Hours before the first operated leg when deviating onto a front-end deadhead. */
  frontBufferHours: number;
  /** Rest after the last operated leg before heading home on your own. */
  backRestHours: number;
}

const HOUR = 3_600_000;
/** Block-in to walking out of the airport after a trip that ends at base. */
const RELEASE_TO_CURB_MS = 1 * HOUR;
/** How far ahead of a deadline a pilot would realistically start out (or, going home, how long after he's free he'd still wait) — a day, or longer when the flying is long-haul. */
const LOOKBACK_MS = 24 * HOUR;
const LONG_HAUL_LOOKBACK_MS = 40 * HOUR;
const LONG_HAUL_KM = 4500;

function lookbackFor(from: string[], to: string[]): number {
  const far = from.some((a) => to.some((b) => (distanceKm(a, b) ?? 0) > LONG_HAUL_KM));
  return far ? LONG_HAUL_LOOKBACK_MS : LOOKBACK_MS;
}

/**
 * The trip's first report as a real instant: the trip's calendar date in the bid period (from the line's own
 * calendar) at the printed report time, in the base's time zone. (A trip's stored clock anchor can belong to an
 * earlier run of the same pairing, so it isn't used for dates.)
 */
export function tripStartUtc(bidPack: Pick<BidPack, "bidPeriodStart" | "base">, trip: Trip): number | null {
  if (!bidPack.bidPeriodStart || trip.startDayIndex === null || !trip.schedule[0]) return null;
  const zone = timezoneForAirport(bidPack.base);
  const hhmm = trip.schedule[0].reportTimeLocal;
  if (!zone || !/^\d{4}$/.test(hhmm)) return null;
  const day = DateTime.fromISO(bidPack.bidPeriodStart, { zone }).plus({
    days: trip.startDayIndex,
  });
  const at = day.set({
    hour: Number(hhmm.slice(0, 2)),
    minute: Number(hhmm.slice(2, 4)),
    second: 0,
    millisecond: 0,
  });
  return at.isValid ? at.toMillis() : null;
}

/** One run of a pairing: the same pairing flown on different dates in a month shares an id but not its flights. */
export const travelKey = (trip: Pick<Trip, "id" | "startDayIndex">) => `${trip.id}@${trip.startDayIndex ?? "?"}`;

export function travelNeedsForTrip(bidPack: Pick<BidPack, "bidPeriodStart" | "base">, trip: Trip, p: TravelParams): TravelNeed[] {
  const start = tripStartUtc(bidPack, trip);
  if (start === null || p.homeAirports.length === 0) return [];
  const f = computeTripFacts(trip);
  if (f.noFlying && f.duties.every((d) => !d.standby)) return [];
  const at = (minutes: number) => start + minutes * 60_000;
  const home = p.homeAirports;
  const needs: TravelNeed[] = [];
  const add = (n: Omit<TravelNeed, "id" | "tripId">) => {
    if (n.from.some((a) => n.to.includes(a))) return;
    needs.push({
      ...n,
      id: `${travelKey(trip)}:${n.kind}`,
      tripId: travelKey(trip),
    });
  };

  // Out: commute to base for the first report — and, when the flying starts somewhere else after a deadhead, fly from
  // home straight there instead. Both are asked; the pilot takes whichever works better.
  const toBaseBy = start - p.commuteBufferHours * HOUR;
  add({
    kind: "toBase",
    from: home,
    to: [bidPack.base],
    arriveBy: toBaseBy,
    departAfter: toBaseBy - lookbackFor(home, [bidPack.base]),
    departBefore: toBaseBy,
  });
  const firstFlying = f.legs.find((l) => !l.deadhead);
  if (f.front?.city && firstFlying) {
    const frontCity = f.front.city;
    const arriveBy = at(firstFlying.start) - p.frontBufferHours * HOUR;
    add({
      kind: "deviateOut",
      from: home,
      to: [frontCity],
      arriveBy,
      departAfter: arriveBy - lookbackFor(home, [frontCity]),
      departBefore: arriveBy,
    });
  }

  // Home: commute home from base after the release — and, when the trip ends with a deadhead, straight home from where
  // the flying ends instead.
  const lastFlying = [...f.legs].reverse().find((l) => !l.deadhead);
  const lastStandby = f.duties.flatMap((d) => d.standbyLegs).at(-1);
  const lastLeg = f.legs.at(-1);
  const releasedAt = at(Math.max(lastLeg?.end ?? 0, lastStandby?.end ?? 0)) + RELEASE_TO_CURB_MS;
  add({
    kind: "homeFromBase",
    from: [bidPack.base],
    to: home,
    departAfter: releasedAt,
    departBefore: releasedAt + lookbackFor([bidPack.base], home),
  });
  if (f.back?.city && lastFlying) {
    const departAfter = at(Math.max(lastFlying.end, lastStandby?.end ?? 0)) + p.backRestHours * HOUR;
    add({
      kind: "deviateHome",
      from: [f.back.city],
      to: home,
      departAfter,
      departBefore: departAfter + lookbackFor([f.back.city], home),
    });
  }
  return needs;
}

/**
 * Every distinct trip's needs across the given lines (all of them by default) — the same trip in many lines is asked
 * about once. Callers pass the lines that matter (a pilot's top-ranked ones) to keep lookups to what decides a bid.
 */
export function travelNeedsForPack(bidPack: BidPack, p: TravelParams, lines = bidPack.lines): TravelNeed[] {
  const seen = new Set<string>();
  const out: TravelNeed[] = [];
  for (const line of lines) {
    if (line.estimated) continue;
    for (const trip of line.trips) {
      if (seen.has(travelKey(trip))) continue;
      seen.add(travelKey(trip));
      out.push(...travelNeedsForTrip(bidPack, trip, p));
    }
  }
  return out;
}
