import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { lineDutyPeriods, tripDutyPeriods } from "@/lib/duty-periods";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { BidPack, Line, Trip } from "@/types/bidpack";

/**
 * A line's bid month, and what it carries over into the next. A bid month is four weeks (eight a year) or five (four
 * a year) — `bidPeriodDays` — and many lines end on a trip that runs past it into the next month. That carry-over is
 * not part of this month: the bid pack prints its credit and block apart (C/O), and pilots weigh a line on its own
 * month. So everything a line is judged on and shows as "the month" — landings, duty periods, block, TAFB, nights,
 * commutes — stops at midnight (the base's clock) after the bid month's last day, and what runs past is counted apart:
 * days into the next month, its duty periods and landings, its share of credit, block and time away.
 *
 * A duty belongs to the month it reports in — its legs, landings and layover with it. A trip that reports in this month
 * and lands back after midnight leaves its commute home in the next (`Trip.carriesIntoNextMonth`).
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type PackDates = Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">;

/** The instant the bid month ends: midnight on the base's clock after its last day. Null without the pack's real dates. */
export function bidMonthEnd(pack: PackDates): number | null {
  if (!pack.bidPeriodStart) return null;
  const end = DateTime.fromISO(pack.bidPeriodStart, { zone: timezoneForAirport(pack.base) ?? "UTC" }).plus({ days: pack.bidPeriodDays });
  return end.isValid ? end.toMillis() : null;
}

/**
 * The bid month the carry-over runs into, by name: "November". A bid month is named for the month most of it falls in —
 * October's can start on September 28 and November's on October 26 — so it's the month two weeks into the next one.
 */
export function nextMonthName(pack: PackDates): string {
  const end = bidMonthEnd(pack);
  if (end === null) return "next month";
  return DateTime.fromMillis(end, { zone: timezoneForAirport(pack.base) ?? "UTC" }).plus({ days: 14 }).toFormat("LLLL");
}

/** This bid month, by name: "October". */
export function bidMonthName(pack: PackDates): string | null {
  if (!pack.bidPeriodStart) return null;
  return DateTime.fromISO(pack.bidPeriodStart, { zone: timezoneForAirport(pack.base) ?? "UTC" }).plus({ days: 14 }).toFormat("LLLL");
}

/** What one trip carries past the bid month's end. */
export interface TripCarryOver {
  /** Calendar days into the next month (the base's clock) it's still flying on, the day it lands back counted. */
  days: number;
  /** Duty periods reporting after midnight (hotel standby days included, as the pack counts them), and the landings on them. */
  dutyPeriods: number;
  landings: number;
  /** Block flown on those duties, and the time away after midnight, in hours. */
  blockHours: number;
  tafbHours: number;
}

/** What a line carries into the next month: its trips' carry-over, and the pack's own C/O credit and block. */
export interface LineCarryOver extends TripCarryOver {
  /** The next month, by name. */
  month: string;
  /** Credit and block carried over, as the line prints them (C/O). */
  creditHours: number;
  printedBlockHours: number;
  /** The pairing numbers of the trips that run into it. */
  trips: (string | null)[];
}

const operated = (l: Trip["schedule"][number]["legs"][number]) => !l.isDeadhead && !l.isStandby;

/** Each cut trip's uncut original — how it starts can lie past the cut (a deadhead out before midnight, flying after). */
const uncut = new WeakMap<Trip, Trip>();
/** The whole trip a trip cut at the month's end came from; the trip itself when it wasn't cut. */
export function uncutTrip(trip: Trip): Trip {
  return uncut.get(trip) ?? trip;
}

/**
 * A trip cut at the bid month's end: the duties reporting before it, and — when any run past it — what's carried
 * over. `carryOverCredit` is this trip's share of the line's printed C/O credit. Null for a trip that can't be placed
 * on its date, or that reports after the month's end.
 */
