import type { LayoverSleepPlan, SleepKind } from "@/lib/sleep-plan";
import { dateLinePass, type DateLinePass } from "@/lib/date-line";
import { detectDateLineCrossing, localDayStart, localInstantToZulu, toLocalInstant, ZULU_CLOCK, zoneForClock, zuluDayLabel, type LocalInstant } from "@/lib/trip-clock";
import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { displayHotelName } from "@/lib/hotels/hotel-names";
import { standbyPlace } from "@/lib/standby";
import type { Trip, TripDutyPeriod, TripLeg } from "@/types/bidpack";

const MINUTES_PER_DAY = 24 * 60;

export type TimeMode = "zulu" | "local";

export type TimelineSegmentKind = "flying" | "deadhead" | "standby" | "layover" | "ground" | "connection" | "sleep";

/** A suggested sleep on a layover (see `lib/sleep-plan.ts`) — drawn over the hotel time, never counted as duty. */
export interface SegmentSleep {
  kind: SleepKind;
  title: string;
  why: string;
  /** How easily sleep comes in it, 0–1. */
  ease: number;
}

export interface DateLineBadge {
  /** Signed day delta the destination's timezone added (positive) or removed (negative) beyond what the leg's real duration alone would suggest; never zero (see `detectDateLineCrossing`). */
  delta: number;
  explanation: string;
}

/** The structured facts behind a flight segment, for views that lay them out themselves rather than print `label`/`detail`. Clocks read in the mode the segments were built in. */
export interface SegmentLeg {
  flightNumber: string;
  dep: string;
  arr: string;
  depClock: string;
  arrClock: string;
  /** The other clock system, for a cross-reference. */
  depClockAlt: string;
  arrClockAlt: string;
  blockMinutes: number | null;
  /** As the bid pack prints it — an aircraft code ("76"), "JET" for a ride on another airline, "CAB" for a ground ride. */
  equipment: string;
  deadhead: boolean;
}

/** The structured facts behind a layover segment. */
export interface SegmentStay {
  city: string;
  hotel: string | null;
  hours: number;
  transportTo: string | null;
  transportFrom: string | null;
  /** "HH:MM" pickup for the next duty as the bid pack prints it, in the mode's clock — null when it wasn't printed. */
  pickupClock?: string | null;
}

/**
 * A flight east across the date line on the month calendar, drawn the ex-pilot's way: from its local takeoff back to its
 * local landing, earlier on the same date or on the date before. `part`: all of it on one day, or the takeoff's day
 * (running back to the day's start) and the landing's day (coming in from the day's end). `edgeFraction`: how far
 * along the line the day's edge falls, so the two halves meet.
 */
export interface DateLineBack {
  part: "whole" | "departure" | "arrival";
  edgeFraction: number;
}

export interface TimelineSegment {
  kind: TimelineSegmentKind;
  /** A flight across the date line: which way, when it crosses 180°, and the local clock's jump there (`lib/date-line.ts`). */
  dateLine?: DateLinePass;
  /**
   * Local layout, westbound across the date line: the stretch of this piece (minutes of the day) that's the clock's
   * jump, not flying — drawn as a squiggle between the bold flying on either side, the ex-pilot's way.
   */
  dateLineJump?: { start: number; end: number };
  /** Zulu layout: where on this piece (minute of the day) the flight crosses the date line, and the local clock's jump there. */
  dateLineMark?: { at: number; jumpMinutes: number };
  /** Set on a flight east across the date line, on the month calendar's local layout (`buildDateLineDays`). */
  dateLineBack?: DateLineBack;
  /** After an eastbound date-line flight: a piece of a date the pilot already lived once, on the other side of the line. */
  secondPass?: boolean;
  /** A second-pass piece that runs on into a day lived only once — it rejoins the usual line at the day's end. */
  rejoins?: boolean;
  /** Which of the trip's duty periods it belongs to (`trip.schedule` index) — a layover to the duty it follows. */
  dutyIndex?: number;
  leg?: SegmentLeg;
  stay?: SegmentStay;
  sleep?: SegmentSleep;
  /** Short label for the segment, e.g. "6053 · PEN → CAN" or "White Swan". */
  label: string;
  /** One line of specifics, e.g. "21:15 → 01:19 local · 4h04m block" or "Guangzhou · 25h36m at hotel". */
  detail: string;
  /** What to print directly on the bar itself at its leading edge, e.g. "13:00 SFO" — empty when this kind of segment (ground/connection) has no city+time pair worth printing inline. */
  inlineStart: string;
  /** The trailing-edge counterpart, e.g. "TPE 17:00". Empty for a layover/single-point label, which prints centered via `inlineStart` alone. */
  inlineEnd: string;
  /** 0-1440, already clipped to this day's row. */
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  /** "HH:MM" this piece starts and ends on its own airport's clock (local) or Zulu, per the mode — what every time printed about it reads, wherever the day view places it. */
  startClock?: string;
  endClock?: string;
  /** The date ("YYYY-MM-DD") each of those clock times falls on, on the same clock. */
  startDate?: string;
  endDate?: string;
  /** Where the piece starts and ends (the same airport for anything but a flight). */
  startAirport?: string;
  endAirport?: string;
  /** True when this segment started on an earlier day — drawn with a flat (not rounded) leading edge, and vice versa for trailing. */
  continuesFromPreviousDay: boolean;
  continuesToNextDay: boolean;
  /** Only ever set on the fragment that actually lands (a flying/deadhead leg's last day-fragment) when local-mode arithmetic found a real date-line effect — see `detectDateLineCrossing`. Always undefined in Zulu mode, since Zulu has no "local" to surprise anyone. */
  dateLineBadge?: DateLineBadge;
}

