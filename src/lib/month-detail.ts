import { buildLineMonthCalendar, type LineMonthDay } from "@/lib/line-month";
import { isInternationalCity } from "@/lib/pdf-parser/airports";
import { lineDutyPeriods } from "@/lib/duty-periods";
import { lineStandbyDays } from "@/lib/standby";
import type { TimelineSegment, TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";
import type { CitySentiment } from "@/types/preferences";

/**
 * The detailed month calendar: the same grid `month-grid.ts` draws, with
 * every day carrying what the bid pack actually says about it — the trip
 * (by its own number), when the duty starts and ends, a 24-hour strip of
 * what kind of time it is (flying, deadhead, hotel standby, layover…),
 * landings, red-eyes and early reports, and the layover city with how the
 * pilot feels about it. Each piece is something the interview asks about,
 * shown where a pilot would look for it.
 */

/** The local hours the circadian score treats as the body's low point (see `circadian.ts`), and the window `trip-analytics.ts` calls a red-eye. */
const WOCL_START_MIN = 2 * 60;
const WOCL_END_MIN = 6 * 60;
const RED_EYE_END_MIN = 5 * 60;

export interface StripSegment {
  kind: TimelineSegmentKind;
  /** 0-1440 minute of the local day. */
  start: number;
  end: number;
}

export type DetailedDayKind = "off" | "trip" | "layover" | "standby" | "estimated";

/**
 * One line of a calendar day, as a pilot reads a day of flying: a flight (or deadhead) leaving that day — from, to,
 * local departure and, if it lands the same day, arrival; standby, where and when; or a flight from the night before
 * landing that morning.
 */
export interface DayFlight {
  kind: "flying" | "deadhead" | "standby" | "lands";
  from: string;
  to: string;
  /** Local "HH:MM" — departure (or the start of standby); absent for a landing carried from the night before. */
  dep?: string;
  /** Local "HH:MM" it lands (or standby ends) — absent when it runs on past midnight. */
  arr?: string;
}

export interface DetailedDay {
  dayIndex: number;
  /** Day of the month ("28", "1") when real dates are known, else the bid-period day number. */
  label: string;
  weekday: string | null;
  /** Saturday or Sunday — pilots read a calendar by its weekends. */
  isWeekend: boolean;
  kind: DetailedDayKind;
  tripIndex: number | null;
  /** The bid pack's own number for this trip ("60"), null for an estimated trip. */
  tripNumber: string | null;
  tripDay: number | null;
  tripDayCount: number | null;
  tripCreditHours: number | null;
  isTripStart: boolean;
  isTripEnd: boolean;
  /** What the 24 hours of this day are made of. */
  strip: StripSegment[];
  /** Local "HH:MM" the duty starts (report or hotel pickup) when a duty begins on this day. */
  dutyStart: string | null;
  /** The local date of `dutyStart` when it isn't this calendar day — a Seoul pickup on Monday sits on Sunday's Anchorage calendar. */
  dutyStartLocalDate: string | null;
  /** The same for `releaseTime`. */
  releaseLocalDate: string | null;
  /** Local "HH:MM" of the last landing on the day the trip ends. */
  releaseTime: string | null;
  /** Flights landed this day (deadheads and standby excluded). */
  landings: number;
  hasDeadhead: boolean;
  hasStandby: boolean;
  /** A flight departs or lands between midnight and 5am local. */
  redEye: boolean;
  /** The duty starts in the 2–6am window the body clock treats as its low point. */
  earlyReport: boolean;
  layoverCode: string | null;
  layoverHotel: string | null;
  /** "12h30m", as the segment prints it. */
  layoverRest: string | null;
  layoverInternational: boolean;
  citySentiment: CitySentiment | null;
  /** For a day off: the length of the run of days off this one belongs to, and whether it opens it. */
  offRun: { length: number; isFirst: boolean; position: number } | null;
  /** The evening before a trip that reports just after midnight: not a day off, but nothing flies on it. */
  preReportTime: string | null;
  segments: TimelineSegment[];
  /** The day's flying, standby and landings, in order — what the calendar cell lists. */
  flights: DayFlight[];
  /** A whole day at a layover hotel, nothing flown: the city. */
  restCity: string | null;
  /** A trip's tail on a day the grid gives to something else — usually a landing just after midnight on a day the bid pack counts as off. */
  spill: { tripNumber: string | null; segments: TimelineSegment[]; landsAt: string | null } | null;
  title: string;
}

export interface MonthSummary {
  /** Days off as this calendar draws them. */
  daysOff: number;
  /** Days off as the bid pack itself prints them for the line — usually the same, occasionally a day different at the edge of a trip. */
  printedDaysOff: number;
  /** Lengths of each run of consecutive days off, in calendar order. */
  offRuns: number[];
  longestOffRun: number;
  /** Saturday-and-Sunday pairs both off. */
  weekendsOff: number;
  weekendsTotal: number;
  dutyPeriods: number;
  landings: number;
  standbyDays: number;
  redEyeDays: number;
  earlyReportDays: number;
  earliestDutyStart: string | null;
  latestRelease: string | null;
  layoverNights: number;
  internationalLayoverNights: number;
  /** Each distinct layover city, with how the pilot feels about it. */
  cities: { code: string; nights: number; sentiment: CitySentiment | null; international: boolean }[];
  longestTripDays: number;
}

export interface DetailedMonth {
  days: DetailedDay[];
  summary: MonthSummary;
  weekdayHeaders: string[] | null;
  placementIsReal: boolean;
}

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hhmm(minute: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function cityOf(inlineStart: string): string | null {
  const code = inlineStart.split(" · ")[0]?.trim();
  return code && /^[A-Z]{3,4}$/.test(code) ? code : null;
}

function restOf(detail: string): string | null {
  return detail.match(/·\s*([0-9]+h(?:[0-9]+m)?)\s+at hotel/)?.[1] ?? null;
}

/** Duty start = the first thing that belongs to a duty (report, hotel pickup, first flight) to begin on this day. */
function dutyStartSegment(segments: TimelineSegment[]): TimelineSegment | null {
  return (
    segments
      .filter((s) => (s.kind === "ground" || s.kind === "flying" || s.kind === "deadhead") && !s.continuesFromPreviousDay)
      .sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)[0] ?? null
  );
}

/** The day's flights, standby and morning landings, in the order they happen. */
export function dayFlights(segments: TimelineSegment[]): DayFlight[] {
  return [...segments]
    .sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)
    .flatMap((s): DayFlight[] => {
      if (s.kind === "standby") {
        if (s.continuesFromPreviousDay) return [];
        const at = s.startAirport ?? "";
        return [{ kind: "standby", from: at, to: at, dep: s.startClock, ...(s.continuesToNextDay ? {} : { arr: s.endClock }) }];
      }
      if ((s.kind !== "flying" && s.kind !== "deadhead") || !s.leg) return [];
      if (s.continuesFromPreviousDay) return s.continuesToNextDay ? [] : [{ kind: "lands", from: s.leg.dep, to: s.leg.arr, arr: s.leg.arrClock }];
      return [{ kind: s.kind, from: s.leg.dep, to: s.leg.arr, dep: s.leg.depClock, ...(s.continuesToNextDay ? {} : { arr: s.leg.arrClock }) }];
    });
}

