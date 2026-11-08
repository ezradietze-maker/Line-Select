import { bidMonthEnd } from "@/lib/bid-month";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";

/**
 * What the contract lets a pilot trade, as far as a bid pack can show it. This narrows the suggestions; it doesn't
 * promise a trade will go through. VIPS runs the real check when each pilot submits (rest, 1-in-7, currency and the
 * other Section 12 limits are FedEx's to judge), and the questions the text leaves open are in
 * `private/ex-pilot/trip-trades-questions.md`.
 */

const HOUR = 3_600_000;
/**
 * The gap kept between trips. CBA 2026 25.L.1.d (all bid periods) prohibits an adjustment that "would create a conflict
 * with another scheduled activity" or leave the pilot not legal for one, without giving a number for trips. It gives 12
 * hours for R-days (25.L.1.d.i), so that's the floor used here until the ex-pilot confirms the real figure.
 */
const MIN_HOURS_BETWEEN_TRIPS = 12;

/**
 * What a pilot holds and can't trade away, by `tripInstanceKey`: CBA 2026 25.L.1.h "may not trade, proffer, or drop a
 * trip assigned as VLT, DRF, AVA, CMU, PDO, PMU, or RSV" (PMU from the December 2026 bid period, the rest in all); a
 * check ride, 25.L.1.c (unless waived by the Fleet Captain); a deviated deadhead within 14 days, 8.x.b. A bid pack shows
 * none of these, so the pilot marks them.
 */
export type LockedTrips = ReadonlySet<string>;

/** One trip on one date: the same pairing flies on several days, and each is its own thing to trade. */
export function tripInstanceKey(trip: Pick<Trip, "id" | "startDayIndex">): string {
  return `${trip.id}@${trip.startDayIndex}`;
}

/** Report to release as real instants. Null when the pack doesn't place the trip on a date. */
export function tripSpan(pack: Pick<BidPack, "bidPeriodStart" | "base">, trip: Trip): { start: number; end: number } | null {
  const start = tripReportUtc(pack, trip);
  return start === null ? null : { start, end: start + trip.tafbHours * HOUR };
}

/**
 * How long before a trip's show a trade must go in. CBA 2026 25.L.9.a.ii: "at least 2 hours prior to showtime of the first
 * affected activity"; from the December 2026 bid period (Phase 2), 1 hour.
 */
export function tradeDeadlineHours(pack: Pick<BidPack, "month">): number {
  return fromPhase2(pack) ? 1 : 2;
}

const monthNumber = (pack: Pick<BidPack, "month">): number | null => {
  const m = /^([A-Z]{3})(\d{2})$/i.exec(pack.month);
  if (!m) return null;
  return Number(m[2]) * 12 + "JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC".indexOf(m[1].toUpperCase()) / 3;
};

/** Whether this bid period is December 2026 or later, when Phase 2 of the contract starts. */
export function fromPhase2(pack: Pick<BidPack, "month">): boolean {
  return (monthNumber(pack) ?? 0) >= 26 * 12 + 11;
}

/** Whether trades are processed in real time (CBA 2026 25.L.1.a), from the August 2027 bid period (Phase 3). */
export function hasRealTimeTrading(pack: Pick<BidPack, "month">): boolean {
  return (monthNumber(pack) ?? 0) >= 27 * 12 + 7;
}

/** Whether a trip can change hands at all: placed on a date, inside the bid month, not locked, and before its deadline. */
export function isTradeable(pack: BidPack, trip: Trip, locked: LockedTrips, now: number): boolean {
  if (locked.has(tripInstanceKey(trip)) || trip.schedule.length === 0) return false;
  const span = tripSpan(pack, trip);
  if (!span) return false;
  // One running past the month's end has its credit split across two months, which a trade would have to settle: left out for now.
  const monthEnd = bidMonthEnd(pack);
  if (monthEnd !== null && span.end > monthEnd) return false;
  return span.start - tradeDeadlineHours(pack) * HOUR > now;
}

const overlaps = (a: { start: number; end: number }, from: number, to: number) => a.start < to && a.end > from;

/** CBA 2026 7.A.4 (all bid periods): "A pilot shall not be permitted to trip trade into, out of, or within the pilot's vacation period." */
export function touchesVacation(pack: BidPack, trip: Trip, vacations: readonly VacationPeriod[]): boolean {
  const span = tripSpan(pack, trip);
  if (!span) return true;
  return vacations.some((v) => overlaps(span, Date.parse(v.from), Date.parse(v.to)));
}

/**
 * Whether a pilot holding `others` could also hold `trip`: no overlap and the gap kept between trips (CBA 2026 25.L.1.d),
 * and not into their vacation (7.A.4). A trip with no date among `others` can't be checked, so it rules this out.
 */
export function canHold(pack: BidPack, others: readonly Trip[], trip: Trip, vacations: readonly VacationPeriod[]): boolean {
  const span = tripSpan(pack, trip);
  if (!span || touchesVacation(pack, trip, vacations)) return false;
  const gap = MIN_HOURS_BETWEEN_TRIPS * HOUR;
  return others.every((o) => {
    const other = tripSpan(pack, o);
    return other !== null && overlaps(span, other.start - gap, other.end + gap) === false;
  });
}

/** The vacation a pilot holds, by their seniority number, from the pack's own schedule. */
export function vacationsOf(pack: BidPack, seniority: number | null | undefined): readonly VacationPeriod[] {
  if (seniority === null || seniority === undefined) return [];
  return pack.seniorityList?.find((e) => e.seniority === seniority)?.vacations ?? [];
}

/** The base's line, with its trips in date order: what the checks and scoring read. */
export function sortedTrips(line: Line): Trip[] {
  return [...line.trips].sort((a, b) => (a.startDayIndex ?? 0) - (b.startDayIndex ?? 0));
}
