import { backupsOf, type TravelAnswer } from "@/lib/flights/itineraries";
import { travelKey, tripStartUtc, type NeedKind } from "@/lib/flights/needs";
import type { RealTravel } from "@/lib/metrics/home-travel";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * Reading a pilot's looked-up flights back per trip: what the commute
 * measures and the time-away measures use, and what the trip list shows.
 * Answers are keyed by need id (`travelKey:kind`); a trip with none of its own
 * wasn't looked up (it wasn't in the lines that decide the bid), and its
 * measures fall back to estimates or to "unknown".
 */

export type FlightAnswers = Record<string, TravelAnswer>;

const answer = (fa: FlightAnswers, tripId: string, kind: NeedKind): TravelAnswer | undefined => fa[`${tripId}:${kind}`];

export interface TripFlights {
  toBase?: TravelAnswer;
  deviateOut?: TravelAnswer;
  homeFromBase?: TravelAnswer;
  deviateHome?: TravelAnswer;
}

export function flightsForTrip(fa: FlightAnswers | undefined, trip: Pick<Trip, "id" | "startDayIndex">): TripFlights | null {
  if (!fa) return null;
  const tripId = travelKey(trip);
  const out: TripFlights = {
    toBase: answer(fa, tripId, "toBase"),
    deviateOut: answer(fa, tripId, "deviateOut"),
    homeFromBase: answer(fa, tripId, "homeFromBase"),
    deviateHome: answer(fa, tripId, "deviateHome"),
  };
  return out.toBase || out.deviateOut || out.homeFromBase || out.deviateHome ? out : null;
}

/** Backups on the better way to work (to base, or straight to where the flying starts); null when neither was looked up. */
export function backupsToWork(t: TripFlights): number | null {
  const ways = [t.toBase, t.deviateOut].filter((a): a is TravelAnswer => !!a);
  return ways.length ? Math.max(...ways.map(backupsOf)) : null;
}

/**
 * The earliest real arrival home (epoch ms); when nothing gets him home inside the searched window, the window's end —
 * he's home no sooner than that. Null when going home wasn't looked up.
 */
export function earliestHome(t: TripFlights): number | null {
  const ways = [t.homeFromBase, t.deviateHome].filter((a): a is TravelAnswer => !!a);
  if (!ways.length) return null;
  return Math.min(...ways.map((a) => a.firstArrival ?? a.window[1]));
}

/** A trip's looked-up flights as times on the trip's own clock, for the time-away measures. */
export function realTravelForTrip(fa: FlightAnswers | undefined, bidPack: Pick<BidPack, "bidPeriodStart" | "base">, trip: Trip): RealTravel {
  const t = flightsForTrip(fa, trip);
  if (!t) return {};
  const start = tripStartUtc(bidPack, trip);
  if (start === null) return {};
  const min = (ms: number) => (ms - start) / 60_000;
  const leave = (a: TravelAnswer | undefined) => (a === undefined ? undefined : a.lastDeparture === null ? null : min(a.lastDeparture));
  const home = (a: TravelAnswer | undefined) => (a === undefined ? undefined : a.firstArrival === null ? null : min(a.firstArrival));
  return {
    leaveBase: leave(t.toBase),
    leaveDeviate: leave(t.deviateOut),
    homeBase: home(t.homeFromBase),
    homeDeviate: home(t.deviateHome),
  };
}