/** Minutes past midnight of an "HH:MM" clock. */
const clockMinutes = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5));

/**
 * A segment's own minute-of-day edges, made safe to draw. A long flight whose
 * local arrival time lands earlier on the clock than its departure (it
 * crosses several time zones) can come out of the timeline with an end
 * before its start; on a day strip that only ever means "runs to the end of
 * the day", so it's drawn that way rather than as a negative width.
 */
export function toStripSegment(s: TimelineSegment): StripSegment {
  const start = Math.max(0, Math.min(1440, s.startMinuteOfDay));
  const end = s.endMinuteOfDay < start ? 1440 : Math.min(1440, s.endMinuteOfDay);
  return { kind: s.kind, start, end };
}

/** "Mon Oct 5" for an ISO date. */
function localDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function describeDay(day: LineMonthDay, d: Omit<DetailedDay, "title">): string {
  const date = day.date && day.weekday ? `${day.weekday} ${day.date.slice(5)}` : `Day ${day.dayIndex + 1}`;
  if (d.kind === "off")
    return `${date} — day off${d.offRun && d.offRun.length > 1 ? ` (day ${d.offRun.position} of ${d.offRun.length} off)` : ""}${d.spill ? `; trip ${d.spill.tripNumber ?? ""} finishes on it${d.spill.landsAt ? `, landing ${d.spill.landsAt} (L)` : ""}` : ""}`;
  if (d.preReportTime !== null) {
    return `${date} — not a day off: trip ${d.tripNumber ?? (d.tripIndex ?? 0) + 1} reports at ${d.preReportTime} (L) the next morning, so this evening goes to it`;
  }
  if (d.tripIndex === null) return `${date} — on duty, continuing a trip from the previous bid period`;
  const parts = [`${date} — trip ${d.tripNumber ?? d.tripIndex + 1}, day ${d.tripDay} of ${d.tripDayCount}`];
  if (d.kind === "estimated") return `${parts[0]} (exact daily detail unavailable)`;
  if (d.dutyStart) parts.push(`duty starts ${d.dutyStart} (L)${d.dutyStartLocalDate ? ` ${localDay(d.dutyStartLocalDate)} local` : ""}`);
  if (d.landings > 0) parts.push(`${d.landings} landing${d.landings === 1 ? "" : "s"}`);
  if (d.hasDeadhead) parts.push("deadhead");
  if (d.hasStandby) parts.push("standby");
  if (d.redEye) parts.push("red-eye");
  if (d.earlyReport) parts.push("early report");
  if (d.releaseTime) parts.push(`lands ${d.releaseTime} (L)${d.releaseLocalDate ? ` ${localDay(d.releaseLocalDate)} local` : ""}, trip ends`);
  if (d.layoverCode) parts.push(`layover in ${d.layoverCode}${d.layoverRest ? ` (${d.layoverRest})` : ""}`);
  if (d.spill) parts.push(`trip ${d.spill.tripNumber ?? ""} also finishes${d.spill.landsAt ? `, landing ${d.spill.landsAt} (L)` : ""}`);
  return parts.join(", ");
}

