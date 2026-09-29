import { DateTime } from "luxon";
import { tripDutyPeriods } from "@/lib/duty-periods";
import type { DayPlacement } from "@/lib/pdf-parser/line-grid-days";
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
    standbyDays: pairing.standbyDays ?? 0,
    creditHours: round2(pairing.creditHours),
    landings: pairing.landings,
    tafbHours: round2(pairing.tafbHours),
    // A departure is a takeoff, and every takeoff is followed by a landing, so a
    // trip's departures are its landings — one number, never two. (Hotel
    // standby rows print a hotel "layover" of their own, which is why this
    // can't be derived from layover counts.)
    departures: pairing.landings,
    // The old, layover-based count — one duty period per layover, plus the last. Hotel standby days each print a layover, so they're included, exactly as the pack's own printed duty-period total includes them.
    dutyPeriods: pairing.layoverDetails.length + 1,
    schedule: anchorSchedule(pairing.schedule, anchor),
    zuluAnchor: anchor,
    startDayIndex: null,
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
    departures: summary.totalLandings,
    dutyPeriods: summary.printedDutyPeriods ?? 1,
    schedule: [],
    zuluAnchor: monthAnchorZulu(bidPackMonth),
    startDayIndex: null,
  };
}

/**
 * Matches a line's grid-derived day placements onto its already-built
 * trips, in place — one placement per trip, matched by pairing number and
 * consumed in day order so a pairing number repeated across the line (the
 * same short trip pattern flown more than once that month) still gets each
 * occurrence its own real day. Deliberately all-or-nothing: if the grid's
 * own placement count doesn't match this line's trip count, or any
 * placement's pairing number doesn't match a trip at all, every trip on
 * this line is left unplaced rather than showing a calendar that's right
 * for some trips and silently wrong for others.
 */
/**
 * A trip's length as the bid pack's own calendar gives it: from the day it
 * starts to the day before the next trip starts or a day off begins. The
 * pairing schedule's local-calendar span runs a day longer than that on
 * roughly a fifth of trips (a trip landing just past midnight), while the
 * grid's footprint is what makes each line's days off add up to the printed
 * number — so the two labels a pilot sees, "N-day" and the days on the
 * calendar, should be the same thing. A trip that runs to the very end of the
 * grid may continue into the next period, so its full schedule length is kept.
 */
function applyGridFootprints(trips: Trip[], offDays: number[], dayCount: number): void {
  if (trips.some((t) => t.startDayIndex === null)) return;
  const off = new Set(offDays);
  const starts = new Set(trips.map((t) => t.startDayIndex!));
  for (const trip of trips) {
    let end = trip.startDayIndex! + 1;
    while (end < dayCount && !off.has(end) && !starts.has(end)) end++;
    const footprint = end - trip.startDayIndex!;
    if (end < dayCount && footprint >= 1) trip.days = footprint;
  }
}

function applyDayPlacements(trips: Trip[], placements: DayPlacement[] | undefined): void {
  if (!placements || placements.length !== trips.length) return;

  const ordered = [...placements].sort((a, b) => a.startDayIndex - b.startDayIndex);
  const pool = [...trips];
  const resolved: { trip: Trip; startDayIndex: number }[] = [];

  for (const placement of ordered) {
    const idx = pool.findIndex((t) => t.pairingNumber === placement.pairingNumber);
    if (idx === -1) return;
    resolved.push({ trip: pool[idx], startDayIndex: placement.startDayIndex });
    pool.splice(idx, 1);
  }

  for (const { trip, startDayIndex } of resolved) {
    trip.startDayIndex = startDayIndex;
  }
}

/**
 * A leg's `startMinutes`/`endMinutes` are elapsed minutes since ITS OWN
 * trip's report (t=0) — see `TripLeg`'s own doc comment — so re-anchoring a
 * later occurrence onto the first occurrence's `zuluAnchor` means shifting
 * every minute-based field on it forward by a whole number of days, not
 * just recomputing the Zulu timestamps in isolation (those are derived FROM
 * the minutes, so both must move together or they go inconsistent with
 * each other the moment anything re-derives one from the other).
 */
function shiftScheduleByDays(schedule: TripDutyPeriod[], dayOffset: number, anchor: string): TripDutyPeriod[] {
  if (dayOffset === 0) return schedule;
  const shift = dayOffset * 1440;
  return schedule.map((duty) => ({
    ...duty,
    startMinutes: duty.startMinutes + shift,
    legs: duty.legs.map((leg) => ({
      ...leg,
      startMinutes: leg.startMinutes + shift,
      endMinutes: leg.endMinutes + shift,
      depTimeZulu: zuluAt(anchor, leg.startMinutes + shift),
      arrTimeZulu: zuluAt(anchor, leg.endMinutes + shift),
    })),
    layover: duty.layover
      ? { ...duty.layover, startMinutes: duty.layover.startMinutes + shift, endMinutes: duty.layover.endMinutes + shift }
      : null,
  }));
}

