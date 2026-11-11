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

/**
 * Hours from a trip's first report to its release: TAFB as printed. Except a run of the same day trip on consecutive
 * days, which the parser keeps as one trip (`mergeConsecutiveOneDayTrips`): its TAFB is the days' sum, so report plus
 * TAFB ended a three-day run part way through its first night, and its second and third days were free to View/Add,
 * Open Time, vacation and carry-in. Such a run is known by its last day reporting after that sum would have it home.
 */
export function tripReleaseHours(trip: Pick<Trip, "tafbHours" | "schedule">): number {
  const last = trip.schedule[trip.schedule.length - 1];
  if (!last || trip.schedule.length < 2 || last.startMinutes / 60 < trip.tafbHours) return trip.tafbHours;
  return last.startMinutes / 60 + dayTripHours(trip);
}

/** One day's report to release in such a run: its days are the same pairing, so each is the same length. */
export function dayTripHours(trip: Pick<Trip, "tafbHours" | "schedule">): number {
  return trip.tafbHours / Math.max(1, trip.schedule.length);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Such a run as the day trips it is, for matching a trip someone pasted (open time, View/Add): a pilot picks up the
 * one day, and kept whole it was scored as all three, with the first day's deadline. Any other trip is as it is.
 */
export function dayTripsOf(trip: Trip): Trip[] {
  if (tripReleaseHours(trip) === trip.tafbHours) return [trip];
  const n = trip.schedule.length;
  return trip.schedule.map((duty, i) => {
    const shift = duty.startMinutes;
    const back = (m: number) => m - shift;
    const legs = duty.legs.map((l) => ({ ...l, startMinutes: back(l.startMinutes), endMinutes: back(l.endMinutes) }));
    return {
      ...trip,
      days: 1,
      startDayIndex: trip.startDayIndex === null ? null : trip.startDayIndex + i,
      creditHours: round2(trip.creditHours / n),
      tafbHours: round2(trip.tafbHours / n),
      landings: legs.filter((l) => !l.isDeadhead).length,
      departures: legs.filter((l) => !l.isDeadhead).length,
      deadheadLegs: legs.filter((l) => l.isDeadhead).length,
      dutyPeriods: 1,
      layoverCities: [],
      layoverDetails: [],
      zuluAnchor: trip.zuluAnchor ? new Date(Date.parse(trip.zuluAnchor) + shift * 60_000).toISOString() : trip.zuluAnchor,
      schedule: [{ ...duty, startMinutes: 0, legs, layover: null }],
    };
  });
}

/** The trip's first report as a real instant (epoch ms), or null without a grid date, a known base zone or a printed report time. */
export function tripReportUtc(bidPack: { bidPeriodStart: string | null; base: string }, trip: Pick<Trip, "startDayIndex" | "schedule">): number | null {
  if (!bidPack.bidPeriodStart || trip.startDayIndex === null || !trip.schedule[0]) return null;
  const zone = timezoneForAirport(bidPack.base);
  const hhmm = trip.schedule[0].reportTimeLocal;
  if (!zone || !/^\d{4}$/.test(hhmm)) return null;
  const at = DateTime.fromISO(bidPack.bidPeriodStart, { zone })
    .plus({ days: trip.startDayIndex })
    .set({ hour: Number(hhmm.slice(0, 2)), minute: Number(hhmm.slice(2, 4)), second: 0, millisecond: 0 });
  if (!at.isValid) return null;
  // The hour the clocks go back happens twice, and luxon takes the first. The printed GMT times settle which: the
  // first leg's GMT departure less its minutes from report is the report in GMT.
  const later = at.plus({ hours: 1 });
  if (later.hour === at.hour && later.minute === at.minute) {
    const leg = trip.schedule[0].legs[0];
    if (leg && /^\d{4}$/.test(leg.depTimeGmt ?? "")) {
      const reportGmt = (((Number(leg.depTimeGmt.slice(0, 2)) * 60 + Number(leg.depTimeGmt.slice(2)) - leg.startMinutes) % 1440) + 1440) % 1440;
      const utcMinute = (t: DateTime) => t.toUTC().hour * 60 + t.toUTC().minute;
      if (utcMinute(later) === reportGmt) return later.toMillis();
    }
  }
  return at.toMillis();
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
