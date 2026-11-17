import { dateLineCrossing, type DateLineDirection } from "@/lib/date-line";
import type { DateLineBack, TimelineSegment } from "@/lib/trip-timeline";

/**
 * A day of flying drawn the way the ex-pilot drew his lines in his paper organizer: each leg a line with a tick at each
 * end, as long as the flight and placed left to right by the time of day, the cities written at its ends — the
 * shared city once where two legs meet ("OAK AFW OAK"). A flight still in the air at midnight runs off the right edge
 * and on into the next day. On the month calendar a layover is a line of its own under the flying, from landing to
 * the next show, with the city and its length rounded to the hour on it ("L/O OAK 28h"). A pilot sizes a day up from
 * the picture — early or late, long or short, how much of the day is flying — before reading a word of it.
 *
 * This is the layout behind that picture, shared by the month calendar's day cells, the trip's own day rows and the
 * interview's trip cards, so a pilot learns one picture once. Positions are minutes of the day (0–1440) on whatever
 * clock the segments were laid out on — the base's, on the month calendar and the trip rows.
 */

const DAY = 24 * 60;

export interface BarLeg {
  start: number;
  end: number;
  /** The city it leaves — null when the leg is still in the air from the day before, or this piece starts mid-air. */
  from: string | null;
  /** The city it lands — null when it's still in the air at midnight, or this piece ends mid-air. */
  to: string | null;
  /** Still in the air from the day before; still in the air at midnight. */
  runsIn: boolean;
  runsOn: boolean;
  deadhead: boolean;
  /** "HH:MM" it leaves and lands, on each airport's own clock (or Zulu), as the bid pack prints them. */
  depClock: string | null;
  arrClock: string | null;
  flightNumber: string;
  /** A ride between airports by road ("GT9999 CAB"), not a flight. */
  cab: boolean;
  /** It crosses the international date line, and which way (see `lib/date-line.ts`). */
  dateLine: DateLineDirection | null;
  /** Drawn back from its takeoff to its landing — east across the date line on the month calendar (`end` < `start`). */
  back?: DateLineBack;
  /** The timeline piece it was drawn from: which trip and duty period it flies in, for the Heat Map. */
  seg?: TimelineSegment;
  /** Across the date line: how far the local clock jumps, in minutes — negative eastbound, positive westbound. */
  clockJump?: number;
  /** West across the date line, local layout: the stretch (minutes of the day) that's the clock's jump, drawn as a squiggle. */
  jump?: { start: number; end: number; minutes: number };
  /** Zulu layout: where it crosses the date line (minute of the day), and how far the local clock jumps there. */
  mark?: { at: number; jumpMinutes: number };
}

export interface BarSpan {
  start: number;
  end: number;
  /** The timeline piece it was drawn from (a duty band's first): which trip and duty period it is, for the Heat Map. */
  seg?: TimelineSegment;
}

/** A piece of a hotel stay on this day. */
export interface BarStay extends BarSpan {
  city: string;
  hours: number;
  hotel: string | null;
  /** The stay's piece that carries its words — one per stay, on the day it's longest. */
  labeled: boolean;
  /** The stay began the day before (its landing isn't on this day), or runs on into the next (its pickup isn't). */
  runsIn: boolean;
  runsOn: boolean;
}

/** A crew-rest hotel during a long sit between two legs of the same duty — at a hub, through the sort. */
export interface BarRest extends BarSpan {
  city: string;
  hours: number;
  hotel: string | null;
}

export interface BarLabel {
  /** Minute of the day it sits over (or under). */
  at: number;
  text: string;
  /** 0 next to the bar, 1 a line further out — where it would have run into the label before it. */
  row: 0 | 1;
  /** A city only deadheads touch — written in the deadhead's color, as the ex-pilot wrote "MEM DH SFO" in blue. */
  deadhead?: boolean;
}

export interface DayBars {
  legs: BarLeg[];
  /** Report to release: the time on duty, flights and the waits between them. */
  duty: BarSpan[];
  standby: (BarSpan & { place: string })[];
  stays: BarStay[];
  rests: BarRest[];
  cities: BarLabel[];
  /**
   * After an eastbound date-line crossing, the hours lived a second time (`secondPass` pieces) — their own picture,
   * drawn on a row under the first time through.
   */
  second?: DayBars;
  /** Every city, unstacked — for laying out side by side on one line (`sideBySide`), as the month calendar does. */
  cityPoints: Omit<BarLabel, "row">[];
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
  for (const s of segs.filter((x) => DUTY_KINDS.has(x.kind) && !x.dateLineBack).sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)) {
    const last = spans.at(-1);
    if (last && s.startMinuteOfDay <= last.end + DUTY_JOIN_MINUTES) last.end = Math.max(last.end, endOf(s));
    else spans.push({ start: s.startMinuteOfDay, end: endOf(s), seg: s });
  }
  return spans;
}