export function splitTrip(trip: Trip, pack: PackDates, carryOverCredit = 0): { inMonth: Trip; carry: TripCarryOver | null } | null {
  const end = bidMonthEnd(pack);
  const anchor = tripReportUtc(pack, trip);
  if (end === null || anchor === null) return null;
  const tripEnd = anchor + trip.tafbHours * HOUR;
  const report = (d: Trip["schedule"][number]) => anchor + d.startMinutes * 60_000;
  const kept = trip.schedule.filter((d) => report(d) < end);
  const lastLanding = Math.max(anchor, ...trip.schedule.flatMap((d) => d.legs.map((l) => anchor + l.endMinutes * 60_000)));
  // Released a few minutes past midnight after landing before it, nothing of the trip is the next month's.
  if (kept.length === trip.schedule.length && lastLanding <= end) return { inMonth: trip, carry: null };
  if (kept.length === 0) return null;
  const gone = trip.schedule.slice(kept.length);
  const carry: TripCarryOver = {
    // Calendar days after the month's end the trip is still flying on, the day it lands back counted.
    days: Math.floor((lastLanding - end) / DAY) + 1,
    dutyPeriods: gone.length,
    landings: gone.reduce((n, d) => n + d.legs.filter(operated).length, 0),
    blockHours: gone.reduce((n, d) => n + d.legs.filter(operated).reduce((a, l) => a + (l.blockHours ?? 0), 0), 0),
    tafbHours: Math.max(0, (tripEnd - end) / HOUR),
  };
  const keptLegs = kept.flatMap((d) => d.legs);
  const inMonth: Trip = {
    ...trip,
    schedule: kept,
    days: Math.max(1, trip.days - carry.days),
    creditHours: Math.max(0, trip.creditHours - carryOverCredit),
    tafbHours: Math.max(0, trip.tafbHours - carry.tafbHours),
    landings: keptLegs.filter(operated).length,
    departures: keptLegs.filter(operated).length,
    deadheadLegs: keptLegs.filter((l) => l.isDeadhead).length,
    dutyPeriods: Math.max(kept.length, tripDutyPeriods(trip) - gone.length),
    standbyDays: Math.max(0, (trip.standbyDays ?? 0) - gone.filter((d) => d.legs.length > 0 && d.legs.every((l) => l.isStandby)).length),
    layoverCities: kept.flatMap((d) => (d.layover ? [d.layover.city] : [])),
    carriesIntoNextMonth: true,
  };
  uncut.set(inMonth, trip);
  return { inMonth, carry };
}


const cache = new WeakMap<Line, { key: string; month: Line; carry: LineCarryOver | null }>();

