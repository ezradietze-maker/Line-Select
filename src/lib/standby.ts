import type { Line, Trip } from "@/types/bidpack";

/** Hotel-standby days on one trip — 0 when the bid pack predates standby tracking. */
export function tripStandbyDays(trip: Trip): number {
  return trip.standbyDays ?? 0;
}

/** Total days a line spends on standby at a layover hotel: on call, paid the standby credit, not flying. */
export function lineStandbyDays(line: Line): number {
  return line.trips.reduce((sum, t) => sum + tripStandbyDays(t), 0);
}

/** Whether any line in the pack has hotel standby at all — when none does, a standby preference can't separate one line from another and shouldn't be asked about or scored. */
export function packHasStandby(lines: Line[]): boolean {
  return lines.some((l) => lineStandbyDays(l) > 0);
}

/** What one hotel-standby day pays: the same 3:12 guarantee printed on every standby row in the packs seen so far (3.2 credit hours). */
export const STANDBY_CREDIT_PER_DAY: number | null = 3.2;

/**
 * A hotel-standby duty row prints a ground-duty code where a flight number would be — "STHOTL" in every pack seen. Matched by the code's own "ST" prefix rather than that one spelling, so a sibling code doesn't silently drop out of the count.
 */
const STANDBY_DUTY_CODE_RE = /^ST[A-Z]{2,6}$/;

export function isStandbyDutyCode(flightNumber: string): boolean {
  return STANDBY_DUTY_CODE_RE.test(flightNumber);
}

/**
 * Brings a trip saved before standby was tracked up to date from its own saved schedule, so a pilot doesn't have to re-upload just to see standby: flags each standby leg and counts the days. A trip that already has a count is left alone; one with no schedule (nothing to read it from) stays as it was.
 */
export function backfillStandby(trip: Trip): Trip {
  if (trip.standbyDays !== undefined || trip.schedule.length === 0) return trip;
  let days = 0;
  const schedule = trip.schedule.map((duty) => ({
    ...duty,
    legs: duty.legs.map((leg) => {
      const isStandby = isStandbyDutyCode(leg.flightNumber);
      if (isStandby) days++;
      return { ...leg, isStandby };
    }),
  }));
  return { ...trip, schedule, standbyDays: days };
}

/**
 * The trip's schedule with hotel-standby rows removed from every duty's legs, for statistics about flying (red-eyes, block time, legs per duty, turn times): a standby row is on-call time at a hotel, not a departure, and would otherwise be counted as a flight with a departure time, a leg and a duty of its own. Duties themselves (and their layovers) are kept.
 */
export function flyingSchedule(trip: Trip): Trip["schedule"] {
  return trip.schedule.map((duty) => ({ ...duty, legs: duty.legs.filter((l) => !l.isStandby) }));
}
