import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { Trip } from "@/types/bidpack";

/**
 * The dates of a trip's full days in its layover cities (`fullDaysOf` in metrics/trip-facts.ts), each with its city and
 * whether it's "just barely" one — on the city's own date, which is the base calendar's for the part of the day that
 * matters. Empty when the trip can't be placed on its dates.
 */
export function fullDayDates(trip: Trip, pack: { bidPeriodStart: string | null; base: string }): Map<string, { city: string; barely: boolean }> {
  const out = new Map<string, { city: string; barely: boolean }>();
  const report = tripReportUtc(pack, trip);
  if (report === null) return out;
  for (const l of computeTripFacts(trip).layovers) {
    const zone = timezoneForAirport(l.city);
    if (!zone || !l.fullDays) continue;
    const landed = DateTime.fromMillis(report + l.start * 60_000, { zone }).startOf("day");
    l.fullDayOffsets.forEach((offset, k) => {
      const date = landed.plus({ days: offset }).toISODate();
      if (date) out.set(date, { city: l.city, barely: l.barelyFullDay && k === l.fullDayOffsets.length - 1 });
    });
  }
  return out;
}