function split(line: Line, pack: PackDates): { month: Line; carry: LineCarryOver | null } {
  const key = `${pack.bidPeriodStart}|${pack.bidPeriodDays}|${pack.base}`;
  const hit = cache.get(line);
  if (hit && hit.key === key) return hit;
  const end = bidMonthEnd(pack);
  let result: { month: Line; carry: LineCarryOver | null } = { month: line, carry: null };
  if (end !== null && !line.estimated) {
    const starts = line.trips.map((t) => tripReportUtc(pack, t));
    // The line's printed C/O credit belongs to the trip still flying at the month's end.
    const carrying = line.trips.findIndex((t, i) => starts[i] !== null && starts[i]! < end && starts[i]! + t.tafbHours * HOUR > end);
    const parts = line.trips.map((t, i) => {
      // A trip reporting after the month's end (rare: one the grid still shows) is all next month's.
      if (starts[i] !== null && starts[i]! >= end) return null;
      return splitTrip(t, pack, i === carrying ? (line.carryOverCreditHours ?? 0) : 0) ?? { inMonth: t, carry: null };
    });
    const carried = parts.filter((p): p is { inMonth: Trip; carry: TripCarryOver } => !!p?.carry);
    const trips = parts.filter((p): p is NonNullable<typeof p> => !!p).map((p) => p.inMonth);
    const droppedAt = line.trips.flatMap((_, i) => (parts[i] ? [] : [i]));
    const dropped = droppedAt.map((i) => line.trips[i]);
    if (carried.length || dropped.length) {
      // A whole trip past the month's end: every day it flies, and all its block and time away, are the next month's.
      const droppedDays = droppedAt.map((i) => Math.floor((starts[i]! + line.trips[i].tafbHours * HOUR - end) / DAY) + 1);
      const droppedBlock = dropped.reduce((n, t) => n + t.schedule.flatMap((d) => d.legs).filter(operated).reduce((a, l) => a + (l.blockHours ?? 0), 0), 0);
      const sum = (f: (c: TripCarryOver) => number) => carried.reduce((a, p) => a + f(p.carry), 0);
      // The pack's own counts, less what's carried: they count landings and duty periods across the carry-over.
      const carriedLandings = sum((c) => c.landings) + dropped.reduce((n, t) => n + t.landings, 0);
      const carriedDuties = sum((c) => c.dutyPeriods) + dropped.reduce((n, t) => n + tripDutyPeriods(t), 0);
      const landings = Math.max(0, line.totalLandings - carriedLandings);
      const dutyPeriods = Math.max(0, lineDutyPeriods(line) - carriedDuties);
      result = {
        month: { ...line, trips, totalLandings: landings, totalDepartures: landings, totalDutyPeriods: dutyPeriods },
        carry: {
          month: nextMonthName(pack),
          days: Math.max(0, ...carried.map((p) => p.carry.days), ...droppedDays),
          dutyPeriods: carriedDuties,
          landings: carriedLandings,
          blockHours: sum((c) => c.blockHours) + droppedBlock,
          tafbHours: sum((c) => c.tafbHours) + dropped.reduce((n, t) => n + t.tafbHours, 0),
          creditHours: line.carryOverCreditHours ?? 0,
          printedBlockHours: line.carryOverBlockHours ?? 0,
          trips: [...carried.map((p) => p.inMonth.pairingNumber), ...dropped.map((t) => t.pairingNumber)],
        },
      };
    }
  }
  cache.set(line, { key, ...result });
  return result;
}

/**
 * The line as its bid month: every trip cut at the month's end (`splitTrip`), its landings and duty periods counted
 * inside it. Credit, block, TAFB and days off are the pack's own, already this month's; its C/O credit and block stay
 * as printed, beside them, not in them. The same line back when nothing runs past the month (or its dates aren't known).
 */
export function monthLine(line: Line, pack: PackDates): Line {
  return split(line, pack).month;
}

/** What the line carries into the next month, or null when it stays inside its own. */
export function lineCarryOver(line: Line, pack: PackDates): LineCarryOver | null {
  return split(line, pack).carry;
}

/** A trip's own carry-over within its line (null when it stays inside the month). */
export function tripCarryOver(trip: Trip, pack: PackDates): TripCarryOver | null {
  return splitTrip(trip, pack)?.carry ?? null;
}

/** What a trip of the pack carries into the next month, with the C/O credit its line prints for it; null when it stays inside its own. */
export function tripCarryInPack(pack: Pick<BidPack, "lines"> & PackDates, trip: Trip): (TripCarryOver & { month: string; creditHours: number }) | null {
  const carry = tripCarryOver(trip, pack);
  if (!carry) return null;
  const line = pack.lines.find((l) => l.trips.includes(trip)) ?? pack.lines.find((l) => l.trips.some((t) => t.id === trip.id && t.startDayIndex === trip.startDayIndex));
  return { ...carry, month: nextMonthName(pack), creditHours: line ? (lineCarryOver(line, pack)?.creditHours ?? 0) : 0 };
}

/** "6:08 C/O into November", or "2 days into November" when no credit carries — how a carry-over is said in words. */
export function carryOverWords(c: { days: number; creditHours: number; month: string }): string {
  if (c.creditHours > 0) {
    const m = Math.round(c.creditHours * 60);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} C/O into ${c.month}`;
  }
  return `${c.days} day${c.days === 1 ? "" : "s"} into ${c.month}`;
}
