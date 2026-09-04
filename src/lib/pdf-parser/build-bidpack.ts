import { DateTime } from "luxon";
import type { ParsedLineSummary, ParsedPairing } from "@/lib/pdf-parser/types";
import { buildTimelineDays } from "@/lib/trip-timeline";
import type { Line, Trip, TripDutyPeriod } from "@/types/bidpack";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const MONTH_ABBREV: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** No trip in a bid pack is real for a month this generic is intended to signal — used only when `bidPackMonth` itself couldn't be parsed, so there's genuinely nothing real to anchor to. */
const FALLBACK_ANCHOR_ZULU = "2024-01-01T00:00:00.000Z";

/**
 * The real month/year a bid pack covers (e.g. "SEP26") turned into a UTC
 * instant used purely to anchor each trip's leg-level Zulu timestamps for
 * correct DST behavior at every airport a trip touches — this is NOT a
 * claim about which day of that month a given trip actually falls on (the
 * bid pack ties a pairing to a *line*, not to one calendar date within it),
 * so everything built from this anchor is shown as a relative "Day N",
 * never a specific date.
 */
export function monthAnchorZulu(bidPackMonth: string): string {
  const m = bidPackMonth.match(/^([A-Za-z]{3})(\d{2})$/);
  const monthNum = m ? MONTH_ABBREV[m[1].toUpperCase()] : undefined;
  if (!m || !monthNum) return FALLBACK_ANCHOR_ZULU;
  return DateTime.utc(2000 + Number(m[2]), monthNum, 1).toISO()!;
}

function zuluAt(anchorISO: string, minutes: number): string {
  return DateTime.fromISO(anchorISO, { zone: "utc" }).plus({ minutes }).toISO()!;
}

/**
 * Real anchor for THIS pairing's own elapsed-minute clock (`t=0` at its
 * report — see `RunningClock.seed` in pairing-parser.ts) — not just
 * `monthAnchorZulu`'s bare month-start, which would put every pairing's
 * report at exactly midnight UTC regardless of when it actually happens.
 * Different pairings report at wildly different real times, so anchoring
 * all of them to the same instant silently shifted every leg's derived
 * Zulu timestamp away from its real GMT time-of-day — harmless for the
 * places that already read a leg's own printed `depTimeLocal`/`depTimeGmt`
 * directly, but wrong for anything deriving real local time *positioning*
 * from the anchor instead (Local-mode day-splitting, date-line detection —
 * see trip-timeline.ts).
 *
 * Derived from the pairing's own first leg: its real printed GMT departure
 * time, minus how many elapsed minutes past report that departure already
 * is, gives the real GMT time-of-day the report itself happens at. The
 * calendar date stays arbitrary (still the bid month's own 1st, rolling
 * over a day if the subtraction crosses midnight) — a bid pack ties a
 * pairing to a line, not to one specific date — but the hour is now real.
 */
function pairingAnchorZulu(pairing: ParsedPairing, bidPackMonth: string): string {
  const monthStart = monthAnchorZulu(bidPackMonth);
  const firstLeg = pairing.schedule[0]?.legs[0];
  const gmtMatch = firstLeg?.depTimeGmt.match(/^(\d{2})(\d{2})$/);
  if (!firstLeg || !gmtMatch) return monthStart;

  const [, hh, mm] = gmtMatch;
  return DateTime.fromISO(monthStart, { zone: "utc" })
    .set({ hour: Number(hh), minute: Number(mm), second: 0, millisecond: 0 })
    .minus({ minutes: firstLeg.startMinutes })
    .toISO()!;
}

/** Materializes real Zulu timestamps onto every leg of a parsed schedule — the one place `ScheduledLeg`'s elapsed `startMinutes`/`endMinutes` (already Zulu-consistent, per its own doc comment) turns into an actual instant. */
function anchorSchedule(schedule: ParsedPairing["schedule"], anchorISO: string): TripDutyPeriod[] {
  return schedule.map((duty) => ({
    ...duty,
    legs: duty.legs.map((leg) => ({
      ...leg,
      depTimeZulu: zuluAt(anchorISO, leg.startMinutes),
      arrTimeZulu: zuluAt(anchorISO, leg.endMinutes),
    })),
  }));
}