export function buildDetailedMonth(
  line: Line,
  bidPeriodStart: string | null,
  bidPeriodDays: number,
  cityPreferences: Record<string, CitySentiment> = {}
): DetailedMonth {
  const calendar = buildLineMonthCalendar(line, bidPeriodStart, bidPeriodDays, "local");

  // Runs of consecutive days off — "how the days off fall" is one of the first things the interview asks.
  const runs: { start: number; length: number }[] = [];
  calendar.days.forEach((day, i) => {
    if (!day.isOff) return;
    const last = runs[runs.length - 1];
    if (last && last.start + last.length === i) last.length++;
    else runs.push({ start: i, length: 1 });
  });

  const days: DetailedDay[] = calendar.days.map((day) => {
    const tripIndex = day.tripIndex;
    const trip = tripIndex !== null ? line.trips[tripIndex] : null;
    const label = day.date ? String(Number(day.date.slice(8, 10))) : String(day.dayIndex + 1);
    const isWeekend = day.weekday === "Sat" || day.weekday === "Sun";
    const base = {
      dayIndex: day.dayIndex,
      label,
      weekday: day.weekday,
      isWeekend,
      tripIndex,
      tripNumber: trip?.pairingNumber ?? null,
      tripDay: day.tripDayNumber,
      tripDayCount: day.tripDayCount,
      tripCreditHours: trip?.creditHours ?? null,
      isTripStart: day.isTripStart,
      isTripEnd: day.isTripEnd,
      segments: day.segments,
    };

    const spill = day.spill
      ? {
          tripNumber: line.trips[day.spill.tripIndex]?.pairingNumber ?? null,
          segments: day.spill.segments,
          // Its last landing, on that airport's clock.
          landsAt:
            day.spill.segments
              .filter((s) => (s.kind === "flying" || s.kind === "deadhead") && !s.continuesToNextDay)
              .sort((a, b) => a.endMinuteOfDay - b.endMinuteOfDay)
              .at(-1)?.endClock ?? null,
        }
      : null;
    if (day.isOff) {
      const run = runs.find((r) => day.dayIndex >= r.start && day.dayIndex < r.start + r.length)!;
      const d = {
        ...base,
        spill,
        kind: "off" as const,
        flights: spill ? dayFlights(spill.segments) : [],
        restCity: null,
        strip: spill ? spill.segments.map(toStripSegment) : [],
        dutyStart: null,
        dutyStartLocalDate: null,
        releaseLocalDate: null,
        releaseTime: null,
        landings: 0,
        hasDeadhead: false,
        hasStandby: false,
        redEye: false,
        earlyReport: false,
        layoverCode: null,
        layoverHotel: null,
        layoverRest: null,
        layoverInternational: false,
        citySentiment: null,
        offRun: { length: run.length, isFirst: day.dayIndex === run.start, position: day.dayIndex - run.start + 1 },
        preReportTime: null,
      };
      return { ...d, title: describeDay(day, d) };
    }

    if (day.isPreReport) {
      const report = trip?.schedule[0]?.reportTimeLocal ?? null;
      const d = {
        ...base,
        spill,
        kind: "trip" as const,
        flights: [],
        restCity: null,
        strip: [],
        dutyStart: null,
        dutyStartLocalDate: null,
        releaseLocalDate: null,
        releaseTime: null,
        landings: 0,
        hasDeadhead: false,
        hasStandby: false,
        redEye: false,
        earlyReport: false,
        layoverCode: null,
        layoverHotel: null,
        layoverRest: null,
        layoverInternational: false,
        citySentiment: null,
        offRun: null,
        preReportTime: report ? `${report.slice(0, 2)}:${report.slice(2, 4)}` : "",
      };
      return { ...d, title: describeDay(day, d) };
    }

    if (!day.hasSchedule) {
      const d = {
        ...base,
        spill,
        kind: "estimated" as const,
        flights: [],
        restCity: null,
        strip: [],
        dutyStart: null,
        dutyStartLocalDate: null,
        releaseLocalDate: null,
        releaseTime: null,
        landings: 0,
        hasDeadhead: false,
        hasStandby: false,
        redEye: false,
        earlyReport: false,
        layoverCode: null,
        layoverHotel: null,
        layoverRest: null,
        layoverInternational: false,
        citySentiment: null,
        offRun: null,
        preReportTime: null,
      };
      return { ...d, title: describeDay(day, d) };
    }

    const segs = day.segments;
    const flights = segs.filter((s) => s.kind === "flying" || s.kind === "deadhead");
    const startSeg = dutyStartSegment(segs);
    // Each read on the piece's own clock — local where it happens.
    const dutyStart = startSeg ? (startSeg.startClock ?? hhmm(startSeg.startMinuteOfDay)) : null;
    const layover = segs.find((s) => s.kind === "layover" && !s.continuesFromPreviousDay);
    const layoverCode = layover ? cityOf(layover.inlineStart) : null;
    const hasStandby = segs.some((s) => s.kind === "standby");
    const lastLanding = day.isTripEnd
      ? flights.filter((s) => !s.continuesToNextDay).reduce<TimelineSegment | null>((a, s) => (!a || s.endMinuteOfDay > a.endMinuteOfDay ? s : a), null)
      : null;

    const d = {
      ...base,
      spill,
      kind: hasStandby && !flights.length ? ("standby" as const) : layoverCode ? ("layover" as const) : ("trip" as const),
      // In the order they happen: the end of another trip that morning, then this day's own.
      flights: dayFlights([...(spill?.segments ?? []), ...segs]),
      // A day with nothing flown, spent at a layover hotel: the city (the hotel pickup for tonight's flight may fall on it).
      restCity:
        !segs.some((x) => x.kind === "flying" || x.kind === "deadhead" || x.kind === "standby") && segs.some((x) => x.kind === "layover")
          ? ([...segs].filter((x) => x.kind === "layover").sort((a, b) => b.endMinuteOfDay - b.startMinuteOfDay - (a.endMinuteOfDay - a.startMinuteOfDay))[0].stay?.city ?? null)
          : null,
      strip: [...segs, ...(spill?.segments ?? [])].map(toStripSegment),
      dutyStart,
      dutyStartLocalDate: startSeg?.startDate && day.date && startSeg.startDate !== day.date ? startSeg.startDate : null,
      releaseTime: lastLanding ? (lastLanding.endClock ?? hhmm(lastLanding.endMinuteOfDay)) : null,
      releaseLocalDate: lastLanding?.endDate && day.date && lastLanding.endDate !== day.date ? lastLanding.endDate : null,
      landings: segs.filter((s) => s.kind === "flying" && !s.continuesToNextDay).length,
      hasDeadhead: segs.some((s) => s.kind === "deadhead"),
      hasStandby,
      redEye: flights.some((s) => {
        const dep = clockMinutes(s.startClock ?? hhmm(s.startMinuteOfDay));
        const arr = clockMinutes(s.endClock ?? hhmm(s.endMinuteOfDay));
        return (!s.continuesFromPreviousDay && dep < RED_EYE_END_MIN) || (!s.continuesToNextDay && arr <= RED_EYE_END_MIN && arr > 0);
      }),
      earlyReport: dutyStart !== null && clockMinutes(dutyStart) >= WOCL_START_MIN && clockMinutes(dutyStart) < WOCL_END_MIN,
      layoverCode,
      layoverHotel: layover && layover.label !== layoverCode ? layover.label : null,
      layoverRest: layover ? restOf(layover.detail) : null,
      layoverInternational: layoverCode ? isInternationalCity(layoverCode) : false,
      citySentiment: layoverCode ? (cityPreferences[layoverCode] ?? null) : null,
      offRun: null,
      preReportTime: null,
    };
    return { ...d, title: describeDay(day, d) };
  });

  const firstWeekday = calendar.days[0]?.weekday ?? null;
  const startAt = firstWeekday ? WEEKDAY_ORDER.indexOf(firstWeekday) : -1;
  const weekdayHeaders = calendar.placementIsReal && startAt >= 0 ? Array.from({ length: 7 }, (_, i) => WEEKDAY_ORDER[(startAt + i) % 7]) : null;

  return {
    days,
    summary: summarize(
      line,
      days,
      runs.map((r) => r.length),
      cityPreferences
    ),
    weekdayHeaders,
    placementIsReal: calendar.placementIsReal,
  };
}

