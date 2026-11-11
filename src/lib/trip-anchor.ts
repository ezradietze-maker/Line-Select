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

/** One day of a run of the same day trip: its duties (by index into the schedule), when it reports, and how long it runs. */
export interface RunDay {
  first: number;
  last: number;
  /** Its report, in minutes after the run's first report. */
  startMinutes: number;
  /** Report to release. The days are the same pairing, so each is the same length. */
  hours: number;
}

/**
 * The days of a run of the same day trip on consecutive days, which the parser keeps as one trip
 * (`mergeConsecutiveOneDayTrips`); null for any other trip. Its TAFB is the days' sum, and a day can be two duties with
 * a hotel between them. The parser records where each day starts (`runStarts`); a pack read before it did is known by
 * its shape: a day trip comes home with no layover, so a duty with none before the last is the end of a day.
 */
export function runDaysOf(trip: Pick<Trip, "tafbHours" | "schedule" | "runStarts">): RunDay[] | null {
  const n = trip.schedule.length;
  if (n < 2) return null;
  const starts = trip.runStarts?.length ? trip.runStarts : [0, ...trip.schedule.flatMap((d, i) => (i < n - 1 && !d.layover ? [i + 1] : []))];
  if (starts.length < 2 || starts.some((s) => s < 0 || s >= n)) return null;
  const hours = trip.tafbHours / starts.length;
  return starts.map((first, k) => ({ first, last: (starts[k + 1] ?? n) - 1, startMinutes: trip.schedule[first].startMinutes, hours }));
}

/**
 * Hours from a trip's first report to its release: TAFB as printed, except for a run of day trips, which ends its last
 * day's length after that day reports. Report plus the summed TAFB ended a three-day run part way through its first
 * night, and its second and third days were free to View/Add, Open Time, vacation and carry-in.
 */
