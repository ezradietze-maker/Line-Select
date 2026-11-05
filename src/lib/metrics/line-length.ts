import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { tripStartUtc } from "@/lib/flights/needs";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * How long a line's flying runs: its bid month, or — when its last trip runs past the month's end into the next — to
 * that trip's last landing. The bid pack prints every line over a week more of columns than its month for this (the
 * paper view does too). What the line is judged on stops at the month's end (`lib/bid-month.ts`); this is only how
 * wide the printed grid needs to be.
 *
 * A bid month is four weeks (eight a year) or five (four a year). A pilot gives counts — departures, trips — for a
 * four-week month, so a five-week month's counts are judged at 28 days' worth (`fourWeekFactor`).
 */

const DAY = 86_400_000;

/**
 * The line's length in days: its bid period, or — when its flying runs past it — from the period's first day to its last
 * landing. Without real dates (an estimated line), its bid period.
 */
export function lineLengthDays(line: Pick<Line, "trips">, bidPack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">): number {
  if (!bidPack.bidPeriodStart) return bidPack.bidPeriodDays;
  const start = DateTime.fromISO(bidPack.bidPeriodStart, { zone: timezoneForAirport(bidPack.base) ?? "UTC" }).toMillis();
  let last = start;
  for (const trip of line.trips) {
    const report = tripStartUtc(bidPack, trip);
    if (report === null) continue;
    const landed = Math.max(0, ...trip.schedule.flatMap((d) => d.legs.map((l) => l.endMinutes)));
    last = Math.max(last, report + landed * 60_000);
  }
  return Math.max(bidPack.bidPeriodDays, (last - start) / DAY);
}

/** A bid month's counts at four weeks' worth: 1 for a four-week month, 0.8 for a five-week one. */
export function fourWeekFactor(bidPack: Pick<BidPack, "bidPeriodDays">): number {
  return bidPack.bidPeriodDays > 0 ? 28 / bidPack.bidPeriodDays : 1;
}