export interface TimelineDay {
  /** 1-indexed. */
  dayNumber: number;
  /** Suggested sleep on this day (see `buildTimelineDays`) — never part of `segments`, so nothing counts it as duty. */
  sleep?: TimelineSegment[];
  /**
   * The real calendar date ("YYYY-MM-DD") this column is, where its pieces happen (local mode, a trip with a real
   * date). Not always the day after the column before: flying east across the date line, a pilot lives the same date
   * twice — Thursday in Seoul, then Thursday again in Anchorage — and the columns say so.
   */
  date?: string;
  segments: TimelineSegment[];
  /**
   * The always-visible Zulu cross-reference for this local day column —
   * what this column's own [00:00, 24:00) local boundaries read as in
   * Zulu, using the zone of whichever segment opens the day. Undefined in
   * Zulu mode (redundant — the column already *is* Zulu) and when the day
   * has no segments to anchor a zone to.
   */
  zuluRulerLabel?: string;
}

function formatHHMM(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export interface RawSegment {
  kind: TimelineSegmentKind;
  /** A flight across the date line: which way, when it crosses 180°, and the local clock's jump there (`lib/date-line.ts`). */
  dateLine?: DateLinePass;
  /** Which of the trip's duty periods it belongs to (`trip.schedule` index) — a layover to the duty it follows. */
  dutyIndex?: number;
  leg?: SegmentLeg;
  stay?: SegmentStay;
  sleep?: SegmentSleep;
  label: string;
  detail: string;
  inlineStart: string;
  inlineEnd: string;
  startMinutes: number;
  endMinutes: number;
  /** Real Zulu instants for this segment's start/end — the actual data a Local-mode conversion works from, as opposed to `startMinutes`/`endMinutes`, which are only Zulu-consistent, not a materialized timestamp. */
  zuluStart: string;
  zuluEnd: string;
  /** Which airport's zone governs this segment's start/end respectively — the same airport for ground/connection/layover segments (single location throughout), but different for a flying/deadhead leg, which starts in one zone and ends in another. */
  startAirport: string;
  endAirport: string;
  /** See `TimelineSegment.startClock`. */
  startClock?: string;
  endClock?: string;
  startDate?: string;
  endDate?: string;
}

/** The date of a real instant on an airport's own clock (local mode) or Zulu. */
function dateOf(zuluISO: string, airport: string, mode: TimeMode): string {
  const zone = mode === "zulu" ? "utc" : (timezoneForAirport(airport) ?? "utc");
  return DateTime.fromISO(zuluISO, { zone: "utc" }).setZone(zone).toISODate()!;
}

/** "HH:MM" of a real instant on an airport's own clock (local mode) or Zulu. */
function clockOf(zuluISO: string, airport: string, mode: TimeMode): string {
  const zone = mode === "zulu" ? "utc" : (timezoneForAirport(airport) ?? "utc");
  return DateTime.fromISO(zuluISO, { zone: "utc" }).setZone(zone).toFormat("HH:mm");
}

function legLabel(leg: TripLeg): string {
  const prefix = leg.isDeadhead ? "DH " : "";
  return `${prefix}${leg.flightNumber} · ${leg.depAirport} → ${leg.arrAirport}`;
}

/**
 * The leg's own printed local time in the selected mode's primary slot, the
 * other system in a smaller secondary one right next to it — the toggle's
 * whole point is translating between the two, not hiding one. Both clocks
 * come straight from the bid pack's own printed HHMM pair (`depTimeLocal`/
 * `depTimeGmt`), never from `depTimeZulu` — that field is anchored to an
 * arbitrary reference instant for internally-consistent day-math (see
 * `Trip.zuluAnchor`'s own doc comment), so while it's exactly right for
 * relative calendar arithmetic, its own clock reading has no reason to
 * match the pack's real printed GMT time, and displaying it directly would
 * show a fabricated hour to a pilot. Ground/connection/layover segments
 * never printed an absolute clock time to begin with (only durations), so
 * there's nothing to dual-annotate there — this only applies to an actual
 * flying/deadhead leg.
 */
function legDetail(leg: TripLeg, mode: TimeMode): string {
  const localTimes = `${formatHHMM(leg.depTimeLocal)} → ${formatHHMM(leg.arrTimeLocal)} local`;
  const zuluTimes = `${formatHHMM(leg.depTimeGmt)} → ${formatHHMM(leg.arrTimeGmt)} Z`;
  const times = mode === "zulu" ? `${zuluTimes} (${localTimes})` : `${localTimes} (${zuluTimes})`;
  return leg.blockHours !== null ? `${times} · ${formatDuration(leg.blockHours)} block` : times;
}

/** Which clock reads on the bar's inline label itself — primary mode only, no secondary (there's no room on the bar; the pairing lives in `legDetail`'s tooltip text instead). Always the bid pack's own printed HHMM, same reasoning as `legDetail`. */
function legInlineClock(leg: TripLeg, endpoint: "dep" | "arr", mode: TimeMode): string {
  if (mode === "zulu") return formatHHMM(endpoint === "dep" ? leg.depTimeGmt : leg.arrTimeGmt);
  return formatHHMM(endpoint === "dep" ? leg.depTimeLocal : leg.arrTimeLocal);
}

/**
 * The gap before a duty period's first flight isn't printed as its own
 * duration, but its two endpoints are both real: `duty.startMinutes` is
 * either the pairing's printed report time (the trip's first duty) or the
 * instant the previous layover's printed duration ends — which, checked
 * against the bid pack's own "Trans From: ... pickup @" lines, lands on the
 * hotel pickup time, not some later report time. So this whole span is
 * report/check-in for duty one, or hotel-to-airport transport plus
 * check-in for every duty after a layover — real time, just not split
 * further since no separate drop-off time is printed.
 */
function groundSegment(duty: TripDutyPeriod, isFirstDuty: boolean, previousLayover: TripDutyPeriod["layover"] | null, zuluAnchor: string): RawSegment | null {
  const firstLeg = duty.legs[0];
  if (!firstLeg || firstLeg.startMinutes <= duty.startMinutes) return null;
  const durationLabel = formatDuration((firstLeg.startMinutes - duty.startMinutes) / 60);
  const via = previousLayover?.transportFromHotel ? ` via ${previousLayover.transportFromHotel}` : "";
  return {
    kind: "ground",
    label: isFirstDuty ? "Report" : "Ground transport",
    detail: isFirstDuty
      ? `Report ${formatHHMM(duty.reportTimeLocal)} → block-off ${formatHHMM(firstLeg.depTimeLocal)} · ${durationLabel}`
      : `Hotel pickup → block-off ${formatHHMM(firstLeg.depTimeLocal)} · ${durationLabel}${via}`,
    inlineStart: "",
    inlineEnd: "",
    startMinutes: duty.startMinutes,
    endMinutes: firstLeg.startMinutes,
    zuluStart: minutesToZulu(zuluAnchor, duty.startMinutes),
    zuluEnd: minutesToZulu(zuluAnchor, firstLeg.startMinutes),
    startAirport: firstLeg.depAirport,
    endAirport: firstLeg.depAirport,
  };
}

/** Ground time between two flights in the same duty period — too short to be a layover, just deplane/walk/board for the next leg. */
function connectionSegments(duty: TripDutyPeriod, zuluAnchor: string): RawSegment[] {
  const segments: RawSegment[] = [];
  for (let i = 0; i < duty.legs.length - 1; i++) {
    const prev = duty.legs[i];
    const next = duty.legs[i + 1];
    if (next.startMinutes <= prev.endMinutes) continue;
    const hours = (next.startMinutes - prev.endMinutes) / 60;
    segments.push({
      kind: "connection",
      // A stop long enough that the pairing books a hotel for it — a day room, not a layover.
      ...(prev.dayRoomHotel ? { stay: { city: prev.arrAirport, hotel: prev.dayRoomHotel, hours, transportTo: null, transportFrom: null } } : {}),
      label: prev.dayRoomHotel ? `Day room · ${prev.dayRoomHotel}` : "Connection",
      detail: prev.dayRoomHotel
        ? `${prev.arrAirport} · ${formatDuration(hours)} on the ground, with a hotel room between legs of the same duty`
        : `${prev.arrAirport} ground time · ${formatDuration(hours)}`,
      inlineStart: "",
      inlineEnd: "",
      startMinutes: prev.endMinutes,
      endMinutes: next.startMinutes,
      zuluStart: minutesToZulu(zuluAnchor, prev.endMinutes),
      zuluEnd: minutesToZulu(zuluAnchor, next.startMinutes),
      startAirport: prev.arrAirport,
      endAirport: prev.arrAirport,
    });
  }
  return segments;
}

function minutesToZulu(anchorISO: string, minutes: number): string {
  return new Date(new Date(anchorISO).getTime() + minutes * 60_000).toISOString();
}

/**
 * Flattens a trip's duty periods into one flat list of absolute-minute
 * segments (elapsed minutes since the trip's own first report, t=0) — the
 * same real data `buildTimelineDays` slices into day-rows for the full
 * chart, exposed here undivided for anything that wants the trip's whole
 * shape as one continuous span (e.g. a compact single-bar preview).
 */
export function buildRawSegments(trip: Trip, mode: TimeMode = "local", sleepPlans: LayoverSleepPlan[] = []): RawSegment[] {
  if (trip.schedule.length === 0) return [];

  const raw: RawSegment[] = [];
  trip.schedule.forEach((duty, dutyIndex) => {
    const from = raw.length;
    const previousLayover = dutyIndex > 0 ? trip.schedule[dutyIndex - 1].layover : null;
    const ground = groundSegment(duty, dutyIndex === 0, previousLayover, trip.zuluAnchor);
    if (ground) raw.push(ground);
    raw.push(...connectionSegments(duty, trip.zuluAnchor));

    for (const leg of duty.legs) {
      if (leg.isStandby) {
        // On call at the hotel, not a flight: no flight number, no route, no block time — just where and when.
        const place = standbyPlace(leg.flightNumber);
        raw.push({
          kind: "standby",
          label: `${place === "airport" ? "Airport" : "Hotel"} standby · ${leg.depAirport}`,
          detail: `${leg.depAirport} · on call at the ${place} ${legInlineClock(leg, "dep", mode)} → ${legInlineClock(leg, "arr", mode)} · paid, not flying`,
          inlineStart: `Standby ${leg.depAirport}`,
          inlineEnd: "",
          startMinutes: leg.startMinutes,
          endMinutes: leg.endMinutes,
          zuluStart: leg.depTimeZulu,
          zuluEnd: leg.arrTimeZulu,
          startAirport: leg.depAirport,
          endAirport: leg.arrAirport,
        });
        continue;
      }
      raw.push({
        kind: leg.isDeadhead ? "deadhead" : "flying",
        leg: {
          flightNumber: leg.flightNumber,
          dep: leg.depAirport,
          arr: leg.arrAirport,
          depClock: legInlineClock(leg, "dep", mode),
          arrClock: legInlineClock(leg, "arr", mode),
          depClockAlt: legInlineClock(leg, "dep", mode === "zulu" ? "local" : "zulu"),
          arrClockAlt: legInlineClock(leg, "arr", mode === "zulu" ? "local" : "zulu"),
          blockMinutes: leg.blockHours !== null ? Math.round(leg.blockHours * 60) : null,
          equipment: leg.equipment,
          deadhead: leg.isDeadhead,
        },
        label: legLabel(leg),
        detail: legDetail(leg, mode),
        inlineStart: `${legInlineClock(leg, "dep", mode)} ${leg.depAirport}`,
        inlineEnd: `${leg.arrAirport} ${legInlineClock(leg, "arr", mode)}`,
        startMinutes: leg.startMinutes,
        endMinutes: leg.endMinutes,
        zuluStart: leg.depTimeZulu,
        zuluEnd: leg.arrTimeZulu,
        startAirport: leg.depAirport,
        endAirport: leg.arrAirport,
        ...(() => {
          const pass = dateLinePass(leg.depAirport, leg.arrAirport, leg.depTimeZulu, leg.arrTimeZulu);
          return pass ? { dateLine: pass } : {};
        })(),
      });
    }
    if (duty.layover) {
      const cityLabel = duty.layover.hotelName ? displayHotelName(duty.layover.hotelName) : duty.layover.city;
      const pickedUpBy = !duty.layover.transportToHotel
        ? ""
        : duty.layover.hotelName && duty.layover.transportToHotel.toUpperCase() === duty.layover.hotelName.toUpperCase()
          ? " · hotel shuttle"
          : ` · picked up by ${duty.layover.transportToHotel}`;
      raw.push({
        kind: "layover",
        stay: {
          city: duty.layover.city,
          hotel: duty.layover.hotelName,
          hours: duty.layover.hours,
          transportTo: duty.layover.transportToHotel,
          transportFrom: duty.layover.transportFromHotel,
          pickupClock: (() => {
            const printed = mode === "zulu" ? duty.layover.pickupTimeGmt : duty.layover.pickupTimeLocal;
            return printed ? formatHHMM(printed) : null;
          })(),
        },
        label: cityLabel,
        detail: `${duty.layover.city} · ${formatDuration(duty.layover.hours)} at hotel${pickedUpBy}`,
        inlineStart: `${duty.layover.city} · ${formatDuration(duty.layover.hours)}`,
        inlineEnd: "",
        startMinutes: duty.layover.startMinutes,
        endMinutes: duty.layover.endMinutes,
        zuluStart: minutesToZulu(trip.zuluAnchor, duty.layover.startMinutes),
        zuluEnd: minutesToZulu(trip.zuluAnchor, duty.layover.endMinutes),
        startAirport: duty.layover.city,
        endAirport: duty.layover.city,
      });
    }
    for (const seg of raw.slice(from)) seg.dutyIndex = dutyIndex;
  });

  // Suggested sleep, in the layover's own city — placed and clocked exactly like the hotel time it sits in.
  for (const plan of sleepPlans)
    for (const b of plan.blocks)
      raw.push({
        kind: "sleep",
        sleep: { kind: b.kind, title: b.title, why: b.why, ease: b.ease },
        label: b.title,
        detail: b.why,
        inlineStart: "",
        inlineEnd: "",
        startMinutes: b.start,
        endMinutes: b.end,
        zuluStart: minutesToZulu(trip.zuluAnchor, b.start),
        zuluEnd: minutesToZulu(trip.zuluAnchor, b.end),
        startAirport: plan.city,
        endAirport: plan.city,
      });

  // Every piece's own clock times. A flight's are the pack's printed ones; the rest are read off the real instants.
  for (const seg of raw) {
    seg.startClock = seg.leg ? seg.leg.depClock : clockOf(seg.zuluStart, seg.startAirport, mode);
    seg.endClock = seg.leg ? seg.leg.arrClock : clockOf(seg.zuluEnd, seg.endAirport, mode);
    seg.startDate = dateOf(seg.zuluStart, seg.startAirport, mode);
    seg.endDate = dateOf(seg.zuluEnd, seg.endAirport, mode);
  }
  return raw;
}

function toTimelineSegment(
  seg: RawSegment,
  clippedStart: number,
  clippedEnd: number,
  continuesFromPreviousDay: boolean,
  continuesToNextDay: boolean,
  dateLineBadge?: DateLineBadge
): TimelineSegment {
  return {
    kind: seg.kind,
    ...(seg.dutyIndex !== undefined ? { dutyIndex: seg.dutyIndex } : {}),
    ...(seg.dateLine ? { dateLine: seg.dateLine } : {}),
    ...(seg.leg ? { leg: seg.leg } : {}),
    ...(seg.stay ? { stay: seg.stay } : {}),
    ...(seg.sleep ? { sleep: seg.sleep } : {}),
    label: seg.label,
    detail: seg.detail,
    // A fragment split across midnight only shows the real edge label that
    // actually falls on this calendar day — the clipped edge at midnight
    // isn't a real departure/arrival, so it prints nothing rather than a
    // misleading repeat of the other day's time.
    inlineStart: continuesFromPreviousDay ? "" : seg.inlineStart,
    inlineEnd: continuesToNextDay ? "" : seg.inlineEnd,
    startMinuteOfDay: clippedStart,
    endMinuteOfDay: clippedEnd,
    startClock: seg.startClock,
    endClock: seg.endClock,
    startDate: seg.startDate,
    endDate: seg.endDate,
    startAirport: seg.startAirport,
    endAirport: seg.endAirport,
    continuesFromPreviousDay,
    continuesToNextDay,
    dateLineBadge,
  };
}

/**
 * Where the trip's t=0 (its first report) falls on the real Zulu clock, in
 * minutes after midnight Z. Segment minutes are elapsed time since that
 * report, and every leg carries its bid-pack-printed GMT departure, so one
 * leg pins the whole trip to the real clock — without it, Zulu columns would
 * be "hours since report" drawn against a 00-24 clock scale.
 */
function zuluClockOffset(trip: Trip): number {
  for (const duty of trip.schedule) {
    for (const leg of duty.legs) {
      const m = /^(\d{2})(\d{2})$/.exec(leg.depTimeGmt);
      if (!m) continue;
      const clock = Number(m[1]) * 60 + Number(m[2]);
      return (((clock - leg.startMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    }
  }
  return 0;
}

function buildZuluDays(rawUnshifted: RawSegment[], clockOffset: number): TimelineDay[] {
  const raw = rawUnshifted.map((s) => ({ ...s, startMinutes: s.startMinutes + clockOffset, endMinutes: s.endMinutes + clockOffset }));
  const lastEnd = Math.max(...raw.map((s) => s.endMinutes));
  const totalDays = Math.max(1, Math.ceil(lastEnd / MINUTES_PER_DAY));

  const days: TimelineDay[] = [];
  for (let d = 0; d < totalDays; d++) {
    const dayStart = d * MINUTES_PER_DAY;
    const dayEnd = dayStart + MINUTES_PER_DAY;
    const segments: TimelineSegment[] = [];

    for (const seg of raw) {
      if (seg.endMinutes <= dayStart || seg.startMinutes >= dayEnd) continue;
      segments.push(
        toTimelineSegment(
          seg,
          Math.max(seg.startMinutes, dayStart) - dayStart,
          Math.min(seg.endMinutes, dayEnd) - dayStart,
          seg.startMinutes < dayStart,
          seg.endMinutes > dayEnd
        )
      );
    }

    days.push({ dayNumber: d + 1, segments });
  }

  return days;
}

/**
 * The Local-mode counterpart to `buildZuluDays` — day columns keyed by real
 * local calendar date instead of elapsed-Zulu-day count. A ground/
 * connection/layover segment occurs at one airport throughout, so its local
 * day-index span is unambiguous; a flying/deadhead leg starts in the
 * departure zone and ends in the arrival zone, which is exactly the case
 * `detectDateLineCrossing` flags when the destination's timezone moves the
 * local calendar further than the leg's own real duration would. A segment
 * whose airport isn't in the timezone lookup table is dropped rather than
 * guessed at or rendered in the wrong place.
 */
function buildLocalDays(raw: RawSegment[], home?: string): TimelineDay[] {
  // Day 1 is normally the trip's very first segment's own local day — but an
  // unlisted airport (a new base, a new country the timezone table hasn't
  // caught up to yet) showing up first shouldn't blank the whole trip when
  // every other segment's airport is perfectly resolvable. Fall through to
  // the first segment that *does* resolve, so one unknown airport costs only
  // itself, not the entire calendar.
  let base: ReturnType<typeof localDayStart> = null;
  for (const seg of raw) {
    base = localDayStart(seg.zuluStart, home ?? seg.startAirport);
    if (base) break;
  }
  if (!base) return [];
  // On the home calendar, every piece is read on the base's clock: one zone, so days only ever run forward.
  const startAt = (seg: RawSegment) => home ?? seg.startAirport;
  const endAt = (seg: RawSegment) => home ?? seg.endAirport;

  interface Positioned {
    seg: RawSegment;
    start: LocalInstant;
    end: LocalInstant;
    /** Days added to its own local date to keep the trip's days running forward (see below). */
    shift: number;
  }
  const positioned: Positioned[] = [];
  // In time order, and never back a day: a flight east across the date line lands on an earlier local date than it
  // left (Seoul 08:40 Oct 9 → Anchorage 23:41 Oct 8), and the trip's own days can't run backwards — so from there on,
  // pieces stay on the day the trip has reached, at their own local clock times, and the landing carries its "−1 day"
  // note. Without this the flight belonged to no day at all and simply wasn't drawn.
  let shift = 0;
  let reached = 1;
  const sleep = raw.filter((x) => x.kind === "sleep");
  for (const seg of [...raw].filter((x) => x.kind !== "sleep").sort((a, b) => Date.parse(a.zuluStart) - Date.parse(b.zuluStart) || Date.parse(a.zuluEnd) - Date.parse(b.zuluEnd))) {
    const s0 = toLocalInstant(seg.zuluStart, startAt(seg), base);
    const e0 = toLocalInstant(seg.zuluEnd, endAt(seg), base);
    if (!s0 || !e0) continue;
    if (s0.dayIndex + shift < reached) shift = reached - s0.dayIndex;
    const start = { ...s0, dayIndex: s0.dayIndex + shift };
    let end = { ...e0, dayIndex: e0.dayIndex + shift };
    if (end.dayIndex < start.dayIndex || (end.dayIndex === start.dayIndex && end.minuteOfDay < start.minuteOfDay)) {
      // The landing's clock reads earlier than the takeoff's on the same day: it runs on into the next one.
      const bump = start.dayIndex - end.dayIndex + (end.minuteOfDay < start.minuteOfDay ? 1 : 0);
      end = { ...end, dayIndex: end.dayIndex + bump };
      shift += bump;
    }
    reached = Math.max(reached, end.dayIndex);
    positioned.push({ seg, start, end, shift });
  }
  if (positioned.length === 0) return [];
  // Suggested sleep sits inside a hotel stay, so it can't take part in the walk above (it would read as time running
  // backwards and push the rest of the trip a day on): it goes on the days its stay is on, by the same shift.
  for (const seg of sleep) {
    const at = Date.parse(seg.zuluStart);
    const host = positioned.find((p) => p.seg.kind === "layover" && Date.parse(p.seg.zuluStart) <= at && at < Date.parse(p.seg.zuluEnd));
    const s0 = toLocalInstant(seg.zuluStart, startAt(seg), base);
    const e0 = toLocalInstant(seg.zuluEnd, endAt(seg), base);
    if (!host || !s0 || !e0) continue;
    positioned.push({ seg, start: { ...s0, dayIndex: s0.dayIndex + host.shift }, end: { ...e0, dayIndex: e0.dayIndex + host.shift }, shift: host.shift });
  }

  const totalDays = Math.max(1, ...positioned.map((p) => p.end.dayIndex));
  const days: TimelineDay[] = [];

  for (let d = 1; d <= totalDays; d++) {
    const segments: TimelineSegment[] = [];
    let openingAirport: string | null = null;

    for (const { seg, start, end } of positioned) {
      if (end.dayIndex < d || start.dayIndex > d) continue;

      const clippedStart = start.dayIndex === d ? start.minuteOfDay : 0;
      const clippedEnd = end.dayIndex === d ? end.minuteOfDay : MINUTES_PER_DAY;
      const continuesFromPreviousDay = start.dayIndex < d;
      const continuesToNextDay = end.dayIndex > d;
      // Whichever segment opens this local day first (chronologically —
      // `positioned` is already in that order) sets the zone the ruler
      // reads this whole column in — an approximation exactly like the
      // fragment split above (mid-flight has no single "current zone"
      // either), but a stable, deterministic one.
      if (!openingAirport) openingAirport = seg.startAirport;

      const isLastFragment = !home && end.dayIndex === d && (seg.kind === "flying" || seg.kind === "deadhead");
      const badge = isLastFragment ? (detectDateLineCrossing(seg.zuluStart, seg.zuluEnd, seg.startAirport, seg.endAirport) ?? undefined) : undefined;

      segments.push(toTimelineSegment(seg, clippedStart, clippedEnd, continuesFromPreviousDay, continuesToNextDay, badge));
    }

    const zuluRulerLabel = openingAirport && !home ? buildRulerLabel(d, openingAirport, base) : undefined;
    // The column's real date: where its first piece is, that piece's own local date on this column.
    const opener = positioned.find(({ start, end }) => start.dayIndex <= d && end.dayIndex >= d);
    let date: string | undefined;
    if (opener) {
      const zone = zoneForClock(startAt(opener.seg));
      const localStart = zone ? DateTime.fromISO(opener.seg.zuluStart, { zone: "utc" }).setZone(zone) : null;
      date = localStart?.plus({ days: d - opener.start.dayIndex }).toISODate() ?? undefined;
    }
    days.push({ dayNumber: d, segments, zuluRulerLabel, ...(date ? { date } : {}) });
  }

  return days;
}

/** "Z 14:00 → +1d 02:00" style label for one local day column's own [00:00, 24:00) boundaries, read in Zulu — the always-visible cross-reference the mini calendar keeps up in Local mode. */
function buildRulerLabel(dayIndex: number, airportCode: string, base: NonNullable<ReturnType<typeof localDayStart>>): string | undefined {
  const startZulu = localInstantToZulu(dayIndex, 0, airportCode, base);
  const endZulu = localInstantToZulu(dayIndex, MINUTES_PER_DAY, airportCode, base);
  if (!startZulu || !endZulu) return undefined;
  // Both labeled relative to the column's own start — so `end` reads "+1d"
  // when the Zulu day rolled over somewhere inside this one local day.
  const start = zuluDayLabel(startZulu, startZulu);
  const end = zuluDayLabel(endZulu, startZulu);
  return `Z ${start.clock} → ${end.dayIndex > 1 ? "+1d " : ""}${end.clock}`;
}

/**
 * Slices a trip's flattened segments across day boundaries into per-day
 * rows for the mini calendar, in whichever time system `mode` selects — a
 * segment spanning midnight (Zulu mode) or a local calendar date (Local
 * mode) becomes two fragments, one on each day, marked so the UI can draw
 * them as one continuous bar rather than two separate ones.
 */
/** The trip's day columns; with `sleepPlans`, each day also carries its suggested sleep (`TimelineDay.sleep`), kept apart from the duty. */
export function buildTimelineDays(trip: Trip, mode: TimeMode = "local", sleepPlans: LayoverSleepPlan[] = []): TimelineDay[] {
  const raw = buildRawSegments(trip, mode, sleepPlans);
  if (raw.length === 0) return [];
  const days = mode === "local" ? buildLocalDays(raw) : buildZuluDays(raw, zuluClockOffset(trip));
  return days.map((d) => ({ ...d, segments: d.segments.filter((x) => x.kind !== "sleep"), sleep: d.segments.filter((x) => x.kind === "sleep") }));
}

/**
 * Local-anchored day columns (see `buildLocalDays`) whose segment labels and
 * inline clocks still switch with `mode` — used by the mini month calendar,
 * which keeps its day-column structure (which real calendar day each column
 * is) stable across the Local/Zulu toggle, so a whole month's shape doesn't
 * reflow every time the toggle is pressed, while every segment's own times
 * still read in whichever clock is primary, the same as the full per-trip
 * chart's own labels do. A side effect worth calling out: `buildLocalDays`
 * always runs its date-line-crossing check regardless of which mode built
 * the segment labels, so the mini calendar's day-boundary badges show up
 * the same in either toggle state — a deliberate choice for this
 * always-local-anchored view, not the toggle-dependent badge behavior the
 * full per-trip chart has in its own Local mode.
 */
/**
 * Day columns on the base's own calendar — the one the bid pack's line grid
 * and its days off are counted on. Every piece sits on the base's date and
 * clock (so a Seoul layover's morning is part of the Anchorage day it falls
 * in, and a trip's days match the grid's), while every time printed about a
 * piece is still its own airport's local time (or Zulu, per `mode`). The
 * month calendar is laid out this way; the trip's own chart, which shows each
 * place's local day as the pilot lives it, uses `buildTimelineDays`.
 */
export function buildHomeDays(trip: Trip, mode: TimeMode): TimelineDay[] {
  const raw = buildRawSegments(trip, mode);
  const home = trip.schedule[0]?.legs[0]?.depAirport;
  if (raw.length === 0 || !home) return [];
  return buildLocalDays(raw, home);
}

/**
 * The month calendar's Zulu days: the same as `buildHomeDays`, but every piece placed on the Zulu clock and its Zulu
 * date, midnight Z to midnight Z, its times printed in Zulu. Each day's `date` is its Zulu date.
 */
export function buildZuluCalendarDays(trip: Trip): TimelineDay[] {
  const raw = buildRawSegments(trip, "zulu");
  if (raw.length === 0) return [];
  const days = buildLocalDays(raw, ZULU_CLOCK);
  // On Zulu's clock the date line moves nothing: mark where each flight across it crosses, with the local clock's jump.
  for (const day of days) {
    for (const seg of day.segments) {
      if (!seg.dateLine || !day.date) continue;
      const at = DateTime.fromISO(seg.dateLine.crossesAt, { zone: "utc" });
      if (at.toISODate() !== day.date) continue;
      const minute = at.hour * 60 + at.minute;
      if (minute >= seg.startMinuteOfDay && minute <= seg.endMinuteOfDay) seg.dateLineMark = { at: minute, jumpMinutes: seg.dateLine.jumpMinutes };
    }
  }
  return days;
}

/**
 * A trip across the date line on the month calendar, laid out the way the ex-pilot draws one: every piece on its own
 * airport's local date and clock, from the trip's first day at home. Westbound the flight is its real length in bold
 * and the clock's jump a squiggle (`dateLineJump`), the two together reaching its local landing. Eastbound the
 * flight lands on the same date it left, or the one before — so it's drawn running back to its landing
 * (`dateLineBack`), and what follows on a date already lived on the far side of the line is a second pass of it
 * (`secondPass`): the layover carries on from the landing, on a line of its own, until the date is new again.
 */
export function buildDateLineDays(trip: Trip): TimelineDay[] {
  const raw = buildRawSegments(trip, "local").filter((s) => s.kind !== "sleep");
  const home = trip.schedule[0]?.legs[0]?.depAirport;
  if (raw.length === 0 || !home) return [];
  const base = localDayStart(raw[0].zuluStart, home);
  if (!base) return [];
  const abs = (p: LocalInstant) => (p.dayIndex - 1) * MINUTES_PER_DAY + p.minuteOfDay;

  interface Placed {
    seg: RawSegment;
    start: LocalInstant;
    end: LocalInstant;
    back: boolean;
    /** The latest moment lived before the last eastbound crossing — anything after that crossing earlier than this is a second pass. */
    lived: number | null;
  }
  const placed: Placed[] = [];
  let reached = -Infinity;
  let lived: number | null = null;
  for (const seg of [...raw].sort((a, b) => Date.parse(a.zuluStart) - Date.parse(b.zuluStart) || Date.parse(a.zuluEnd) - Date.parse(b.zuluEnd))) {
    const start = toLocalInstant(seg.zuluStart, seg.startAirport, base);
    const end = toLocalInstant(seg.zuluEnd, seg.endAirport, base);
    if (!start || !end) continue;
    const flight = seg.kind === "flying" || seg.kind === "deadhead";
    const back = flight && abs(end) < abs(start);
    if (back) lived = Math.max(reached, abs(start));
    reached = Math.max(reached, abs(end), abs(start));
    placed.push({ seg, start, end, back, lived: back ? null : lived });
  }
  if (placed.length === 0) return [];

  const totalDays = Math.max(1, ...placed.map((p) => Math.max(p.start.dayIndex, p.end.dayIndex)));
  const days: TimelineDay[] = [];
  for (let d = 1; d <= totalDays; d++) {
    const segments: TimelineSegment[] = [];
    for (const { seg, start, end, back, lived: before } of placed) {
      if (back) {
        // From the takeoff back to the landing: the whole of it on one day, or split at the day's edge.
        const total = abs(start) - abs(end);
        const edgeFraction = total > 0 ? start.minuteOfDay / total : 0;
        if (start.dayIndex === d && end.dayIndex === d) segments.push({ ...toTimelineSegment(seg, start.minuteOfDay, end.minuteOfDay, false, false), dateLineBack: { part: "whole", edgeFraction: 1 } });
        else if (start.dayIndex === d) segments.push({ ...toTimelineSegment(seg, start.minuteOfDay, 0, false, true), dateLineBack: { part: "departure", edgeFraction } });
        else if (end.dayIndex === d) segments.push({ ...toTimelineSegment(seg, MINUTES_PER_DAY, end.minuteOfDay, true, false), dateLineBack: { part: "arrival", edgeFraction } });
        continue;
      }
      if (end.dayIndex < d || start.dayIndex > d) continue;
      const clippedStart = start.dayIndex === d ? start.minuteOfDay : 0;
      const clippedEnd = end.dayIndex === d ? end.minuteOfDay : MINUTES_PER_DAY;
      if (clippedEnd <= clippedStart && !(start.dayIndex === d && end.dayIndex === d && clippedEnd === clippedStart)) continue;
      const piece: TimelineSegment = toTimelineSegment(seg, clippedStart, clippedEnd, start.dayIndex < d, end.dayIndex > d);
      // West across the date line: the flight's own length in bold up to where it crosses, then the clock's jump as a
      // squiggle, then the rest of the flight — together exactly takeoff to landing on the local clocks.
      if (seg.dateLine?.direction === "west" && seg.dateLine.jumpMinutes > 0) {
        const jumpFrom = abs(start) + (Date.parse(seg.dateLine.crossesAt) - Date.parse(seg.zuluStart)) / 60_000 - (d - 1) * MINUTES_PER_DAY;
        const jumpTo = jumpFrom + seg.dateLine.jumpMinutes;
        const a = Math.max(clippedStart, jumpFrom);
        const b = Math.min(clippedEnd, jumpTo);
        if (b > a) piece.dateLineJump = { start: a, end: b };
      }
      const from = (d - 1) * MINUTES_PER_DAY + clippedStart;
      const second = before !== null && from < before;
      segments.push(second ? { ...piece, secondPass: true, rejoins: end.dayIndex > d && d * MINUTES_PER_DAY >= before } : piece);
    }
    days.push({ dayNumber: d, segments, date: base.plus({ days: d - 1 }).toISODate() ?? undefined });
  }
  return days;
}

export function buildLocalDaysWithMode(trip: Trip, mode: TimeMode): TimelineDay[] {
  const raw = buildRawSegments(trip, mode);
  if (raw.length === 0) return [];
  return buildLocalDays(raw);
}
