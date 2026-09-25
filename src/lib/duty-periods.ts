import type { Line, Trip } from "@/types/bidpack";

/**
 * Duty periods — report-to-release stretches — counted the way the bid pack
 * prints them, hotel standby days included. Not the same thing as
 * `departures`/`landings` (a duty period can hold several flights, or none),
 * nor `days` (several duty periods can share one calendar day span). Reads
 * the stored figure and falls back to what a trip's own layovers say for a
 * trip saved before it was tracked: one duty period per layover, plus the last.
 */
export function tripDutyPeriods(trip: Trip): number {
  return trip.dutyPeriods ?? (trip.layoverDetails?.length ?? 0) + 1;
}

export function lineDutyPeriods(line: Line): number {
  return line.totalDutyPeriods ?? line.trips.reduce((sum, t) => sum + tripDutyPeriods(t), 0);
}
