import { DateTime } from "luxon";
import type { Line } from "@/types/bidpack";

/**
 * How a line's days off are laid out across the real calendar — read from the
 * line's own printed grid (`Line.gridOffDays`), which marks every day off and
 * always adds up to the printed DAYS OFF. Null whenever the line has no grid
 * marks (an estimated line, or a pack parsed before they were kept): a
 * pattern guessed from trip lengths would look exact while being invented.
 */

/** The longest run of consecutive days off inside the bid period — "my days off in one block" versus scattered singles. */
export function longestDaysOffBlock(line: Line): number | null {
  if (line.estimated || !line.gridOffDays) return null;
  const days = [...new Set(line.gridOffDays)].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Saturdays and Sundays this line has off — needs the bid period's real first date to know which days those are. */
export function weekendDaysOff(line: Line, bidPeriodStart: string | null): number | null {
  if (line.estimated || !line.gridOffDays || !bidPeriodStart) return null;
  const start = DateTime.fromISO(bidPeriodStart, { zone: "utc" });
  if (!start.isValid) return null;
  return [...new Set(line.gridOffDays)].filter((i) => start.plus({ days: i }).weekday >= 6).length;
}

/** The real calendar date ("2026-10-14") of a day index within the bid period. */
export function dateOfDayIndex(bidPeriodStart: string, dayIndex: number): string {
  return DateTime.fromISO(bidPeriodStart, { zone: "utc" }).plus({ days: dayIndex }).toISODate()!;
}