/** Merges a run of consecutive same-pairing 1-day trips into one N-day trip — the totals below are sums across the run, which is why `Line.totalDepartures`/`totalDutyPeriods` (themselves sums over `trips`) come out identical either way; only the shape of `trips` itself changes. */
function mergeConsecutiveOneDayTrips(run: Trip[]): Trip {
  const first = run[0];
  const standbyValues = run.map((t) => t.standbyDays);
  return {
    ...first,
    days: run.length,
    creditHours: round2(run.reduce((s, t) => s + t.creditHours, 0)),
    tafbHours: round2(run.reduce((s, t) => s + t.tafbHours, 0)),
    landings: run.reduce((s, t) => s + t.landings, 0),
    departures: run.reduce((s, t) => s + t.departures, 0),
    deadheadLegs: run.reduce((s, t) => s + t.deadheadLegs, 0),
    dutyPeriods: run.reduce((s, t) => s + (t.dutyPeriods ?? 1), 0),
    // Preserve "not tracked" (undefined) rather than promoting it to a real 0
    // when every occurrence in the run predates standby tracking.
    standbyDays: standbyValues.every((v) => v === undefined)
      ? undefined
      : standbyValues.reduce<number>((s, v) => s + (v ?? 0), 0),
    international: run.some((t) => t.international),
    layoverCities: run.flatMap((t) => t.layoverCities),
    layoverDetails: run.flatMap((t) => t.layoverDetails),
    schedule: run.flatMap((trip, i) => shiftScheduleByDays(trip.schedule, i, first.zuluAnchor)),
  };
}

/**
 * A pilot bidding a line that flies the same short out-and-back three days
 * straight thinks of that as "trip 12, three days," not three separate
 * trips — so once every trip on a line has a real placed day (the same
 * all-or-nothing precondition `applyGridFootprints` uses; a partial merge
 * would look authoritative while being wrong for part of the line), collapse
 * any run of consecutive 1-day occurrences of the same pairing number into
 * one multi-day trip before this line's trip list is considered final. Runs
 * of two collapse just as much as runs of three or more — the mental-model
 * argument doesn't have a minimum length.
 */
function consolidateRepeatedSingleDayTrips(trips: Trip[]): Trip[] {
  if (trips.length === 0 || trips.some((t) => t.startDayIndex === null)) return trips;
  const ordered = [...trips].sort((a, b) => a.startDayIndex! - b.startDayIndex!);

  const result: Trip[] = [];
  let run: Trip[] = [ordered[0]];
  const flush = () => result.push(run.length > 1 ? mergeConsecutiveOneDayTrips(run) : run[0]);

  for (let i = 1; i < ordered.length; i++) {
    const prev = run[run.length - 1];
    const next = ordered[i];
    const continuesRun =
      prev.days === 1 &&
      next.days === 1 &&
      next.pairingNumber !== null &&
      next.pairingNumber === prev.pairingNumber &&
      next.startDayIndex === prev.startDayIndex! + 1;
    if (continuesRun) {
      run.push(next);
    } else {
      flush();
      run = [next];
    }
  }
  flush();

  return result;
}

export function buildLine(
  summary: ParsedLineSummary,
  matchedPairings: ParsedPairing[] | null,
  bidPackMonth: string,
  dayPlacements?: DayPlacement[],
  /** The grid's own "---" (no trip) days for this line — kept only when they add up to its printed days off. */
  gridDays?: { offDays: number[]; dayCount: number }
): Line {
  const rawTrips = matchedPairings
    ? matchedPairings.map((p) => pairingToTrip(p, bidPackMonth))
    : [buildEstimatedTrip(summary, bidPackMonth)];

  applyDayPlacements(rawTrips, dayPlacements);
  const gridOffDays = gridDays && gridDays.offDays.length === summary.daysOff ? gridDays.offDays : undefined;
  if (gridOffDays) applyGridFootprints(rawTrips, gridOffDays, gridDays!.dayCount);

  const trips = consolidateRepeatedSingleDayTrips(rawTrips);

  return {
    id: `line-${summary.lineNumber}`,
    lineNumber: summary.lineNumber,
    trips,
    daysOff: summary.daysOff,
    totalCreditHours: round2(summary.totalCreditHours),
    totalTafbHours: round2(summary.totalTafbHours),
    totalLandings: summary.totalLandings,
    totalDepartures: trips.reduce((s, t) => s + t.departures, 0),
    totalDutyPeriods: summary.printedDutyPeriods ?? trips.reduce((s, t) => s + tripDutyPeriods(t), 0),
    estimated: matchedPairings === null,
    ...(gridOffDays ? { gridOffDays } : {}),
  };
}
