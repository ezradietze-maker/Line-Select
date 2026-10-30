import { DateTime } from "luxon";
import { dateLineCrossing } from "@/lib/date-line";
import { buildDateLineDays, buildHomeDays, buildZuluCalendarDays, type TimeMode, type TimelineDay, type TimelineSegment } from "@/lib/trip-timeline";
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
  /** The evening before a trip that reports just after midnight — the grid gives this day to that trip (it isn't a day off), but nothing flies on it, so it sits outside the trip's own numbered days. */
  isPreReport?: boolean;
  /**
   * A trip's tail that runs onto a day the grid doesn't give it — most often landing just after midnight on a day the
   * bid pack still counts as off. Shown on that day rather than dropped.
   */
  spill?: { tripIndex: number; segments: TimelineSegment[] };
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
 * Days are the base's own calendar days (`buildHomeDays`) — the calendar the
 * line grid and its days off are counted on — so each trip's days line up
 * with the grid's, whatever time zones the trip crosses, and nothing in a trip
 * falls off the calendar. In Zulu (`mode`) the days are Zulu days instead,
 * midnight Z to midnight Z: each trip moves to the Zulu dates it flies on (an
 * evening report at a US base is already the next day in Zulu), and a day is
 * off when no trip touches it — the bid pack's own days off are counted on the
 * base's calendar, so they don't apply.
 *
 * A trip that crosses the date line is laid out on local dates and clocks instead (`buildDateLineDays`), the way the
 * ex-pilot draws one: eastbound the flight runs back to the date it lands on and the layover carries on from there;
 * westbound the flight is bold for its real length and a squiggle for the hours the clock jumps.
 */
