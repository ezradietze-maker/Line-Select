import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { tripStartUtc } from "@/lib/flights/needs";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * How long a line's month really is. A bid month is four weeks, but a line's last trip can run past its end
 * into the next week of the grid — the bid pack prints every line over five weeks of columns and marks that flying as
 * carry-over ("C/O"). Pilots call such a line a five-week line, and judge it that way: the ex-pilot gave one number of
 * departures and of commutes to base for a four-week line and one more of each for a five-week line.
 *
 * So a line's departures (and trips, for a pilot who lives at base) are judged over the line's own length: a line flying
 * four days past a four-week month counts 28/32 of them. Commutes to base and hotel
 * nights there are left as counted: adjusted too, they didn't help his sort and cost a simulated pilot's.
 * Measured to the line's last landing, not by whole weeks or calendar days: a trip landing at 00:30 on the first day of
 * the next month adds half an hour, not a week (Oct 2026, the ex-pilot's own sort: whole weeks took his readings from
 * 97.6% to 96.1% of line pairs; to the last landing, 97.6% stayed and with his trip picks 97.0% → 97.1%).
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

/** What a line's count is worth over its bid month: 4 departures over a 32-day line in a 28-day month → 3.5. */
export function perMonthFactor(line: Pick<Line, "trips">, bidPack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">): number {
  return bidPack.bidPeriodDays / lineLengthDays(line, bidPack);
}
