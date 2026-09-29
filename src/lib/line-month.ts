import { DateTime } from "luxon";
import { buildLocalDaysWithMode, type TimeMode, type TimelineSegment } from "@/lib/trip-timeline";
import type { Line, Trip } from "@/types/bidpack";

export interface LineMonthDay {
  /** 0-indexed offset from the first displayed calendar day. */
  dayIndex: number;
  /** Real calendar date (ISO "YYYY-MM-DD") when `placementIsReal`, else null. */
  date: string | null;
  /** Short weekday label ("Mon") when `placementIsReal`, else null. */
  weekday: string | null;
  isOff: boolean;
  /** Index into the line's own `trips` array, when this day belongs to a trip. */
  tripIndex: number | null;
  /** 1-indexed day within its trip — e.g. 3 of an 8-day trip — for captions. */
  tripDayNumber: number | null;
  tripDayCount: number | null;
  /** True when this trip has no verified minute-by-minute schedule to draw (an estimated line's stand-in trip) — occupied, but nothing to render beyond a placeholder. */
  hasSchedule: boolean;
  segments: TimelineSegment[];
  isTripStart: boolean;
  isTripEnd: boolean;
}

export interface LineMonthCalendar {
  days: LineMonthDay[];
  /**
   * True when every trip on this line has a real, grid-confirmed start day
   * and the bid pack itself has a known start date — the displayed dates
   * and gaps are the pairing schedule's own printed calendar days. False
   * means the layout below is a sequential approximation (see
   * `synthesizeSpans`): real trip shapes and total days off, but not a
   * claim about which specific dates they fall on.
   */
  placementIsReal: boolean;
}

interface Span {
  trip: Trip;
  tripIndex: number;
  start: number;
}

/**
 * When a line's real day placement isn't available (an estimated line, or a
 * bid pack whose grid didn't confidently match), lays trips out in their
 * existing order, distributing the line's own total days-off evenly across
 * the gaps before, between, and after them. An honest approximation of the
 * real shape (right trip lengths, right total days off) — never a claim
 * about which specific dates anything falls on.
 */
function synthesizeSpans(line: Line): Span[] {
  const gaps = line.trips.length + 1;
  const base = Math.floor(line.daysOff / gaps);
  let remainder = line.daysOff % gaps;

  let cursor = 0;
  const spans: Span[] = [];
  for (let i = 0; i < line.trips.length; i++) {
    const gapSize = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    cursor += gapSize;
    spans.push({ trip: line.trips[i], tripIndex: i, start: cursor });
    cursor += line.trips[i].days;
  }
  return spans;
}

/**
 * Lays a whole line's trips out across the bid month as real calendar-day
 * columns, days off included — the data behind the mini month calendar.
 * Day-column *structure* always follows local-calendar day-splitting
 * (`buildLocalDaysWithMode`) regardless of `mode`, so the whole month's
 * shape stays stable when the Local/Zulu toggle is pressed; `mode` still
 * switches which clock is primary within each segment's own labels, same
 * as the full per-trip chart.
 */