/**
 * Labels in order along the day, each moved a line out when it would sit on the one before it (closer than `minGap`
 * minutes) — and dropped when it would sit on both lines' last labels. The words are always in the day's detail.
 *
 * `half` is how many minutes of the day half a label covers, where it's drawn: a label at the day's edge is nudged in
 * by that much to stay inside it, so it's measured where it lands — "23:59" pulled in beside "16:14" read "16:1423:59".
 */
export function stagger<P extends { at: number; text: string }>(points: P[], minGap: number, half?: (text: string) => number): (P & { row: 0 | 1 })[] {
  const out: (P & { row: 0 | 1 })[] = [];
  const lastAt: [number, number] = [-Infinity, -Infinity];
  const drawnAt = (p: P) => (half ? Math.min(Math.max(p.at, half(p.text)), DAY - half(p.text)) : p.at);
  for (const p of [...points].sort((a, b) => drawnAt(a) - drawnAt(b))) {
    const at = drawnAt(p);
    const row = at - lastAt[0] >= minGap ? 0 : at - lastAt[1] >= minGap ? 1 : null;
    if (row === null) continue;
    lastAt[row] = at;
    out.push({ ...p, row });
  }
  return out;
}

/**
 * Labels side by side on one line, never stacked: each centered over its minute when there's room, else pushed along
 * just clear of the one before — a short leg's two cities read "CAN NRT" — and the lot slid back left when that runs
 * past the day's edge (`bleed` px into the gap beyond it). Returns each label's center in px, in the order given.
 *
 * A day with more cities than its width holds (six on a 90px day) was slid back left as one, and its first cities
 * landed on the day before's last ones. Now the same city either side of a layover is written once, between its two
 * ends, and if that's still too many, the most crowded city between the day's first and last is left off (null), until
 * the rest fit. The words are always in the day's detail.
 */
export function sideBySide(labels: { at: number; text: string }[], widthPx: number, bleed: number, gapPx = 3): (number | null)[] {
  let order = labels.map((_, i) => i).sort((a, b) => labels[a].at - labels[b].at);
  const at = labels.map((l) => l.at);
  const half = (i: number) => (labels[i].text.length * LABEL_CHAR_PX) / 2;
  const fits = () => order.reduce((s, i) => s + half(i) * 2, 0) + gapPx * (order.length - 1) <= widthPx + 2 * bleed;
  for (let k = 1; k < order.length && !fits(); k++) {
    const [p, q] = [order[k - 1], order[k]];
    if (labels[p].text !== labels[q].text) continue;
    at[p] = (at[p] + at[q]) / 2;
    order = order.filter((i) => i !== q);
    k--;
  }
  while (order.length > 2 && !fits()) {
    // The city with the least room around it, between the day's first and last.
    let drop = 1;
    for (let k = 2; k < order.length - 1; k++) if (at[order[k + 1]] - at[order[k - 1]] < at[order[drop + 1]] - at[order[drop - 1]]) drop = k;
    order = order.filter((_, k) => k !== drop);
  }
  const centers: (number | null)[] = new Array(labels.length).fill(null);
  let right = -Infinity;
  for (const i of order) {
    const wanted = Math.min(Math.max((at[i] / DAY) * widthPx, half(i) - bleed), widthPx + bleed - half(i));
    centers[i] = Math.max(wanted, right + gapPx + half(i));
    right = centers[i]! + half(i);
  }
  let limit = widthPx + bleed;
  for (const i of [...order].reverse()) {
    centers[i] = Math.min(centers[i]!, limit - half(i));
    limit = centers[i]! - half(i) - gapPx;
  }
  return centers;
}

/**
 * One day's picture from its timeline pieces (`buildHomeDays` / `buildTimelineDays`). `minGap` is how many minutes of
 * the day a label needs to itself at the width it's drawn — a city two legs share is written once, between them, when
 * the two would otherwise sit on each other. With `widthPx`, the times are spaced where they're drawn,
 * nudged in at the day's edges (see `stagger`).
 */
export function dayBars(
  segments: TimelineSegment[],
  minGap: number,
  stayLabeled: (s: TimelineSegment) => boolean = (s) => !s.continuesFromPreviousDay,
  widthPx?: number
): DayBars {
  const half = widthPx ? (text: string) => ((text.length * LABEL_CHAR_PX) / 2 / widthPx) * DAY : undefined;
  const again = segments.filter((s) => s.secondPass);
  const first = picture(segments.filter((s) => !s.secondPass), minGap, stayLabeled, half);
  return again.length > 0 ? { ...first, second: picture(again, minGap, stayLabeled, half) } : first;
}

