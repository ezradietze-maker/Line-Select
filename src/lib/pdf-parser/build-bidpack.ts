import { DateTime } from "luxon";
import type { ParsedLineSummary, ParsedPairing } from "@/lib/pdf-parser/types";
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

export function pairingToTrip(pairing: ParsedPairing, bidPackMonth: string): Trip {
  const anchor = monthAnchorZulu(bidPackMonth);
  return {
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
