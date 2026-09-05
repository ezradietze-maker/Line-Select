import {
  detectDateLineCrossing,
  localDayStart,
  localInstantToZulu,
  toLocalInstant,
  zuluDayLabel,
  type LocalInstant,
} from "@/lib/trip-clock";
import type { Trip, TripDutyPeriod, TripLeg } from "@/types/bidpack";

const MINUTES_PER_DAY = 24 * 60;

export type TimeMode = "zulu" | "local";

export type TimelineSegmentKind = "flying" | "deadhead" | "layover" | "ground" | "connection";

export interface DateLineBadge {
  /** Signed day delta the destination's timezone added (positive) or removed (negative) beyond what the leg's real duration alone would suggest; never zero (see `detectDateLineCrossing`). */
  delta: number;
  explanation: string;
}

export interface TimelineSegment {
  kind: TimelineSegmentKind;
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
  /** True when this segment started on an earlier day — drawn with a flat (not rounded) leading edge, and vice versa for trailing. */
  continuesFromPreviousDay: boolean;
  continuesToNextDay: boolean;
  /** Only ever set on the fragment that actually lands (a flying/deadhead leg's last day-fragment) when local-mode arithmetic found a real date-line effect — see `detectDateLineCrossing`. Always undefined in Zulu mode, since Zulu has no "local" to surprise anyone. */
  dateLineBadge?: DateLineBadge;
}

export interface TimelineDay {
  /** 1-indexed. */
  dayNumber: number;
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
function groundSegment(
  duty: TripDutyPeriod,
  isFirstDuty: boolean,
  previousLayover: TripDutyPeriod["layover"] | null,
  zuluAnchor: string
): RawSegment | null {
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
    segments.push({
      kind: "connection",
      label: "Connection",
      detail: `${prev.arrAirport} ground time · ${formatDuration((next.startMinutes - prev.endMinutes) / 60)}`,
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
export function buildRawSegments(trip: Trip, mode: TimeMode = "local"): RawSegment[] {
  if (trip.schedule.length === 0) return [];

  const raw: RawSegment[] = [];
  trip.schedule.forEach((duty, dutyIndex) => {
    const previousLayover = dutyIndex > 0 ? trip.schedule[dutyIndex - 1].layover : null;
    const ground = groundSegment(duty, dutyIndex === 0, previousLayover, trip.zuluAnchor);
    if (ground) raw.push(ground);
    raw.push(...connectionSegments(duty, trip.zuluAnchor));

    for (const leg of duty.legs) {
      raw.push({
        kind: leg.isDeadhead ? "deadhead" : "flying",
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
      });
    }
    if (duty.layover) {
      const cityLabel = duty.layover.hotelName
        ? `${duty.layover.hotelName}`
        : duty.layover.city;
      const pickedUpBy = duty.layover.transportToHotel ? ` · picked up by ${duty.layover.transportToHotel}` : "";
      raw.push({
        kind: "layover",
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
  });

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
    continuesFromPreviousDay,
    continuesToNextDay,
    dateLineBadge,
  };
}

function buildZuluDays(raw: RawSegment[]): TimelineDay[] {
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
function buildLocalDays(raw: RawSegment[]): TimelineDay[] {
  const base = localDayStart(raw[0].zuluStart, raw[0].startAirport);
  if (!base) return [];

  interface Positioned {
    seg: RawSegment;
    start: LocalInstant;
    end: LocalInstant;
  }
  const positioned: Positioned[] = [];
  for (const seg of raw) {
    const start = toLocalInstant(seg.zuluStart, seg.startAirport, base);
    const end = toLocalInstant(seg.zuluEnd, seg.endAirport, base);
    if (!start || !end) continue;
    positioned.push({ seg, start, end });
  }
  if (positioned.length === 0) return [];

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

      const isLastFragment = end.dayIndex === d && (seg.kind === "flying" || seg.kind === "deadhead");
      const badge = isLastFragment
        ? (detectDateLineCrossing(seg.zuluStart, seg.zuluEnd, seg.startAirport, seg.endAirport) ?? undefined)
        : undefined;

      segments.push(
        toTimelineSegment(seg, clippedStart, clippedEnd, continuesFromPreviousDay, continuesToNextDay, badge)
      );
    }

    const zuluRulerLabel = openingAirport ? buildRulerLabel(d, openingAirport, base) : undefined;
    days.push({ dayNumber: d, segments, zuluRulerLabel });
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
export function buildTimelineDays(trip: Trip, mode: TimeMode = "local"): TimelineDay[] {
  const raw = buildRawSegments(trip, mode);
  if (raw.length === 0) return [];
  return mode === "local" ? buildLocalDays(raw) : buildZuluDays(raw);
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
export function buildLocalDaysWithMode(trip: Trip, mode: TimeMode): TimelineDay[] {
  const raw = buildRawSegments(trip, mode);
  if (raw.length === 0) return [];
  return buildLocalDays(raw);
}