export function buildLineMonthCalendar(line: Line, bidPeriodStart: string | null, bidPeriodDays: number, mode: TimeMode): LineMonthCalendar {
  const placementIsReal = bidPeriodStart !== null && line.trips.every((t) => t.startDayIndex !== null);

  const spans: Span[] = placementIsReal ? line.trips.map((t, i) => ({ trip: t, tripIndex: i, start: t.startDayIndex! })) : synthesizeSpans(line);

  const zulu = mode === "zulu";
  const crossesDateLine = (t: Trip) => t.schedule.some((d) => d.legs.some((l) => dateLineCrossing(l.depAirport, l.arrAirport) !== null));
  const timelineBySpan: { span: Span; timeline: TimelineDay[] }[] = spans.map((span) => {
    if (!zulu) {
      const local = crossesDateLine(span.trip) ? buildDateLineDays(span.trip) : [];
      return { span, timeline: local.length ? local : buildHomeDays(span.trip, mode) };
    }
    // Its first Zulu day is its first base day moved by however far apart the two dates are when it reports.
    const timeline = buildZuluCalendarDays(span.trip);
    const homeFirst = buildHomeDays(span.trip, "local")[0]?.date;
    const zuluFirst = timeline[0]?.date;
    const shift = homeFirst && zuluFirst ? Math.round(DateTime.fromISO(zuluFirst).diff(DateTime.fromISO(homeFirst), "days").days) : 0;
    return { span: { ...span, start: span.start + shift }, timeline };
  });
  /** How many days a trip covers on this calendar. */
  const lengthOf = (e: (typeof timelineBySpan)[number]) => (zulu ? Math.max(1, e.timeline.length) : e.span.trip.days);
  const totalDays = Math.max(bidPeriodDays, ...timelineBySpan.map((e) => e.span.start + lengthOf(e)));
  const base = placementIsReal ? DateTime.fromISO(bidPeriodStart!, { zone: "utc" }) : null;

  // Which trip owns each day. When the line's own grid says which days are off
  // ("---"), that's the truth: every other day belongs to whichever trip most
  // recently started (a blank cell continues it), so days off and each trip's
  // footprint match the bid pack exactly. Without it, fall back to laying each
  // trip out from its start for its own day count.
  const gridOff = placementIsReal && line.gridOffDays && !zulu ? new Set(line.gridOffDays) : null;
  const owner: (number | "off" | null)[] = new Array(totalDays).fill(null);
  const preReport = new Set<number>();
  if (gridOff) {
    // A blank cell continues the trip that most recently started — but only
    // back to the last day off: a trip never resumes across one. A blank
    // cell with no trip running is the evening before the next one (every
    // such day across 2,054 real lines sits directly before a trip that
    // reports just after midnight), not a carry-in from last month.
    const byStart = [...spans].sort((x, y) => x.start - y.start);
    let current: Span | null = null;
    let next = 0;
    for (let i = 0; i < totalDays; i++) {
      while (next < byStart.length && byStart[next].start <= i) current = byStart[next++];
      if (gridOff.has(i)) {
        owner[i] = "off";
        current = null;
        continue;
      }
      if (current) {
        owner[i] = current.tripIndex;
      } else if (byStart[next]?.start === i + 1) {
        owner[i] = byStart[next].tripIndex;
        preReport.add(i);
      } else {
        // Nothing has started yet: a trip carried in from the previous bid period.
        owner[i] = null;
      }
    }
  } else {
    for (let i = 0; i < totalDays; i++) {
      const entry = timelineBySpan.find((e) => i >= e.span.start && i < e.span.start + lengthOf(e));
      owner[i] = entry ? entry.span.tripIndex : "off";
    }
  }

  /** First and last day each trip occupies, and how many days that is. */
  const footprint = new Map<number, { first: number; last: number; count: number }>();
  owner.forEach((o, i) => {
    if (typeof o !== "number" || preReport.has(i)) return;
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

    if (preReport.has(i)) {
      days.push({
        dayIndex: i,
        date,
        weekday,
        isOff: false,
        tripIndex: o,
        tripDayNumber: null,
        tripDayCount: null,
        hasSchedule: true,
        segments: [],
        isTripStart: false,
        isTripEnd: false,
        isPreReport: true,
      });
      continue;
    }

    const entry = timelineBySpan.find(({ span }) => span.tripIndex === o)!;
    const f = footprint.get(o)!;
    const tripDayNumber = i - f.first + 1;
    // The trip's own home-calendar day for this date: counted from the day it starts.
    const timelineDay = entry.timeline.find((d) => d.dayNumber === i - entry.span.start + 1);

    days.push({
      dayIndex: i,
      date,
      weekday,
      isOff: false,
      tripIndex: o,
      tripDayNumber,
      // A trip that lands the day the next one starts still counts that day as one of its own (see `countSharedLastDays`).
      tripDayCount: Math.max(f.count, entry.span.trip.days),
      hasSchedule: entry.span.trip.schedule.length > 0,
      segments: timelineDay?.segments ?? [],
      isTripStart: i === f.first,
      // Ends here only if nothing of it runs on past this day — a trip landing the day the next one starts (or just
      // after midnight on a day off) ends on that later day instead, shown there.
      isTripEnd: i === f.last && entry.span.start + entry.timeline.length - 1 <= i,
    });
  }

  // Anything a trip does on a day the grid doesn't give it is still shown, on that day.
  for (const { span, timeline } of timelineBySpan) {
    for (const td of timeline) {
      const i = span.start + td.dayNumber - 1;
      const day = days[i];
      if (!day || day.tripIndex === span.tripIndex || td.segments.length === 0) continue;
      day.spill = { tripIndex: span.tripIndex, segments: td.segments };
    }
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
  const working = workingDayIndices(line, bidPeriodStart, bidPeriodDays);
  if (!working) return null;

  const base = DateTime.fromISO(bidPeriodStart!, { zone: "utc" });
  const counts = new Map<string, WeekdayFlyingCount>();
  for (let i = 0; i < bidPeriodDays; i++) {
    const weekday = base.plus({ days: i }).toFormat("ccc");
    const entry = counts.get(weekday) ?? { weekday, totalOccurrences: 0, flyingCount: 0 };
    entry.totalOccurrences++;
    if (working.has(i)) entry.flyingCount++;
    counts.set(weekday, entry);
  }

  return Array.from(counts.values());
}

/**
 * The bid-period day indices this line is NOT off — the grid's own day-off
 * marks when it has them, otherwise each trip laid out from its real start.
 * Null when placement isn't grid-confirmed real, same as `weekdayFlyingPattern`.
 */
export function workingDayIndices(line: Line, bidPeriodStart: string | null, bidPeriodDays: number): Set<number> | null {
  const placementIsReal = bidPeriodStart !== null && line.trips.every((t) => t.startDayIndex !== null);
  if (!placementIsReal) return null;

  const spans = line.trips.map((t) => ({ start: t.startDayIndex!, days: t.days }));
  const gridOff = line.gridOffDays ? new Set(line.gridOffDays) : null;
  const working = new Set<number>();
  for (let i = 0; i < bidPeriodDays; i++) {
    const isOff = gridOff ? gridOff.has(i) : !spans.some((s) => i >= s.start && i < s.start + s.days);
    if (!isOff) working.add(i);
  }
  return working;
}
