import type { TimelineSegment } from "@/lib/trip-timeline";

/**
 * A day of flying drawn the way the ex-pilot drew his lines in his paper organizer: each leg a line with a tick at each
 * end, as long as the flight and placed left to right by the time of day, the cities written under its ends — the
 * shared city once where two legs meet ("OAK AFW OAK"). A flight still in the air at midnight runs off the right edge
 * and on into the next day. A pilot sizes a day up from the picture — early or late, long or short, how much of the
 * day is flying — before reading a word of it.
 *
 * This is the layout behind that picture, shared by the month calendar's day cells, the trip's own day rows and the
 * interview's trip cards, so a pilot learns one picture once. Positions are minutes of the day (0–1440) on whatever
 * clock the segments were laid out on — the base's, on the month calendar and the trip rows.
 */

const DAY = 24 * 60;

export interface BarLeg {
  start: number;
  end: number;
  /** The city it leaves — null when the leg is still in the air from the day before. */
  from: string | null;
  /** The city it lands — null when it's still in the air at midnight. */
  to: string | null;
  deadhead: boolean;
  /** "HH:MM" it leaves and lands, on each airport's own clock (or Zulu), as the bid pack prints them. */
  depClock: string | null;
  arrClock: string | null;
}

export interface BarSpan {
  start: number;
  end: number;
}

/** A piece of a hotel stay on this day. */
export interface BarStay extends BarSpan {
  city: string;
  hours: number;
  hotel: string | null;
  /** The stay's piece that carries its words — one per stay, on the day it's longest. */
  labeled: boolean;
}

export interface BarLabel {
  /** Minute of the day it sits under (or above). */
  at: number;
  text: string;
  /** 0 next to the bar, 1 a line further out — where it would have run into the label before it. */
  row: 0 | 1;
}

export interface DayBars {
  legs: BarLeg[];
  /** Report to release: the time on duty, flights and the waits between them. */
  duty: BarSpan[];
  standby: (BarSpan & { place: string })[];
  stays: BarStay[];
  cities: BarLabel[];
  times: BarLabel[];
}

/** A fragment whose clock end reads before its start runs to midnight. */
function endOf(s: TimelineSegment): number {
  return s.endMinuteOfDay < s.startMinuteOfDay ? DAY : s.endMinuteOfDay;
}

const DUTY_KINDS = new Set(["ground", "connection", "flying", "deadhead"]);
/** Pieces of duty this close together are one duty — the bid pack's printed times leave a minute here and there. */
const DUTY_JOIN_MINUTES = 5;

function dutySpans(segs: TimelineSegment[]): BarSpan[] {
  const spans: BarSpan[] = [];
  for (const s of segs.filter((x) => DUTY_KINDS.has(x.kind)).sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)) {
    const last = spans.at(-1);
    if (last && s.startMinuteOfDay <= last.end + DUTY_JOIN_MINUTES) last.end = Math.max(last.end, endOf(s));
    else spans.push({ start: s.startMinuteOfDay, end: endOf(s) });
  }
  return spans;
}

/**
 * Labels in order along the day, each moved a line out when it would sit on the one before it (closer than `minGap`
 * minutes) — and dropped when it would sit on both lines' last labels. The words are always in the day's detail.
 */
export function stagger(points: { at: number; text: string }[], minGap: number): BarLabel[] {
  const out: BarLabel[] = [];
  const lastAt: [number, number] = [-Infinity, -Infinity];
  for (const p of [...points].sort((a, b) => a.at - b.at)) {
    const row = p.at - lastAt[0] >= minGap ? 0 : p.at - lastAt[1] >= minGap ? 1 : null;
    if (row === null) continue;
    lastAt[row] = p.at;
    out.push({ at: p.at, text: p.text, row });
  }
  return out;
}

/**
 * One day's picture from its timeline pieces (`buildHomeDays` / `buildTimelineDays`). `minGap` is how many minutes of
 * the day a label needs to itself at the width it's drawn — a city two legs share is written once, between them, when
 * the two would otherwise sit on each other.
 */
export function dayBars(segments: TimelineSegment[], minGap: number, stayLabeled: (s: TimelineSegment) => boolean = (s) => !s.continuesFromPreviousDay): DayBars {
  const ordered = [...segments].sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay || endOf(a) - endOf(b));
  const legs: BarLeg[] = ordered
    .filter((s) => (s.kind === "flying" || s.kind === "deadhead") && s.leg)
    .map((s) => ({
      start: s.startMinuteOfDay,
      end: endOf(s),
      from: s.continuesFromPreviousDay ? null : s.leg!.dep,
      to: s.continuesToNextDay ? null : s.leg!.arr,
      deadhead: s.kind === "deadhead",
      depClock: s.continuesFromPreviousDay ? null : (s.startClock ?? s.leg!.depClock),
      arrClock: s.continuesToNextDay ? null : (s.endClock ?? s.leg!.arrClock),
    }));

  const cityPoints: { at: number; text: string }[] = [];
  const timePoints: { at: number; text: string }[] = [];
  legs.forEach((l, i) => {
    const prev = legs[i - 1];
    if (l.from) {
      const shared = prev && prev.to === l.from && l.start - prev.end < minGap;
      if (shared) cityPoints[cityPoints.length - 1] = { at: (prev.end + l.start) / 2, text: l.from };
      else cityPoints.push({ at: l.start, text: l.from });
    }
    if (l.to) cityPoints.push({ at: l.end, text: l.to });
    if (l.depClock) timePoints.push({ at: l.start, text: l.depClock });
    if (l.arrClock) timePoints.push({ at: l.end, text: l.arrClock });
  });

  return {
    legs,
    duty: dutySpans(ordered),
    standby: ordered.filter((s) => s.kind === "standby").map((s) => ({ start: s.startMinuteOfDay, end: endOf(s), place: s.startAirport ?? s.inlineStart ?? "" })),
    stays: ordered
      .filter((s) => s.kind === "layover" && s.stay)
      .map((s) => ({ start: s.startMinuteOfDay, end: endOf(s), city: s.stay!.city, hours: s.stay!.hours, hotel: s.stay!.hotel, labeled: stayLabeled(s) })),
    cities: stagger(cityPoints, minGap),
    times: stagger(timePoints, minGap),
  };
}

/**
 * Which piece of each hotel stay carries its words, across a trip's days: the longest, so "SEA 15h48" sits where
 * there's room for it rather than on the hour before midnight. Pieces of one stay are told apart by running on from
 * the day before.
 */
export function labeledStayPieces(days: TimelineSegment[][]): Set<TimelineSegment> {
  const best = new Set<TimelineSegment>();
  let current: TimelineSegment | null = null;
  for (const segs of days) {
    for (const s of [...segs].sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)) {
      if (s.kind !== "layover" || !s.stay) continue;
      if (!s.continuesFromPreviousDay || !current) {
        current = s;
        best.add(s);
      } else if (endOf(s) - s.startMinuteOfDay > endOf(current) - current.startMinuteOfDay) {
        best.delete(current);
        best.add(s);
        current = s;
      }
    }
  }
  return best;
}