function picture(segments: TimelineSegment[], minGap: number, stayLabeled: (s: TimelineSegment) => boolean, half?: (text: string) => number): DayBars {
  const ordered = [...segments].sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay || endOf(a) - endOf(b));
  const legs: BarLeg[] = ordered
    .filter((s) => (s.kind === "flying" || s.kind === "deadhead") && s.leg)
    .map((s) => ({
      start: s.startMinuteOfDay,
      end: s.dateLineBack ? s.endMinuteOfDay : endOf(s),
      ...(s.dateLineBack ? { back: s.dateLineBack } : {}),
      ...(s.dateLineJump && s.dateLine ? { jump: { ...s.dateLineJump, minutes: s.dateLine.jumpMinutes } } : {}),
      ...(s.dateLineMark ? { mark: s.dateLineMark } : {}),
      ...(s.dateLine ? { clockJump: s.dateLine.jumpMinutes } : {}),
      // East across the date line the flight is cut at the crossing: no takeoff or landing there, and none on the diagonal.
      from: s.continuesFromPreviousDay || s.dateLineBack || s.dateLineLeg === "after" ? null : s.leg!.dep,
      to: s.continuesToNextDay || s.dateLineBack || s.dateLineLeg === "before" ? null : s.leg!.arr,
      runsIn: s.continuesFromPreviousDay,
      runsOn: s.continuesToNextDay,
      deadhead: s.kind === "deadhead",
      depClock: s.continuesFromPreviousDay || s.dateLineBack || s.dateLineLeg === "after" ? null : (s.startClock ?? s.leg!.depClock),
      arrClock: s.continuesToNextDay || s.dateLineBack || s.dateLineLeg === "before" ? null : (s.endClock ?? s.leg!.arrClock),
      flightNumber: s.leg!.flightNumber,
      seg: s,
      cab: s.leg!.equipment === "CAB",
      dateLine: dateLineCrossing(s.leg!.dep, s.leg!.arr),
    }));

  const cityPoints: { at: number; text: string; deadhead: boolean }[] = [];
  const timePoints: { at: number; text: string }[] = [];
  legs.forEach((l, i) => {
    const prev = legs[i - 1];
    if (l.from) {
      const shared = prev && prev.to === l.from && l.start - prev.end < minGap;
      if (shared) cityPoints[cityPoints.length - 1] = { at: (prev.end + l.start) / 2, text: l.from, deadhead: prev.deadhead && l.deadhead };
      else cityPoints.push({ at: l.start, text: l.from, deadhead: l.deadhead });
    }
    if (l.to) cityPoints.push({ at: l.end, text: l.to, deadhead: l.deadhead });
    if (l.depClock) timePoints.push({ at: l.start, text: l.depClock });
    if (l.arrClock) timePoints.push({ at: l.end, text: l.arrClock });
  });

  return {
    legs,
    duty: dutySpans(ordered),
    standby: ordered.filter((s) => s.kind === "standby").map((s) => ({ start: s.startMinuteOfDay, end: endOf(s), place: s.startAirport ?? s.inlineStart ?? "", seg: s })),
    stays: ordered
      .filter((s) => s.kind === "layover" && s.stay)
      .map((s) => ({
        start: s.startMinuteOfDay,
        end: endOf(s),
        city: s.stay!.city,
        hours: s.stay!.hours,
        hotel: s.stay!.hotel,
        labeled: stayLabeled(s),
        runsIn: s.continuesFromPreviousDay,
        runsOn: s.continuesToNextDay,
        seg: s,
      })),
    rests: ordered
      .filter((s) => s.kind === "connection" && s.stay)
      .map((s) => ({ start: s.startMinuteOfDay, end: endOf(s), city: s.stay!.city, hours: s.stay!.hours, hotel: s.stay!.hotel })),
    // Cities leave room to spare (three letters in a time's room), so only the times need spacing where they land.
    cities: stagger(cityPoints, minGap),
    cityPoints,
    times: stagger(timePoints, minGap, half),
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

/** A layover's length the way the ex-pilot writes it on the calendar: rounded to the hour — "28h", not "27:40". */
export const layoverHours = (hours: number) => `${Math.round(hours)}h`;

/** Width of a character in the 11px mono the labels are set in (Overpass Mono, 0.616em), near enough to decide what fits. */
export const LABEL_CHAR_PX = 6.8;

/**
 * Where a layover's words start on a day `widthPx` across: just after the van (`afterVan`), or further back, as far as
 * the stay's own start, when that keeps their `textPx` clear of the day's right edge. A stay starting late on a phone's
 * narrow day had "L/O SFO 20h" cut to "L/O S".
 */
export function stayLabelLeft(afterVan: number, stayStart: number, textPx: number, widthPx: number): number {
  return Math.max(stayStart, Math.min(afterVan, widthPx - textPx));
}

/**
 * The most a layover's words can say in `roomPx`: "OAK 28h", then "OAK" — `extraPx` for the pilot's mark after it.
 * No "L/O": the green line and the color key already say it's a layover.
 */
export function fitLayoverLabel(city: string, hours: number, roomPx: number, extraPx = 0): { hours: boolean; widthPx: number } {
  const options = [
    { hours: true, text: `${city} ${layoverHours(hours)}` },
    { hours: false, text: city },
  ];
  const width = (text: string) => text.length * LABEL_CHAR_PX + extraPx;
  const fit = options.find((o) => width(o.text) <= roomPx) ?? options[1];
  return { hours: fit.hours, widthPx: width(fit.text) };
}
