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

/** A leg is standby when it's flagged so, or — on a trip saved before the flag existed — when its own flight-number field carries the standby duty code. */
export function isStandbyLeg(leg: { flightNumber: string; isStandby?: boolean }): boolean {
  return leg.isStandby ?? isStandbyDutyCode(leg.flightNumber);
}

/**
 * The trip's schedule as flying only: every hotel-standby row removed, and any duty that was nothing but standby dropped entirely (along with the "layover" printed on it, which is really just the pilot still sitting in the hotel). Standby is on-call time, not a report, a rest period or a flight, so statistics about any of those must be computed from this, never from `trip.schedule`.
 */
export function flyingSchedule(trip: Trip): Trip["schedule"] {
  return trip.schedule
    .map((duty) => ({ ...duty, legs: duty.legs.filter((l) => !isStandbyLeg(l)) }))
    .filter((duty, i) => duty.legs.length > 0 || trip.schedule[i].legs.length === 0);
}

/**
 * Brings a trip saved by an earlier version up to date from its own saved schedule, so a pilot never has to re-upload for it: flags each standby leg (what draws the chart's standby color), counts the days. Saved trips come in several generations (no standby fields at all; a day count but unflagged legs), so this is safe to run on any of them and does nothing to a trip with no saved schedule.
 */
export function backfillStandby(trip: Trip): Trip {
  if (trip.schedule.length === 0) return trip;
  const legs = trip.schedule.flatMap((d) => d.legs);
  const days = legs.filter(isStandbyLeg).length;
  if (days === 0 && legs.every((l) => l.isStandby !== undefined)) return trip;

  const schedule = trip.schedule.map((duty) => ({
    ...duty,
    legs: duty.legs.map((leg) => ({ ...leg, isStandby: isStandbyLeg(leg) })),
  }));
  return { ...trip, schedule, standbyDays: days };
}