/**
 * `pairing.days` counts distinct day-letters seen on the pairing's own
 * flight-leg rows — real printed text, but it only advances when a leg
 * actually flies that calendar day. A layover longer than 24 hours spans a
 * calendar date with no flight on it at all, so that date never gets its
 * own letter and silently drops out of the count, even though the pilot is
 * still away from base that whole day. `Trip.days`'s own contract is
 * "calendar days the trip spans, report to release" — this recomputes it
 * from the trip's actual anchored schedule (the same local-day splitting
 * the calendar view itself uses) so a long layover is counted the same way
 * everywhere in the app, instead of the calendar showing more days than
 * every other "N-day" label. Falls back to the printed count when there's
 * no schedule to split (or it fails to produce anything), consistent with
 * this file's honesty policy elsewhere: never invent when real data is
 * missing.
 */
function realCalendarDaySpan(trip: Trip, fallback: number): number {
  if (trip.schedule.length === 0) return fallback;
  const days = buildTimelineDays(trip, "local").length;
  return days > 0 ? days : fallback;
}

export function pairingToTrip(pairing: ParsedPairing, bidPackMonth: string): Trip {
  const anchor = pairingAnchorZulu(pairing, bidPackMonth);
  const trip: Trip = {
    id: pairing.id,
    pairingNumber: pairing.sequenceNumber,
    days: pairing.days,
    layoverCities: pairing.layoverCities,
    layoverDetails: pairing.layoverDetails,
    reportTime: pairing.reportTime,
    international: pairing.international,
    deadheadLegs: pairing.deadheadLegs,
    creditHours: round2(pairing.creditHours),
    landings: pairing.landings,
    tafbHours: round2(pairing.tafbHours),
    // Real from the first, always-successful parse pass — not gated by
    // whether the rich minute-by-minute `schedule` self-verified.
    departures: pairing.layoverDetails.length + 1,
    schedule: anchorSchedule(pairing.schedule, anchor),
    zuluAnchor: anchor,
  };
  return { ...trip, days: realCalendarDaySpan(trip, pairing.days) };
}

/**
 * Used when a line's calendar entries couldn't be confidently matched to a
 * specific pairing. Built entirely from the line's own printed totals (all
 * real, not guessed), with neutral placeholders only for the handful of
 * fields the line summary doesn't carry (layovers, report time, deadhead
 * count, international mix). Lines that fall back to this are listed in
 * `linesWithIncompleteTrips` so the UI can be upfront about it rather than
 * presenting an estimate as verified detail.
 */
export function buildEstimatedTrip(summary: ParsedLineSummary, bidPackMonth: string): Trip {
  return {
    id: `estimated-${summary.lineNumber}`,
    pairingNumber: null,
    days: Math.max(1, Math.round(summary.totalTafbHours / 24)),
    layoverCities: [],
    layoverDetails: [],
    reportTime: "afternoon",
    international: false,
    deadheadLegs: 0,
    creditHours: round2(summary.totalCreditHours),
    landings: summary.totalLandings,
    tafbHours: round2(summary.totalTafbHours),
    departures: 1,
    schedule: [],
    zuluAnchor: monthAnchorZulu(bidPackMonth),
  };
}

export function buildLine(
  summary: ParsedLineSummary,
  matchedPairings: ParsedPairing[] | null,
  bidPackMonth: string
): Line {
  const trips = matchedPairings
    ? matchedPairings.map((p) => pairingToTrip(p, bidPackMonth))
    : [buildEstimatedTrip(summary, bidPackMonth)];

  return {
    id: `line-${summary.lineNumber}`,
    lineNumber: summary.lineNumber,
    trips,
    daysOff: summary.daysOff,
    totalCreditHours: round2(summary.totalCreditHours),
    totalTafbHours: round2(summary.totalTafbHours),
    totalLandings: summary.totalLandings,
    totalDepartures: trips.reduce((s, t) => s + t.departures, 0),
    estimated: matchedPairings === null,
  };
}
