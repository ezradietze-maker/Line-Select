import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { tripStartUtc } from "@/lib/flights/needs";
import { realTravelForTrip, type FlightAnswers } from "@/lib/flights/trip-travel";
import { DEFAULT_HOME_PARAMS, EARLY_SHOW_HOUR, estimatedTravel, homeAwayForTrip, type TravelTimeProvider } from "@/lib/metrics/home-travel";

export { EARLY_SHOW_HOUR };
import { tripFactsOf, type TripFacts } from "@/lib/metrics/trip-facts";
import { runDaysOf } from "@/lib/trip-anchor";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * Departures: each time a pilot leaves home to fly, which may be one trip or several flown back to back — what pilots
 * call a "series of trips" or a "trip sequence". A commuter counts the month in these, not in trips: a line of seven
 * trips can be three departures when trips turn straight into each other at base and there's no going home in between.
 *
 * When two trips are two departures: a commuter goes home if there'd be at least `minHomeHours` there (24 by default),
 * counted door to door — from when they'd actually get home after one trip (deadheading home from wherever its flying
 * ends, or commuting home from base) to when they'd have to leave for the next (deadheading straight to where its flying
 * starts, or commuting to base for the report). Hours scheduled at base between two trips can be far fewer, or far
 * more, than the hours really spent at home. The travel times are the same ones the app's time-away measures use
 * (`home-travel.ts`): an estimate from distance, or the real airline flights where they've been looked up.
 *
 * A pilot who lives at base, or whose home isn't known, simply goes home between trips; for them two trips are one
 * departure only when the second reports within a few hours of the first one landing.
 *
 * A departure whose last trip runs into the next month (cut at the bid month's end, `Trip.carriesIntoNextMonth`) gets
 * home in that month: its commute home, and any night at base after it, are the next month's, not this one's.
 *
 * A run of the same day trip on days running is kept as one trip (`runDaysOf`), but it's flown a day at a time: a pilot
 * who lives at base goes home between its days as between any two trips, and a commuter waits in a base hotel. Taken
 * whole, a base pilot's three days read as one departure and lost the two nights at home between them, and a
 * commuter's nights at base between them went uncounted — where the same days under three pairing numbers counted both.
 */

/** Under this many hours at home, a commuter doesn't go home between trips (a per-pilot setting). */
export const DEFAULT_MIN_HOME_HOURS = 24;
/** Without a home to travel to (or living at base), trips this close together at base are flown as one stretch of work. */
export const BASE_TURN_MAX_HOURS = 12;

const HOUR = 3_600_000;

/**
 * Nights at base, for a commuter without a crash pad — the hotel nights that come with commuting in early for a trip or
 * getting back too late to go home. Each is a setting:
 */
/**
 * Unless the duty after that early show is shorter than this: then the commuter can jumpseat in on the evening flight
 * the night before and nap in the hub's sleep room rather than take a hotel. (Whether the contract allows it into a long
 * duty is still to confirm.)
 */
export const SHORT_DUTY_HOURS = 6;
/** Back at base at or after this local hour (or in the small hours after it), there's no getting home that night. */
export const LATE_RELEASE_HOUR = 22;
/** A wait at base between two trips of one departure this long or longer is spent in a hotel; shorter, it's a turn. */
export const HOTEL_SIT_HOURS = 6;

export type BaseNightReason = "before" | "between" | "after";

export interface DepartureOptions {
  /** Where the pilot lives — the airports he flies from. Empty, unknown or the base itself: he lives at base. */
  homeAirports?: string[];
  minHomeHours?: number;
  commuteBufferHours?: number;
  frontBufferHours?: number;
  backRestHours?: number;
  travel?: TravelTimeProvider;
  flights?: FlightAnswers;
  /** A crash pad at base: nights there cost nothing extra, so none are counted. */
  hasCrashPad?: boolean | null;
  /** Each trip's facts, when the caller already has them (the metric library does), so they aren't worked out again. */
  facts?: Map<Trip, TripFacts>;
}

export interface Departure {
  /** The trips flown on it, in order. A run of day trips a pilot goes home between is on each of its departures. */
  trips: Trip[];
  /** When he leaves home and gets back (ms, UTC) — null for a pilot who lives at base, or when a trip couldn't be placed. */
  leaveHome: number | null;
  backHome: number | null;
  /** The first report at base and the last block-in (ms, UTC) — null when a trip couldn't be placed. */
  reportAt: number | null;
  releaseAt: number | null;
  /** How it starts and ends: commuting through base, or deviating on a deadhead from or to home. Null without a home. */
  start: "base" | "deviate" | null;
  end: "base" | "deviate" | null;
  /** Credit of the trips on it. */
  creditHours: number;
  /** Hours on the ground at base between each pair of trips flown back to back on it. */
  turnHours: number[];
  /** Hours at home after this departure before the next one (null for the last, or when unknown). */
  homeHoursAfter: number | null;
  /** Commutes to or from base it takes this month: 0–2 for a commuter (none when it starts or ends on a deadhead from or to home, and none home when it runs into the next month), 0 for a pilot who lives at base. */
  baseCommutes: number;
  /** Its last trip runs into the next month — it isn't home again this month: `end` is null, `backHome` the month's end. */
  carriesOver?: boolean;
  /** Nights a commuter without a crash pad spends at base on it, each with why; `runDay`, the day of a run they wait for. */
  baseNights: { reason: BaseNightReason; nights: number; tripNumber: string | null; runDay?: number }[];
  /** Early shows he'd jumpseat into the evening before rather than take a hotel (a short first duty). */
  jumpseatIns: number;
}

interface Placed {
  trip: Trip;
  facts: TripFacts;
  /** Report at base, and the last block-in, in ms UTC. */
  start: number;
  end: number;
  leave: number | null;
  back: number | null;
  startHow: "base" | "deviate" | null;
  endHow: "base" | "deviate" | null;
  /** A run of day trips: each day's report and last block-in (ms UTC). */
  days: { start: number; end: number }[] | null;
}

/** One stretch of work at base: a trip, or one day of a run. */
interface Stretch {
  p: Placed;
  start: number;
  end: number;
  /** The day of the run, or null for a whole trip; and whether it's the trip's last stretch. */
  day: number | null;
  last: boolean;
}

/** A run's days at their real times: each day's report, and its last block-in. */
function runDays(trip: Trip, start: number): { start: number; end: number }[] | null {
  const days = runDaysOf(trip);
  if (!days) return null;
  return days.map((d) => {
    const ends = trip.schedule.slice(d.first, d.last + 1).flatMap((x) => [x.startMinutes, ...x.legs.map((l) => l.endMinutes)]);
    return { start: start + d.startMinutes * 60_000, end: start + Math.max(...ends) * 60_000 };
  });
}

function lastBlockIn(f: TripFacts): number {
  const ends = [...f.legs.map((l) => l.end), ...f.duties.map((d) => d.end)];
  return ends.length ? Math.max(...ends) : f.tafbHours * 60;
}

/**
 * The line's trips grouped into departures, in date order. Trips the pack couldn't place on a date (an estimated line)
 * each stand alone — nothing about them says what they turn into.
 */
export function groupDepartures(trips: Trip[], ctx: Pick<BidPack, "bidPeriodStart" | "base">, options: DepartureOptions = {}): Departure[] {
  const homes = (options.homeAirports ?? []).filter((a) => a && a !== ctx.base);
  const commuter = homes.length > 0 && !(options.homeAirports ?? []).includes(ctx.base);
  const params = {
    homeAirports: homes,
    commuteBufferHours: options.commuteBufferHours,
    frontBufferHours: options.frontBufferHours ?? DEFAULT_HOME_PARAMS.frontBufferHours,
    backRestHours: options.backRestHours ?? DEFAULT_HOME_PARAMS.backRestHours,
  };
  const minHome = options.minHomeHours ?? DEFAULT_MIN_HOME_HOURS;

  const placed: Placed[] = [];
  const unplaced: Trip[] = [];
  for (const trip of trips) {
    const start = tripStartUtc(ctx, trip);
    if (start === null || trip.schedule.length === 0) {
      unplaced.push(trip);
      continue;
    }
    const facts = options.facts?.get(trip) ?? tripFactsOf(trip);
    const away = commuter ? homeAwayForTrip(facts, ctx.base, params, options.travel ?? estimatedTravel, realTravelForTrip(options.flights, ctx, trip)) : null;
    placed.push({
      trip,
      facts,
      start,
      end: start + lastBlockIn(facts) * 60_000,
      leave: away ? start + away.leaveMinute * 60_000 : null,
      back: away ? start + away.backMinute * 60_000 : null,
      startHow: away?.start ?? null,
      endHow: away?.end ?? null,
      days: runDays(trip, start),
    });
  }
  placed.sort((a, b) => a.start - b.start);

  // What's grouped: each trip whole, but a run of day trips a day at a time for a pilot who lives at base — a commuter's
  // door-to-door times are the whole run's, and between its days there's never long enough to go home.
  const stretches = placed.flatMap((p): Stretch[] =>
    p.days && !commuter ? p.days.map((d, i) => ({ p, start: d.start, end: d.end, day: i, last: i === p.days!.length - 1 })) : [{ p, start: p.start, end: p.end, day: null, last: true }]
  );
  const groups: Stretch[][] = [];
  for (const s of stretches) {
    const group = groups.at(-1);
    const prev = group?.at(-1);
    let chained = false;
    if (prev) {
      if (prev.p.back !== null && s.p.leave !== null) chained = (s.p.leave - prev.p.back) / HOUR < minHome;
      else chained = (s.start - prev.end) / HOUR < BASE_TURN_MAX_HOURS;
    }
    if (chained) group!.push(s);
    else groups.push([s]);
  }

  const zone = timezoneForAirport(ctx.base);
  const localHour = (ms: number) => (zone ? DateTime.fromMillis(ms, { zone }).hour : new Date(ms).getUTCHours());
  /** Local nights (the 02:00 of each) between two instants at base. */
  const nightsBetween = (from: number, to: number) => {
    if (!zone) return Math.max(0, Math.floor((to - from) / (24 * HOUR)));
    let n = 0;
    let t = DateTime.fromMillis(from, { zone }).set({ hour: 2, minute: 0, second: 0, millisecond: 0 });
    if (t.toMillis() <= from) t = t.plus({ days: 1 });
    for (; t.toMillis() < to; t = t.plus({ days: 1 })) n++;
    return n;
  };
  const countsNights = commuter && !options.hasCrashPad;

  const departures: Departure[] = groups.map((held) => {
    // Its trips: a run once, however many of its days it holds.
    const g = held.filter((s, i) => i === 0 || s.p !== held[i - 1].p).map((s) => s.p);
    const first = g[0];
    const last = g[g.length - 1];
    const lastStretch = held[held.length - 1];
    const carriesOver = lastStretch.last && !!last.trip.carriesIntoNextMonth;
    const baseNights: Departure["baseNights"] = [];
    let jumpseatIns = 0;
    if (countsNights) {
      if (first.startHow === "base" && localHour(first.start) < EARLY_SHOW_HOUR) {
        const duty = first.facts.duties[0];
        const dutyHours = duty ? (duty.end - duty.start) / 60 : Infinity;
        if (dutyHours < SHORT_DUTY_HOURS) jumpseatIns++;
        else baseNights.push({ reason: "before", nights: 1, tripNumber: first.trip.pairingNumber });
      }
      // Waiting at base for each trip after the first, and for each day of a run after its first.
      const waits = g.flatMap((p, i) => [
        ...(i > 0 ? [{ from: g[i - 1].end, to: p.start, trip: p.trip, runDay: null as number | null }] : []),
        ...(p.days ?? []).slice(1).map((d, k) => ({ from: p.days![k].end, to: d.start, trip: p.trip, runDay: k + 1 as number | null })),
      ]);
      for (const w of waits) {
        const nights = (w.to - w.from) / HOUR >= HOTEL_SIT_HOURS ? nightsBetween(w.from, w.to) : 0;
        if (nights > 0) baseNights.push({ reason: "between", nights, tripNumber: w.trip.pairingNumber, ...(w.runDay !== null ? { runDay: w.runDay } : {}) });
      }
      const releaseHour = localHour(last.end);
      if (last.endHow === "base" && (releaseHour >= LATE_RELEASE_HOUR || releaseHour < 5)) baseNights.push({ reason: "after", nights: 1, tripNumber: last.trip.pairingNumber });
    }
    return {
      trips: g.map((p) => p.trip),
      leaveHome: first.leave,
      backHome: last.back,
      reportAt: held[0].start,
      releaseAt: lastStretch.end,
      start: first.startHow,
      end: last.endHow,
      // A run split across departures pays each its days' share.
      creditHours: held.reduce((n, s) => n + s.p.trip.creditHours / (s.day === null ? 1 : s.p.days!.length), 0),
      turnHours: g.slice(1).map((p, i) => (p.start - g[i].end) / HOUR),
      homeHoursAfter: null,
      baseCommutes: commuter ? (first.startHow === "base" ? 1 : 0) + (last.endHow === "base" ? 1 : 0) : 0,
      baseNights,
      jumpseatIns,
      ...(carriesOver ? { carriesOver } : {}),
    };
  });
  for (let i = 0; i + 1 < departures.length; i++) {
    const back = departures[i].backHome;
    const leave = departures[i + 1].leaveHome;
    departures[i].homeHoursAfter = back !== null && leave !== null ? (leave - back) / HOUR : null;
  }
  return [
    ...departures,
    ...unplaced.map((trip) => ({ trips: [trip], leaveHome: null, backHome: null, reportAt: null, releaseAt: null, start: null, end: null, creditHours: trip.creditHours, turnHours: [], homeHoursAfter: null, baseCommutes: 0, baseNights: [], jumpseatIns: 0 })),
  ];
}