export function tripReleaseHours(trip: Pick<Trip, "tafbHours" | "schedule" | "runStarts">): number {
  const days = runDaysOf(trip);
  const last = days?.[days.length - 1];
  return last ? last.startMinutes / 60 + last.hours : trip.tafbHours;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const MINUTES_PER_DAY = 1440;

/**
 * A run as the day trips it is, for matching a trip someone pasted (open time, View/Add): a pilot picks up the one
 * day, and kept whole it was scored as all three, with the first day's deadline. Each day keeps all its duties and its
 * own date. Any other trip is as it is.
 */
export function dayTripsOf(trip: Trip): Trip[] {
  const known = piecesOf.get(trip);
  if (known) return known;
  const pieces = splitRun(trip);
  piecesOf.set(trip, pieces);
  if (pieces.length > 1) pieces.forEach((piece, i) => runOf.set(piece, { run: trip, day: runDaysOf(trip)![i], index: i }));
  return pieces;
}

/**
 * Kept per trip, so a day is the same object each time it's asked for: the tools that take one day off a line (a
 * vacation, a carry-in conflict, a trip given up in open time) find it again among the line's days.
 */
const piecesOf = new WeakMap<Trip, Trip[]>();
const runOf = new WeakMap<Trip, { run: Trip; day: RunDay; index: number }>();

/** The run a day came from (see `dayTripsOf`), and which day it is; null for any other trip. */
export function runOfDay(trip: Trip): { run: Trip; day: RunDay; index: number } | null {
  return runOf.get(trip) ?? null;
}

/**
 * Days of runs back into runs: each unbroken stretch of a run's days, as one shorter run. Taken a day at a time when a
 * vacation or carry-in hits one, a run's other days were left as separate one-day trips, and scored as more trips and
 * more commutes: a line fell for nothing but a day off it. Any other trip is as it is.
 */
export function rejoinRunDays(trips: Trip[]): Trip[] {
  const out: Trip[] = [];
  for (let i = 0; i < trips.length; i++) {
    const of = runOf.get(trips[i]);
    if (!of) {
      out.push(trips[i]);
      continue;
    }
    const group = [trips[i]];
    while (i + 1 < trips.length) {
      const next = runOf.get(trips[i + 1]);
      if (!next || next.run !== of.run || next.index !== runOf.get(group[group.length - 1])!.index + 1) break;
      group.push(trips[++i]);
    }
    out.push(group.length === 1 ? group[0] : stretchOf(of.run, group));
  }
  return out;
}

/**
 * Trips taken off a line, named for a sentence: the days of one run together ("trip 31 (3 days, 19.2 CH)"), not the
 * same trip named once a day.
 */
export function namedWithHours(items: readonly { trip: Trip; creditHours: number }[], name: (t: Trip) => string): string {
  const groups: { trip: Trip; days: number; creditHours: number }[] = [];
  const byRun = new Map<Trip, (typeof groups)[number]>();
  for (const { trip, creditHours } of items) {
    const run = runOf.get(trip)?.run;
    const group = run ? byRun.get(run) : undefined;
    if (group) {
      group.days++;
      group.creditHours += creditHours;
      continue;
    }
    const g = { trip, days: 1, creditHours };
    groups.push(g);
    if (run) byRun.set(run, g);
  }
  return groups.map((g) => `${name(g.trip)} (${g.days > 1 ? `${g.days} days, ` : ""}${g.creditHours.toFixed(1)} CH)`).join(" and ");
}

/** A stretch of a run's days as one run, kept so its days are the same objects again (`dayTripsOf`). */
function stretchOf(run: Trip, group: Trip[]): Trip {
  const days = runDaysOf(run)!;
  const first = days[runOf.get(group[0])!.index];
  const last = days[runOf.get(group[group.length - 1])!.index];
  const shift = first.startMinutes;
  const back = (m: number) => m - shift;
  const schedule = run.schedule.slice(first.first, last.last + 1).map((d) => ({
    ...d,
    startMinutes: back(d.startMinutes),
    legs: d.legs.map((l) => ({ ...l, startMinutes: back(l.startMinutes), endMinutes: back(l.endMinutes) })),
    layover: d.layover ? { ...d.layover, startMinutes: back(d.layover.startMinutes), endMinutes: back(d.layover.endMinutes) } : null,
  }));
  const sum = (f: (t: Trip) => number) => round2(group.reduce((n, t) => n + f(t), 0));
  const stretch: Trip = {
    ...group[0],
    days: group.length,
    creditHours: sum((t) => t.creditHours),
    tafbHours: sum((t) => t.tafbHours),
    landings: sum((t) => t.landings),
    departures: sum((t) => t.departures),
    deadheadLegs: sum((t) => t.deadheadLegs),
    dutyPeriods: sum((t) => t.dutyPeriods ?? t.schedule.length),
    layoverCities: group.flatMap((t) => t.layoverCities),
    layoverDetails: group.flatMap((t) => t.layoverDetails),
    runStarts: group.map((t) => runOf.get(t)!.day.first - first.first),
    schedule,
  };
  piecesOf.set(stretch, group);
  return stretch;
}

function splitRun(trip: Trip): Trip[] {
  const days = runDaysOf(trip);
  if (!days) return [trip];
  const perDay = (n: number) => round2(n / days.length);
  return days.map((day) => {
    const shift = day.startMinutes;
    const back = (m: number) => m - shift;
    const schedule = trip.schedule.slice(day.first, day.last + 1).map((d) => ({
      ...d,
      startMinutes: back(d.startMinutes),
      legs: d.legs.map((l) => ({ ...l, startMinutes: back(l.startMinutes), endMinutes: back(l.endMinutes) })),
      layover: d.layover ? { ...d.layover, startMinutes: back(d.layover.startMinutes), endMinutes: back(d.layover.endMinutes) } : null,
    }));
    const legs = schedule.flatMap((d) => d.legs);
    const layovers = schedule.flatMap((d) => (d.layover ? [d.layover] : []));
    const single: Trip = { ...trip };
    delete single.runStarts;
    return {
      ...single,
      days: 1,
      // A day later each day, give or take a clock change.
      startDayIndex: trip.startDayIndex === null ? null : trip.startDayIndex + Math.round(shift / MINUTES_PER_DAY),
      creditHours: perDay(trip.creditHours),
      tafbHours: round2(day.hours),
      landings: legs.filter((l) => !l.isDeadhead).length,
      departures: legs.filter((l) => !l.isDeadhead).length,
      deadheadLegs: legs.filter((l) => l.isDeadhead).length,
      dutyPeriods: schedule.length,
      layoverCities: layovers.map((l) => l.city),
      layoverDetails: dayLayoverDetails(trip, day, days.length),
      zuluAnchor: trip.zuluAnchor ? new Date(Date.parse(trip.zuluAnchor) + shift * 60_000).toISOString() : trip.zuluAnchor,
      schedule,
    };
  });
}

/**
 * A run day's own hotels: the run's are its days' in order, one per layover, so the day takes those of its own duties.
 * Taken as the first day's, every day showed it, though a hotel can change partway through (Detroit on the third day).
 */
function dayLayoverDetails(trip: Trip, day: RunDay, dayCount: number): Trip["layoverDetails"] {
  const layoversBefore = (i: number) => trip.schedule.slice(0, i).filter((d) => d.layover).length;
  const total = layoversBefore(trip.schedule.length);
  if (trip.layoverDetails.length === total) return trip.layoverDetails.slice(layoversBefore(day.first), layoversBefore(day.last + 1));
  // Not one per layover (a pack read before they were kept that way): an even share, as before.
  return trip.layoverDetails.length % dayCount === 0 ? trip.layoverDetails.slice(0, trip.layoverDetails.length / dayCount) : [];
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
