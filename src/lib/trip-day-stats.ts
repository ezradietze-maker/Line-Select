import type { TimelineDay, TimelineSegment } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";

/**
 * The numbers a pilot reads off one day of a trip — when the duty starts,
 * when the last flight blocks in, how much of it is flying, how many
 * landings — worked out from the same segments the charts draw, so the
 * header above a day column can never disagree with the column itself.
 * Every value is the bid pack's own printed time in whichever clock the
 * segments were built in; nothing is estimated (a release time would need a
 * debrief allowance the pack doesn't print, so the day ends at "last in").
 */

export interface DayStats {
  /** "HH:MM" the first duty on this day starts (report or hotel pickup), or null when the day opens mid-duty or has none. */
  onDuty: string | null;
  /** "HH:MM" the last flight on this day blocks in, or null. */
  lastIn: string | null;
  /** "HH:MM" the day's duty is done — the last block-in, or the end of hotel standby — or null when it runs on past midnight. */
  dutyEnd: string | null;
  /** Operated block time on this day (deadheads excluded), clipped to the day. */
  blockMinutes: number;
  /** Deadhead time on this day, clipped to the day. */
  deadheadMinutes: number;
  landings: number;
  /** A flight or duty runs in from the day before / on into the next one. */
  continuesIn: boolean;
  continuesOut: boolean;
  /** Nothing but hotel time — a full rest day away from base. */
  restDay: boolean;
  /** Hotel standby on this day. */
  standby: boolean;
  /**
   * Each separate duty that touches this day, in order — a day can hold the
   * end of last night's duty and the start of tonight's. `start` is null
   * when the duty runs in from the day before, `end` null when it runs on
   * into the next. Folding these into one "start–end" read the 23:20 pickup
   * and the 06:13 landing of two different duties as one backwards window.
   */
  windows: { start: string | null; end: string | null }[];
}

const DUTY_KINDS = new Set<TimelineSegment["kind"]>(["ground", "flying", "deadhead", "connection", "standby"]);

export function clock(minuteOfDay: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minuteOfDay)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "4:02" — the way block time is written on a pairing. */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** A segment's drawn length on its day; a fragment whose clock end reads earlier than its start runs to midnight. */
function span(s: TimelineSegment): number {
  const end = s.endMinuteOfDay < s.startMinuteOfDay ? 1440 : s.endMinuteOfDay;
  return Math.max(0, end - s.startMinuteOfDay);
}

/**
 * Flight time on a day, from each leg's printed block time — not the drawn
 * length, which in local time is the gap between two different time zones'
 * clocks (07:00 Chicago to 09:37 Oakland is a 4:37 flight, not 2:37). A leg
 * counts on the day it departs, the way a pairing lists it.
 */
function legMinutes(segs: TimelineSegment[], kind: "flying" | "deadhead"): number {
  return segs
    .filter((s) => s.kind === kind && !s.continuesFromPreviousDay)
    .reduce((a, s) => a + (s.leg?.blockMinutes ?? span(s)), 0);
}

export function dayStats(day: TimelineDay): DayStats {
  const segs = day.segments;
  const duty = segs.filter((s) => DUTY_KINDS.has(s.kind));
  const starts = duty.filter((s) => !s.continuesFromPreviousDay).map((s) => s.startMinuteOfDay);
  const flights = segs.filter((s) => s.kind === "flying" || s.kind === "deadhead");
  const ends = flights.filter((s) => !s.continuesToNextDay).map((s) => s.endMinuteOfDay);
  const dutyEnds = segs.filter((s) => (s.kind === "flying" || s.kind === "deadhead" || s.kind === "standby") && !s.continuesToNextDay).map((s) => s.endMinuteOfDay);
  // Duties are separated by hotel time; ground, connections, flights and standby all belong to the duty around them.
  const windows: DayStats["windows"] = [];
  let block: TimelineSegment[] = [];
  const close = () => {
    if (block.length === 0) return;
    const first = block[0];
    const ending = block.filter((s) => s.kind !== "ground" && s.kind !== "connection");
    const last = ending[ending.length - 1] ?? block[block.length - 1];
    windows.push({
      start: first.continuesFromPreviousDay ? null : clock(first.startMinuteOfDay),
      end: last.continuesToNextDay || last.kind === "ground" ? null : clock(last.endMinuteOfDay),
    });
    block = [];
  };
  for (const seg of [...segs].sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)) {
    if (seg.kind === "layover") close();
    else block.push(seg);
  }
  close();

  return {
    windows,
    onDuty: starts.length ? clock(Math.min(...starts)) : null,
    lastIn: ends.length ? clock(Math.max(...ends)) : null,
    dutyEnd: dutyEnds.length ? clock(Math.max(...dutyEnds)) : null,
    blockMinutes: legMinutes(segs, "flying"),
    deadheadMinutes: legMinutes(segs, "deadhead"),
    landings: segs.filter((s) => s.kind === "flying" && !s.continuesToNextDay).length,
    continuesIn: duty.some((s) => s.continuesFromPreviousDay),
    continuesOut: duty.some((s) => s.continuesToNextDay),
    restDay: segs.length > 0 && segs.every((s) => s.kind === "layover"),
    standby: segs.some((s) => s.kind === "standby"),
  };
}

/** Every airport the trip touches, in order, without repeating a stop — "MEM ORD OAK ANC MEM". */
export function tripRoute(trip: Trip): string[] {
  const route: string[] = [];
  for (const duty of trip.schedule) {
    for (const leg of duty.legs) {
      if (leg.isStandby) continue;
      if (route[route.length - 1] !== leg.depAirport) route.push(leg.depAirport);
      route.push(leg.arrAirport);
    }
  }
  return route;
}

/** Operated block hours across the trip (deadheads and standby excluded). */
export function tripBlockMinutes(trip: Trip): number | null {
  const legs = trip.schedule.flatMap((d) => d.legs).filter((l) => !l.isDeadhead && !l.isStandby);
  if (legs.length === 0 || legs.some((l) => l.blockHours === null)) return null;
  return Math.round(legs.reduce((a, l) => a + (l.blockHours ?? 0) * 60, 0));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The real calendar date of a trip's Nth local day ("Mon 28 Sep"), when the
 * bid pack placed the trip on real dates. Local days only — a Zulu day
 * column doesn't line up with one local date.
 */
export function tripDayDate(trip: Trip, bidPeriodStart: string | null, dayNumber: number): { weekday: string; day: number; month: string } | null {
  if (!bidPeriodStart || trip.startDayIndex === null) return null;
  const d = new Date(`${bidPeriodStart}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + trip.startDayIndex + dayNumber - 1);
  return { weekday: WEEKDAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] };
}

/** How the bid pack's equipment code reads to a pilot. */
export function equipmentLabel(code: string, deadhead: boolean): string {
  const c = code.trim().toUpperCase();
  if (c === "JET") return "airline";
  if (c === "CAB") return "ground";
  if (!c) return deadhead ? "DH" : "";
  return c;
}
