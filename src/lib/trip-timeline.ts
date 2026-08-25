import type { Trip, TripDutyPeriod, TripLeg } from "@/types/bidpack";

const MINUTES_PER_DAY = 24 * 60;

export type TimelineSegmentKind = "flying" | "deadhead" | "layover" | "ground" | "connection";

export interface TimelineSegment {
  kind: TimelineSegmentKind;
  /** Short label for the segment, e.g. "6053 · PEN → CAN" or "White Swan". */
  label: string;
  /** One line of specifics, e.g. "21:15 → 01:19 local · 4h04m block" or "Guangzhou · 25h36m at hotel". */
  detail: string;
  /** 0-1440, already clipped to this day's row. */
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  /** True when this segment started on an earlier day — drawn with a flat (not rounded) leading edge, and vice versa for trailing. */
  continuesFromPreviousDay: boolean;
  continuesToNextDay: boolean;
}

export interface TimelineDay {
  /** 1-indexed. */
  dayNumber: number;
  segments: TimelineSegment[];
}

function formatHHMM(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

interface RawSegment {
  kind: TimelineSegmentKind;
  label: string;
  detail: string;
  startMinutes: number;
  endMinutes: number;
}

function legLabel(leg: TripLeg): string {
  const prefix = leg.isDeadhead ? "DH " : "";
  return `${prefix}${leg.flightNumber} · ${leg.depAirport} → ${leg.arrAirport}`;
}

function legDetail(leg: TripLeg): string {
  const times = `${formatHHMM(leg.depTimeLocal)} → ${formatHHMM(leg.arrTimeLocal)} local`;
  return leg.blockHours !== null ? `${times} · ${formatDuration(leg.blockHours)} block` : times;
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
function groundSegment(duty: TripDutyPeriod, isFirstDuty: boolean): RawSegment | null {
  const firstLeg = duty.legs[0];
  if (!firstLeg || firstLeg.startMinutes <= duty.startMinutes) return null;
  const durationLabel = formatDuration((firstLeg.startMinutes - duty.startMinutes) / 60);
  return {
    kind: "ground",
    label: isFirstDuty ? "Report" : "Ground transport",
    detail: isFirstDuty
      ? `Report ${formatHHMM(duty.reportTimeLocal)} → block-off ${formatHHMM(firstLeg.depTimeLocal)} · ${durationLabel}`
      : `Hotel pickup → block-off ${formatHHMM(firstLeg.depTimeLocal)} · ${durationLabel}`,
    startMinutes: duty.startMinutes,
    endMinutes: firstLeg.startMinutes,
  };
}

/** Ground time between two flights in the same duty period — too short to be a layover, just deplane/walk/board for the next leg. */
function connectionSegments(duty: TripDutyPeriod): RawSegment[] {
  const segments: RawSegment[] = [];
  for (let i = 0; i < duty.legs.length - 1; i++) {
    const prev = duty.legs[i];
    const next = duty.legs[i + 1];
    if (next.startMinutes <= prev.endMinutes) continue;
    segments.push({
      kind: "connection",
      label: "Connection",
      detail: `${prev.arrAirport} ground time · ${formatDuration((next.startMinutes - prev.endMinutes) / 60)}`,
      startMinutes: prev.endMinutes,
      endMinutes: next.startMinutes,
    });
  }
  return segments;
}

/**
 * Flattens a trip's duty periods into absolute-minute segments, then slices
 * each one across day boundaries into per-day, clipped copies — a segment
 * spanning midnight becomes two segments, one on each day, marked so the UI
 * can draw them as one continuous bar rather than two separate ones.
 */
export function buildTimelineDays(trip: Trip): TimelineDay[] {
  if (trip.schedule.length === 0) return [];

  const raw: RawSegment[] = [];
  trip.schedule.forEach((duty, dutyIndex) => {
    const ground = groundSegment(duty, dutyIndex === 0);
    if (ground) raw.push(ground);
    raw.push(...connectionSegments(duty));

    for (const leg of duty.legs) {
      raw.push({
        kind: leg.isDeadhead ? "deadhead" : "flying",
        label: legLabel(leg),
        detail: legDetail(leg),
        startMinutes: leg.startMinutes,
        endMinutes: leg.endMinutes,
      });
    }
    if (duty.layover) {
      const cityLabel = duty.layover.hotelName
        ? `${duty.layover.hotelName}`
        : duty.layover.city;
      raw.push({
        kind: "layover",
        label: cityLabel,
        detail: `${duty.layover.city} · ${formatDuration(duty.layover.hours)} at hotel`,
        startMinutes: duty.layover.startMinutes,
        endMinutes: duty.layover.endMinutes,
      });
    }
  });

  if (raw.length === 0) return [];

  const lastEnd = Math.max(...raw.map((s) => s.endMinutes));
  const totalDays = Math.max(1, Math.ceil(lastEnd / MINUTES_PER_DAY));

  const days: TimelineDay[] = [];
  for (let d = 0; d < totalDays; d++) {
    const dayStart = d * MINUTES_PER_DAY;
    const dayEnd = dayStart + MINUTES_PER_DAY;
    const segments: TimelineSegment[] = [];

    for (const seg of raw) {
      if (seg.endMinutes <= dayStart || seg.startMinutes >= dayEnd) continue;
      const clippedStart = Math.max(seg.startMinutes, dayStart) - dayStart;
      const clippedEnd = Math.min(seg.endMinutes, dayEnd) - dayStart;
      segments.push({
        kind: seg.kind,
        label: seg.label,
        detail: seg.detail,
        startMinuteOfDay: clippedStart,
        endMinuteOfDay: clippedEnd,
        continuesFromPreviousDay: seg.startMinutes < dayStart,
        continuesToNextDay: seg.endMinutes > dayEnd,
      });
    }

    days.push({ dayNumber: d + 1, segments });
  }

  return days;
}
