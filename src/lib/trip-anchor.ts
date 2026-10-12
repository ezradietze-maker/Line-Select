import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import type { Trip, TripDutyPeriod } from "@/types/bidpack";

/**
 * Pinning a trip to the real clock. Every time in a trip is kept as elapsed
 * minutes since its first report (t=0), and turned into real instants from
 * one anchor: the report itself. The bid pack's line grid gives the
 * report's date — in the base's own local calendar (a 19:45 Anchorage
 * report on Mon Sep 28 sits on Sep 28, though the pairing pages call it
 * Tue Sep 29, the GMT date) — and the pairing prints its local time, so the
 * anchor is that local date and time at the base, as a real instant.
 *
 * Everything drawn in local time is converted from these instants with each
 * airport's real time-zone rules, so the anchor's date has to be the trip's
 * own: anchored to some other date, a trip on the far side of a
 * daylight-saving change (Europe in late October, Australia in early
 * October) draws every flight an hour off its printed local time.
 */

/** The trip's first report as a real instant (epoch ms), or null without a grid date, a known base zone or a printed report time. */
export function tripReportUtc(bidPack: { bidPeriodStart: string | null; base: string }, trip: Pick<Trip, "startDayIndex" | "schedule">): number | null {
  if (!bidPack.bidPeriodStart || trip.startDayIndex === null || !trip.schedule[0]) return null;
  const zone = timezoneForAirport(bidPack.base);
  const hhmm = trip.schedule[0].reportTimeLocal;
  if (!zone || !/^\d{4}$/.test(hhmm)) return null;
  const at = DateTime.fromISO(bidPack.bidPeriodStart, { zone })
    .plus({ days: trip.startDayIndex })
    .set({ hour: Number(hhmm.slice(0, 2)), minute: Number(hhmm.slice(2, 4)), second: 0, millisecond: 0 });
  return at.isValid ? at.toMillis() : null;
}

const zuluAt = (anchorMs: number, minutes: number) => new Date(anchorMs + minutes * 60_000).toISOString();

/** The same trip with its anchor and every leg's real instants set from `anchorMs` (the report). */
export function anchorTripAt(trip: Trip, anchorMs: number): Trip {
  const schedule: TripDutyPeriod[] = trip.schedule.map((duty) => ({
    ...duty,
    legs: duty.legs.map((leg) => ({ ...leg, depTimeZulu: zuluAt(anchorMs, leg.startMinutes), arrTimeZulu: zuluAt(anchorMs, leg.endMinutes) })),
  }));
  return { ...trip, schedule, zuluAnchor: new Date(anchorMs).toISOString() };
}

/** Anchors a trip to its own real date when the grid placed it; otherwise leaves it as it is. */
export function anchorTripToItsDate(bidPack: { bidPeriodStart: string | null; base: string }, trip: Trip): Trip {
  const at = tripReportUtc(bidPack, trip);
  return at === null ? trip : anchorTripAt(trip, at);
}
