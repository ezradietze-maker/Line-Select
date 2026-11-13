import { DateTime } from "luxon";
import { bidMonthEnd } from "@/lib/bid-month";
import { zoneOf, type CarryInItem } from "@/lib/phase-in";
import { tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import { busyFromCarry, fitCheck, scheduleAsFlown } from "@/lib/view-add";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";

/**
 * What the contract lets a pilot trade, as far as a bid pack can show it. This narrows the suggestions; it doesn't
 * promise a trade will go through. VIPS runs the real check when each pilot submits (currency and what a pack can't
 * show are FedEx's to judge), and the questions the text leaves open are in `private/ex-pilot/trip-trades-questions.md`.
 * The rest and 1-in-7 rules the site can see are View/Add's and Open time's own (`fitCheck`), so a trade is never
 * called legal where they'd rule the same trip out.
 */

const HOUR = 3_600_000;

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
  // Kept per pack and trip: matching asks for the same trips' spans millions of times, and a pack isn't changed in place.
  let spans = spanCache.get(pack);
  if (!spans) spanCache.set(pack, (spans = new WeakMap()));
  if (spans.has(trip)) return spans.get(trip)!;
  const start = tripReportUtc(pack, trip);
  const span = start === null ? null : { start, end: start + tripReleaseHours(trip) * HOUR };
  spans.set(trip, span);
  return span;
}
const spanCache = new WeakMap<object, WeakMap<Trip, { start: number; end: number } | null>>();

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
 * Whether a pilot holding `others`, and carrying in `carryIn` from last month, could also hold `trip`: not in conflict
 * with what they hold, nor leaving them not legal for it (CBA 2026 25.L.1.d, every bid period), and not into their
 * vacation (7.A.4). Legal is what View/Add and Open time hold the same schedule to (`fitCheck`): overlap, rest (12.C.6.a,
 * 12.C.6.b, 12.D.7), a hub turn as one duty within 12.C.4.e (which names "trip trade" as an optional assignment), 1-in-7
 * (12.C.1.b), and 12 hours from an R-day (25.L.1.d.i, ii, the only gap 25.L.1.d puts a number on). A trip with no date
 * among `others` can't be checked, so it rules this out.
 */
export function canHold(pack: BidPack, others: readonly Trip[], trip: Trip, vacations: readonly VacationPeriod[], carryIn: readonly CarryInItem[] = []): boolean {
  const span = tripSpan(pack, trip);
  if (!span || touchesVacation(pack, trip, vacations)) return false;
  const clear = (other: { start: number; end: number } | null) => other !== null && !overlaps(span, other.start, other.end);
  // The cheap test first, as an overlap is never legal: the full one sorts the whole month.
  if (!others.every((o) => clear(tripSpan(pack, o)))) return false;
  const zone = carryIn.length ? zoneOf(pack) : "";
  if (!carryIn.every((c) => clear(busyFromCarry(c, zone)?.span ?? null))) return false;
  return fitCheck(trip, scheduleAsFlown({ trips: [...others] }, [...carryIn], pack), [...vacations], pack).illegal.length === 0;
}

/** The least a carry-in is taken to reach into the month, when the pack's own lines carry out less. */
const MIN_CARRY_IN_DAYS = 2;

/**
 * Until when a trip carried in from last month may still be flying: the bid month's start, plus the longest any of this
 * pack's own lines runs past its end (7.04 days on the October B777 MEM lines, 2 on the A300's). Last month's pack isn't
 * here, so this one stands in for it. A pilot who hasn't said what they carry in is handed no trip starting before then
 * (`PilotHolding.carryIn`). Null without the pack's dates.
 */
export function carryInReach(pack: BidPack): number | null {
  if (reachCache.has(pack)) return reachCache.get(pack)!;
  const end = bidMonthEnd(pack);
  const start = pack.bidPeriodStart ? DateTime.fromISO(pack.bidPeriodStart, { zone: zoneOf(pack) }) : null;
  let reach: number | null = null;
  if (end !== null && start?.isValid) {
    let longest = MIN_CARRY_IN_DAYS * 24 * HOUR;
    for (const line of pack.lines) for (const t of line.trips) longest = Math.max(longest, (tripSpan(pack, t)?.end ?? end) - end);
    reach = start.toMillis() + longest;
  }
  reachCache.set(pack, reach);
  return reach;
}
const reachCache = new WeakMap<BidPack, number | null>();

/**
 * The month's first days, on the base's clock, in which a trip starting is held back from a pilot who hasn't said what
 * they carry in (`carryInReach`): 2 when it reaches two days in. Null without the pack's dates.
 */
export function carryInReachDays(pack: BidPack): number | null {
  const reach = carryInReach(pack);
  if (reach === null || !pack.bidPeriodStart) return null;
  const zone = zoneOf(pack);
  const days = DateTime.fromMillis(reach, { zone }).diff(DateTime.fromISO(pack.bidPeriodStart, { zone }), "days").days;
  return Math.max(1, Math.ceil(days - 1e-9));
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
