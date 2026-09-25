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
