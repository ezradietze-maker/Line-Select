import { buildLineMonthCalendar } from "@/lib/line-month";
import type { Line } from "@/types/bidpack";

export type MonthGridCellKind = "off" | "trip" | "layover" | "estimated";

export interface MonthGridCell {
  dayIndex: number;
  /** Day of the month ("28", "1", …) when real dates are known; otherwise the bid-period day number, so the grid still reads. */
  label: string;
  kind: MonthGridCellKind;
  tripIndex: number | null;
  /** The city a layover starts in on this day — set on the day the pilot checks into the hotel, not the days the layover merely continues through. */
  layoverCode: string | null;
  isTripStart: boolean;
  /** Plain-language description for the cell's tooltip / screen reader. */
  title: string;
}

export interface MonthGrid {
  cells: MonthGridCell[];
  /** Column headers, rotated to start on the bid period's own first weekday so a 28-day period is always exactly four full rows. Null when real dates aren't known. */
  weekdayHeaders: string[] | null;
  placementIsReal: boolean;
}

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "ICN · 24h05m at hotel" -> "ICN". The city is always the leading token of a layover segment's own inline label. */
function layoverCityFromInline(inlineStart: string): string | null {
  const code = inlineStart.split(" · ")[0]?.trim();
  return code && /^[A-Z]{3,4}$/.test(code) ? code : null;
}

/**
 * The whole bid month as a plain calendar grid: which days are trips, which
 * are days off, and which city each layover starts in. Deliberately far less
 * detailed than the per-trip hour-by-hour chart — its job is the at-a-glance
 * read ("where are my days off, where do I overnight"), at a size that fits
 * a card and stays legible, where the detailed chart is one tap away.
 */
export function buildMonthGrid(line: Line, bidPeriodStart: string | null, bidPeriodDays: number): MonthGrid {
  const calendar = buildLineMonthCalendar(line, bidPeriodStart, bidPeriodDays, "local");

  const cells: MonthGridCell[] = calendar.days.map((day) => {
    const label = day.date ? String(Number(day.date.slice(8, 10))) : String(day.dayIndex + 1);
    const dateText = day.date && day.weekday ? `${day.weekday} ${day.date.slice(5)}` : `Day ${day.dayIndex + 1}`;

    if (day.isOff) {
      return { dayIndex: day.dayIndex, label, kind: "off", tripIndex: null, layoverCode: null, isTripStart: false, title: `${dateText} — day off` };
    }

    const tripLabel = `Trip ${(day.tripIndex ?? 0) + 1}, day ${day.tripDayNumber} of ${day.tripDayCount}`;

    if (!day.hasSchedule) {
      return { dayIndex: day.dayIndex, label, kind: "estimated", tripIndex: day.tripIndex, layoverCode: null, isTripStart: day.isTripStart, title: `${dateText} — ${tripLabel} (exact daily detail unavailable)` };
    }

    const layoverSegment = day.segments.find((s) => s.kind === "layover" && !s.continuesFromPreviousDay);
    const layoverCode = layoverSegment ? layoverCityFromInline(layoverSegment.inlineStart) : null;
    return {
      dayIndex: day.dayIndex,
      label,
      kind: layoverCode ? "layover" : "trip",
      tripIndex: day.tripIndex,
      layoverCode,
      isTripStart: day.isTripStart,
      title: `${dateText} — ${tripLabel}${layoverCode ? `, layover in ${layoverCode}` : ""}`,
    };
  });

  const firstWeekday = calendar.days[0]?.weekday ?? null;
  const startAt = firstWeekday ? WEEKDAY_ORDER.indexOf(firstWeekday) : -1;
  const weekdayHeaders =
    calendar.placementIsReal && startAt >= 0
      ? Array.from({ length: 7 }, (_, i) => WEEKDAY_ORDER[(startAt + i) % 7])
      : null;

  return { cells, weekdayHeaders, placementIsReal: calendar.placementIsReal };
}

/** One sentence for screen readers and tooltips: the shape of the month without reading 28 cells aloud. */
export function monthGridSummary(grid: MonthGrid): string {
  const off = grid.cells.filter((c) => c.kind === "off").length;
  const trips = new Set(grid.cells.filter((c) => c.tripIndex !== null).map((c) => c.tripIndex)).size;
  const layovers = grid.cells.map((c) => c.layoverCode).filter((c): c is string => !!c);
  const layoverText = layovers.length > 0 ? ` Layovers: ${layovers.join(", ")}.` : "";
  return `${trips} trip${trips === 1 ? "" : "s"}, ${off} day${off === 1 ? "" : "s"} off.${layoverText}`;
}