function summarize(line: Line, days: DetailedDay[], offRuns: number[], cityPreferences: Record<string, CitySentiment>): MonthSummary {
  const off = days.filter((d) => d.kind === "off").length;

  let weekendsOff = 0;
  let weekendsTotal = 0;
  days.forEach((d, i) => {
    if (d.weekday !== "Sat" || !days[i + 1] || days[i + 1].weekday !== "Sun") return;
    weekendsTotal++;
    if (d.kind === "off" && days[i + 1].kind === "off") weekendsOff++;
  });

  const layoverDays = days.filter((d) => d.layoverCode);
  const cityMap = new Map<string, { code: string; nights: number }>();
  for (const d of layoverDays) {
    const entry = cityMap.get(d.layoverCode!) ?? { code: d.layoverCode!, nights: 0 };
    entry.nights++;
    cityMap.set(d.layoverCode!, entry);
  }

  const starts = days
    .map((d) => d.dutyStart)
    .filter((s): s is string => !!s)
    .sort();
  // Latest by the clock of the night: a landing just after midnight (00:35) is later than one at 23:41, and a trip
  // landing onto a day off counts too.
  const nightOrder = (c: string) => (clockMinutes(c) < RED_EYE_END_MIN ? clockMinutes(c) + 1440 : clockMinutes(c));
  const releases = [...days.map((d) => d.releaseTime), ...days.map((d) => d.spill?.landsAt ?? null)]
    .filter((s): s is string => !!s)
    .sort((a, b) => nightOrder(a) - nightOrder(b));

  return {
    daysOff: off,
    printedDaysOff: line.daysOff,
    offRuns,
    longestOffRun: Math.max(0, ...offRuns),
    weekendsOff,
    weekendsTotal,
    dutyPeriods: lineDutyPeriods(line),
    landings: line.totalLandings,
    // The line's own count, not the number of calendar days a standby row touches — a standby that runs overnight lands on two local days.
    standbyDays: lineStandbyDays(line),
    redEyeDays: days.filter((d) => d.redEye).length,
    earlyReportDays: days.filter((d) => d.earlyReport).length,
    earliestDutyStart: starts[0] ?? null,
    latestRelease: releases[releases.length - 1] ?? null,
    layoverNights: layoverDays.length,
    internationalLayoverNights: layoverDays.filter((d) => d.layoverInternational).length,
    cities: Array.from(cityMap.values())
      .sort((a, b) => b.nights - a.nights || a.code.localeCompare(b.code))
      .map((c) => ({ ...c, sentiment: cityPreferences[c.code] ?? null, international: isInternationalCity(c.code) })),
    longestTripDays: Math.max(0, ...line.trips.map((t) => t.days)),
  };
}