export function buildLineMonthCalendar(
  line: Line,
  bidPeriodStart: string | null,
  bidPeriodDays: number,
  mode: TimeMode
): LineMonthCalendar {
  const placementIsReal = bidPeriodStart !== null && line.trips.every((t) => t.startDayIndex !== null);

  const spans: Span[] = placementIsReal
    ? line.trips.map((t, i) => ({ trip: t, tripIndex: i, start: t.startDayIndex! }))
    : synthesizeSpans(line);

  const totalDays = Math.max(bidPeriodDays, ...spans.map((s) => s.start + s.trip.days));
  const base = placementIsReal ? DateTime.fromISO(bidPeriodStart!, { zone: "utc" }) : null;

  const timelineBySpan = spans.map((span) => ({
    span,
    timeline: buildLocalDaysWithMode(span.trip, mode),
  }));

  // Which trip owns each day. When the line's own grid says which days are off
  // ("---"), that's the truth: every other day belongs to whichever trip most
  // recently started (a blank cell continues it), so days off and each trip's
  // footprint match the bid pack exactly. Without it, fall back to laying each
  // trip out from its start for its own day count.
  const gridOff = placementIsReal && line.gridOffDays ? new Set(line.gridOffDays) : null;
  const owner: (number | "off" | null)[] = new Array(totalDays).fill(null);
  if (gridOff) {
    const byStart = [...spans].sort((x, y) => x.start - y.start);
    for (let i = 0; i < totalDays; i++) {
      if (gridOff.has(i)) {
        owner[i] = "off";
        continue;
      }
      let current: Span | null = null;
      for (const span of byStart) if (span.start <= i) current = span;
      // Nothing has started yet: a trip carried in from the previous bid period.
      owner[i] = current ? current.tripIndex : null;
    }
  } else {
    for (let i = 0; i < totalDays; i++) {
      const entry = timelineBySpan.find(({ span }) => i >= span.start && i < span.start + span.trip.days);
      owner[i] = entry ? entry.span.tripIndex : "off";
    }
  }

  /** First and last day each trip occupies, and how many days that is. */
  const footprint = new Map<number, { first: number; last: number; count: number }>();
  owner.forEach((o, i) => {
    if (typeof o !== "number") return;
    const f = footprint.get(o);
    if (f) {
      f.last = i;
      f.count++;
    } else footprint.set(o, { first: i, last: i, count: 1 });
  });

  const days: LineMonthDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const date = base ? base.plus({ days: i }).toISODate() : null;
    const weekday = base ? base.plus({ days: i }).toFormat("ccc") : null;
    const o = owner[i];

    if (o === "off") {
      days.push({
        dayIndex: i,
        date,
        weekday,
        isOff: true,
        tripIndex: null,
        tripDayNumber: null,
        tripDayCount: null,
        hasSchedule: false,
        segments: [],
        isTripStart: false,
        isTripEnd: false,
      });
      continue;
    }

    if (o === null) {
      // Carried in from the previous bid period: occupied, with nothing in this pack to say what it is.
      days.push({
        dayIndex: i,
        date,
        weekday,
        isOff: false,
        tripIndex: null,
        tripDayNumber: null,
        tripDayCount: null,
        hasSchedule: false,
        segments: [],
        isTripStart: false,
        isTripEnd: false,
      });
      continue;
    }

    const entry = timelineBySpan.find(({ span }) => span.tripIndex === o)!;
    const f = footprint.get(o)!;
    const tripDayNumber = i - f.first + 1;
    const timelineDay = entry.timeline.find((d) => d.dayNumber === tripDayNumber);

    days.push({
      dayIndex: i,
      date,
      weekday,
      isOff: false,
      tripIndex: o,
      tripDayNumber,
      tripDayCount: f.count,
      hasSchedule: entry.span.trip.schedule.length > 0,
      segments: timelineDay?.segments ?? [],
      isTripStart: i === f.first,
      isTripEnd: i === f.last,
    });
  }

  return { days, placementIsReal };
}

/** Occurrences of one weekday in the displayed bid period, and how many of those this line has the pilot flying rather than off. */
export interface WeekdayFlyingCount {
  weekday: string;
  totalOccurrences: number;
  flyingCount: number;
}

/**
 * The cheap subset of `buildLineMonthCalendar`'s own day-placement logic —
 * no segments/timeline, which this doesn't need — used to check a pilot's
 * stated recurring weekday commitment (`PreferenceFact.recurringWeekday`)
 * against a line's real calendar. Null when placement isn't grid-confirmed
 * real (see `placementIsReal`) — never fabricates a weekday count against a
 * synthesized/estimated layout. Counts are clamped to exactly
 * `bidPeriodDays` (not extended for trip overflow the way the UI calendar
 * is) so every line in the same pack reports the same total occurrences
 * for a given weekday — a fixed property of the bid period itself, not of
 * any one line's trip shapes.
 */
export function weekdayFlyingPattern(line: Line, bidPeriodStart: string | null, bidPeriodDays: number): WeekdayFlyingCount[] | null {
  const placementIsReal = bidPeriodStart !== null && line.trips.every((t) => t.startDayIndex !== null);
  if (!placementIsReal) return null;

  const spans = line.trips.map((t) => ({ start: t.startDayIndex!, days: t.days }));
  const base = DateTime.fromISO(bidPeriodStart!, { zone: "utc" });
  const gridOff = line.gridOffDays ? new Set(line.gridOffDays) : null;

  const counts = new Map<string, WeekdayFlyingCount>();
  for (let i = 0; i < bidPeriodDays; i++) {
    const weekday = base.plus({ days: i }).toFormat("ccc");
    const entry = counts.get(weekday) ?? { weekday, totalOccurrences: 0, flyingCount: 0 };
    entry.totalOccurrences++;
    const isOff = gridOff ? gridOff.has(i) : !spans.some((s) => i >= s.start && i < s.start + s.days);
    if (!isOff) entry.flyingCount++;
    counts.set(weekday, entry);
  }

  return Array.from(counts.values());
}
