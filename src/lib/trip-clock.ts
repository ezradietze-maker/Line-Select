import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";

/**
 * Real timezone-aware conversion between a leg's actual Zulu instant
 * (`TripLeg.depTimeZulu`/`arrTimeZulu`) and local wall-clock time at
 * whichever airport is relevant — the arithmetic underneath the Zulu/Local
 * toggle and its mini calendar. Luxon does the actual DST/offset lookup;
 * everything here is just wiring real instants through it and comparing
 * calendar-date *labels* (not elapsed real time) to catch the international
 * date line doing something a pilot wouldn't expect from a leg's duration
 * alone.
 */

/**
 * A calendar date's position on a pure, zone-independent day number line —
 * two DateTimes in different zones can be only a few real hours apart while
 * still carrying date labels a full day apart (an evening departure in one
 * zone landing the next morning, zone-label-wise, in another), so comparing
 * *labels* requires stripping zone out of the comparison entirely rather
 * than diffing the two instants directly (which would measure real elapsed
 * time, not the label gap).
 */
function calendarDayNumber(dt: DateTime): number {
  return DateTime.fromISO(dt.toISODate()!, { zone: "utc" }).toMillis() / 86_400_000;
}

export interface LocalInstant {
  /** Relative day index within the trip, 1-based — Day 1 is whichever local calendar day the trip's own reference instant (its first segment's start) falls on at its own airport. */
  dayIndex: number;
  /** 0-1440. */
  minuteOfDay: number;
  /** HH:mm, for display. */
  clock: string;
  zone: string;
}

/** The local midnight an instant falls on at a given airport — the reference point every other `toLocalInstant` call for the same trip is measured against for day-index numbering. Null when the airport's zone isn't in the lookup table. */
export function localDayStart(zuluISO: string, airportCode: string): DateTime | null {
  const zone = timezoneForAirport(airportCode);
  if (!zone) return null;
  return DateTime.fromISO(zuluISO, { zone: "utc" }).setZone(zone).startOf("day");
}

/** Converts a real Zulu instant to local wall-clock time at `airportCode`, day-indexed relative to `base` (see `localDayStart`). Null when the airport's zone isn't known — never guessed. */
export function toLocalInstant(zuluISO: string, airportCode: string, base: DateTime): LocalInstant | null {
  const zone = timezoneForAirport(airportCode);
  if (!zone) return null;
  const local = DateTime.fromISO(zuluISO, { zone: "utc" }).setZone(zone);
  return {
    dayIndex: 1 + (calendarDayNumber(local) - calendarDayNumber(base)),
    minuteOfDay: local.hour * 60 + local.minute,
    clock: local.toFormat("HH:mm"),
    zone,
  };
}

export interface DateLineCrossing {
  /** Signed day delta the destination's own timezone added/removed beyond what this leg's real (Zulu) duration would have produced had it stayed in the departure zone the whole way — positive means the local calendar jumped an extra day forward, negative means it jumped back. Never zero (see `detectDateLineCrossing`, which returns null instead). */
  delta: number;
  explanation: string;
}

/**
 * Flags a leg whose local arrival date is further from its local departure
 * date than the leg's own real duration would suggest, purely because of
 * the destination's timezone — the "gained/lost a day" surprise a pilot
 * actually experiences on a long international leg, as distinct from the
 * completely ordinary calendar-day rollover any long flight causes.
 *
 * Deliberately geography-agnostic: this fires on *any* timezone-driven
 * calendar jump, not only a literal antimeridian crossing — a big enough
 * offset difference produces the same surprise on a transatlantic route
 * (confirmed live: CDG->MEM reads "-1 day" despite flying nowhere near the
 * Pacific date line). The explanation text below is worded to match —
 * never "eastbound"/"westbound" or "the date line" specifically, since
 * those would be a false compass-direction claim on a route like that one.
 *
 * Returns null when nothing surprising happened (including when either
 * airport's zone isn't known, since there's nothing honest to report).
 */
export function detectDateLineCrossing(
  zuluDep: string,
  zuluArr: string,
  depAirport: string,
  arrAirport: string
): DateLineCrossing | null {
  const depZone = timezoneForAirport(depAirport);
  const arrZone = timezoneForAirport(arrAirport);
  if (!depZone || !arrZone) return null;

  const depLocal = DateTime.fromISO(zuluDep, { zone: "utc" }).setZone(depZone);
  const arrLocalActual = DateTime.fromISO(zuluArr, { zone: "utc" }).setZone(arrZone);
  // What the arrival date would read if the destination didn't change zone
  // at all — i.e. the "just duration, no timezone effect" baseline.
  const arrLocalSameZone = DateTime.fromISO(zuluArr, { zone: "utc" }).setZone(depZone);

  const actualDelta = calendarDayNumber(arrLocalActual) - calendarDayNumber(depLocal);
  const sameZoneDelta = calendarDayNumber(arrLocalSameZone) - calendarDayNumber(depLocal);
  const delta = actualDelta - sameZoneDelta;
  if (delta === 0) return null;

  const comparative = delta > 0 ? "later" : "earlier";
  const days = Math.abs(delta);
  const explanation = `Landed ${arrAirport} ${arrLocalActual.toFormat(
    "HH:mm"
  )} local — the timezone change puts that ${days} day${days > 1 ? "s" : ""} ${comparative} than this leg's own length alone would suggest.`;

  return { delta, explanation };
}

/**
 * The inverse of `toLocalInstant`: given a local (dayIndex, minuteOfDay)
 * pair measured against the same `base` reference, returns the real Zulu
 * instant that wall-clock time actually corresponds to in `airportCode`'s
 * zone — what the always-visible Zulu ruler uses to label a local day
 * column's own boundaries in Zulu terms. Null when the airport's zone isn't
 * known.
 */
export function localInstantToZulu(
  dayIndex: number,
  minuteOfDay: number,
  airportCode: string,
  base: DateTime
): string | null {
  const zone = timezoneForAirport(airportCode);
  if (!zone) return null;
  return DateTime.fromObject({ year: base.year, month: base.month, day: base.day }, { zone })
    .plus({ days: dayIndex - 1, minutes: minuteOfDay })
    .toUTC()
    .toISO();
}

/** A Zulu-side day+time label for the always-visible reference ruler in Local mode — day-indexed against `zuluAnchorISO` the same way `toLocalInstant` indexes local days against a trip's own base, so the two numbering systems can sit side by side even once they've drifted apart. */
export function zuluDayLabel(zuluISO: string, zuluAnchorISO: string): { dayIndex: number; clock: string } {
  const instant = DateTime.fromISO(zuluISO, { zone: "utc" });
  const anchor = DateTime.fromISO(zuluAnchorISO, { zone: "utc" });
  return {
    dayIndex: 1 + (calendarDayNumber(instant) - calendarDayNumber(anchor)),
    clock: instant.toFormat("HH:mm"),
  };
}
