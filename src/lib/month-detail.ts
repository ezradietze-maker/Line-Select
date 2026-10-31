import { buildLineMonthCalendar, type LineMonthDay } from "@/lib/line-month";
import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { groupDepartures, type DepartureOptions } from "@/lib/metrics/departures";
import { hubTurnsOf, summarizeHubTurns, type HubTurnSummary } from "@/lib/metrics/hub-turns";
import { DEFAULT_MIN_BREAK_NIGHTS, homeStretches, summarizeHomeTime } from "@/lib/metrics/home-stretches";
import { lineLengthDays } from "@/lib/metrics/line-length";
import { isInternationalCity } from "@/lib/pdf-parser/airports";
import { lineDutyPeriods } from "@/lib/duty-periods";
import { lineStandbyDays } from "@/lib/standby";
import type { TimeMode, TimelineSegment, TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";
import type { CityMark, PreferenceProfile } from "@/types/preferences";
import type { FlightAnswers } from "@/lib/flights/trip-travel";

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
/**
 * Trips this close together at base are drawn as one departure: a pilot who lives elsewhere flies them back to back
 * without going home ("that combination of trips is a single departure"). In the October MD-11 pack, chained trips
 * turn in under 3 hours and every real gap is two days or more, so 12 hours sits well clear of both.
 */
export const CHAIN_MAX_MINUTES = 12 * 60;

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

/** One stop on a day's route: a city, and whether the hop that reached it was a deadhead. The first stop has no hop. */
export interface RouteStop {
  city: string;
  viaDeadhead: boolean;
}

/** Where and when a trip's flying ends, on the trip's own last day — a landing after midnight is still this trip's. */
export interface TripFinish {
  city: string;
  time: string;
  /** Lands after midnight, on the next calendar day. */
  nextDay: boolean;
}

/** A trip that reports within hours of the last one landing at the same base: flown together, one departure from home. */
export interface TripChain {
  /** The trip it turns out of. */
  fromTripNumber: string | null;
  city: string;
  /** Minutes on the ground between landing and reporting again. */
  turnMinutes: number;
  landed: string;
  reports: string;
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
  citySentiment: CityMark | null;
  /** For a day off: the length of the run of days off this one belongs to, and whether it opens it. */
  offRun: { length: number; isFirst: boolean; position: number } | null;
  /** The evening before a trip that reports just after midnight: not a day off, but nothing flies on it. */
  preReportTime: string | null;
  segments: TimelineSegment[];
  /** The day's flying, standby and landings, in order — what the day detail lists. */
  flights: DayFlight[];
  /** The day's own flying as the bid pack prints it — city to city, deadheads marked ("MEM dh PHX dh SEA"). Empty on a day with none. */
  route: RouteStop[];
  /** On a trip's last day: where and when its flying ends. */
  finish: TripFinish | null;
  /** On the first day of a trip that turns straight out of the one before it at base — one departure from home. */
  chain: TripChain | null;
  /** What this day means for a commuter at base: a hotel night before an early show, a jumpseat in instead, nights waiting between trips, or a night after a late release. */
  baseNote?: string;
  /** The hub turns flown on this day's duty, in words: "Night hub turn at IND: in 00:59, out 03:35 (2h36 through the sort)". */
  hubNote?: string;
  /** On the day the pilot gets home from a departure: how long they're home before the next, door to door. */
  homeNote?: string;
  /** A whole day at a layover hotel, nothing flown: the city. */
  restCity: string | null;
  /** A trip's tail on a day the grid gives to something else — usually a landing just after midnight on a day the bid pack counts as off. */
  spill: { tripNumber: string | null; segments: TimelineSegment[]; landsAt: string | null } | null;
  title: string;
}

export interface MonthSummary {
  /** Trips flown back to back at base count once: how many times the pilot leaves home. */
  departures: number;
  /** For a commuter: commutes to and from base and nights spent there (null for a pilot who lives at base). */
  base?: { code: string; commutes: number; nights: number; jumpseatIns: number } | null;
  /** The line's hub turns (see `metrics/hub-turns.ts`); null when the base isn't known or there are none. */
  hubTurns?: HubTurnSummary | null;
  /**
   * Time at home, door to door (see `metrics/home-stretches.ts`): each stay at home between departures in hours and
   * nights, nights at home in the month, and the stays too short to be a real break. Null without the base, or when the
   * month can't be placed.
   */
  home?: { between: { hours: number; nights: number }[]; nightsHome: number; shortGaps: number; minBreakNights: number } | null;
  /**
   * A five-week line: its last trip flies past the end of the bid month (carry-over). How many days past, and the last
   * landing on the base's clock ("Fri Oct 30"). Its departures are judged over that longer month. Null for a line that
   * stays inside the month, or without the base.
   */
  pastMonthEnd?: { days: number; lastLanding: string } | null;
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
  earlyReportDays: number;
  earliestDutyStart: string | null;
  latestRelease: string | null;
  layoverNights: number;
  internationalLayoverNights: number;
  /** Each distinct layover city, with how the pilot feels about it. */
  cities: { code: string; nights: number; sentiment: CityMark | null; international: boolean }[];
  longestTripDays: number;
}

export interface DetailedMonth {
  days: DetailedDay[];
  /** Whose clock the days and every time on them are on: "L" local (the base's calendar), "Z" Zulu. */
  clock: "L" | "Z";
  /** The line's own month, counted on the base's calendar whichever clock the days are drawn on. */
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

/** The day's own hops, city to city, in the order flown: a flight that left the night before belongs to that day, not this one. */
export function dayRoute(segments: TimelineSegment[]): RouteStop[] {
  const stops: RouteStop[] = [];
  for (const s of [...segments].sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)) {
    if ((s.kind !== "flying" && s.kind !== "deadhead") || !s.leg || s.continuesFromPreviousDay) continue;
    if (stops.at(-1)?.city !== s.leg.dep) stops.push({ city: s.leg.dep, viaDeadhead: false });
    stops.push({ city: s.leg.arr, viaDeadhead: s.kind === "deadhead" });
  }
  return stops;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function describeDay(day: LineMonthDay, d: Omit<DetailedDay, "title">, clock: "L" | "Z" = "L"): string {
  // "Fri Oct 2", the way a pilot says it — not "Fri 10-02".
  const date = day.date && day.weekday ? `${day.weekday} ${MONTHS[Number(day.date.slice(5, 7)) - 1]} ${Number(day.date.slice(8, 10))}` : `Day ${day.dayIndex + 1}`;
  if (d.kind === "off")
    return `${date} — day off${d.offRun && d.offRun.length > 1 ? ` (day ${d.offRun.position} of ${d.offRun.length} off)` : ""}${d.spill ? `; trip ${d.spill.tripNumber ?? ""} finishes on it${d.spill.landsAt ? `, landing ${d.spill.landsAt} (${clock})` : ""}` : ""}`;
  if (d.preReportTime !== null) {
    return `${date} — not a day off: trip ${d.tripNumber ?? (d.tripIndex ?? 0) + 1} reports at ${d.preReportTime} (${clock}) the next morning, so this evening goes to it`;
  }
  if (d.tripIndex === null) return `${date} — on duty, continuing a trip from the previous bid period`;
  const parts = [`${date} — trip ${d.tripNumber ?? d.tripIndex + 1}, day ${d.tripDay} of ${d.tripDayCount}`];
  if (d.kind === "estimated") return `${parts[0]} (exact daily detail unavailable)`;
  if (d.dutyStart) parts.push(`duty starts ${d.dutyStart} (${clock})${d.dutyStartLocalDate ? ` ${localDay(d.dutyStartLocalDate)} local` : ""}`);
  if (d.landings > 0) parts.push(`${d.landings} landing${d.landings === 1 ? "" : "s"}`);
  if (d.hasDeadhead) parts.push("deadhead");
  if (d.hasStandby) parts.push("standby");
  if (d.redEye) parts.push("red-eye");
  if (d.earlyReport) parts.push("early report");
  if (d.releaseTime) parts.push(`lands ${d.releaseTime} (${clock})${d.releaseLocalDate ? ` ${localDay(d.releaseLocalDate)} local` : ""}, trip ends`);
  if (d.layoverCode) parts.push(`layover in ${d.layoverCode}${d.layoverRest ? ` (${d.layoverRest})` : ""}`);
  if (d.spill) parts.push(`trip ${d.spill.tripNumber ?? ""} also finishes${d.spill.landsAt ? `, landing ${d.spill.landsAt} (${clock})` : ""}`);
  return parts.join(", ");
}

/** Where the pilot lives and the pack's base, so the calendar joins trips into the same departures the scores count. */
export interface MonthDepartureOptions extends DepartureOptions {
  base: string;
  /** Nights at home that make a real break, for this pilot (default 3). */
  minBreakNights?: number;
}

/** The calendar's departure options from what the pilot told the interview: a commuter's home airport, or none (lives at base). */
export function monthDepartureOptions(
  base: string,
  profile: (Pick<PreferenceProfile, "isCommuter" | "commuteFrom" | "hasCrashPad" | "minHomeHours"> & Partial<Pick<PreferenceProfile, "brainInterview">>) | null | undefined,
  flights?: FlightAnswers | null
): MonthDepartureOptions {
  const home = profile?.isCommuter && profile.commuteFrom ? [profile.commuteFrom] : [];
  // What makes a real break, as the pilot said it (read from their words beside the brain's reading).
  const minBreakNights = profile?.brainInterview?.reviewedModel?.home?.minBreakNights;
  return {
    base,
    homeAirports: home,
    hasCrashPad: profile?.hasCrashPad ?? null,
    ...(profile?.minHomeHours ? { minHomeHours: profile.minHomeHours } : {}),
    ...(minBreakNights ? { minBreakNights } : {}),
    ...(flights ? { flights } : {}),
  };
}

export function buildDetailedMonth(
  line: Line,
  bidPeriodStart: string | null,
  bidPeriodDays: number,
  cityPreferences: Record<string, CityMark> = {},
  departureOptions?: MonthDepartureOptions,
  /** Zulu: the days are Zulu days and every time is Zulu (see `buildLineMonthCalendar`); the summary stays the line's own. */
  mode: TimeMode = "local"
): DetailedMonth {
  const calendar = buildLineMonthCalendar(line, bidPeriodStart, bidPeriodDays, mode);
  const clock = mode === "zulu" ? "Z" : "L";
  // In Zulu, the month as the base counts it: its summary, and which trips report early — a body-clock matter, on the
  // clock the pilot lives on, not Zulu's.
  const local = mode === "zulu" ? buildDetailedMonth(line, bidPeriodStart, bidPeriodDays, cityPreferences, departureOptions) : null;
  const earlyReportTrips = new Set(local?.days.filter((d) => d.isTripStart && d.earlyReport && d.tripIndex !== null).map((d) => d.tripIndex!) ?? []);

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
        route: [],
        finish: null,
        chain: null,
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
      return { ...d, title: describeDay(day, d, clock) };
    }

    if (day.isPreReport) {
      const report = trip?.schedule[0]?.reportTimeLocal ?? null;
      const d = {
        ...base,
        spill,
        kind: "trip" as const,
        flights: [],
        route: [],
        finish: null,
        chain: null,
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
      return { ...d, title: describeDay(day, d, clock) };
    }

    if (!day.hasSchedule) {
      const d = {
        ...base,
        spill,
        kind: "estimated" as const,
        flights: [],
        route: [],
        finish: null,
        chain: null,
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
      return { ...d, title: describeDay(day, d, clock) };
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
      route: dayRoute(segs),
      chain: null,
      finish: lastLanding?.leg ? { city: lastLanding.leg.arr, time: lastLanding.endClock ?? hhmm(lastLanding.endMinuteOfDay), nextDay: false } : null,
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
      // Red-eyes are flying through the body's night, on the clock the pilot lives on — not something Zulu days show.
      redEye: !local && flights.some((s) => {
        const dep = clockMinutes(s.startClock ?? hhmm(s.startMinuteOfDay));
        const arr = clockMinutes(s.endClock ?? hhmm(s.endMinuteOfDay));
        return (!s.continuesFromPreviousDay && dep < RED_EYE_END_MIN) || (!s.continuesToNextDay && arr <= RED_EYE_END_MIN && arr > 0);
      }),
      earlyReport: local
        ? day.isTripStart && tripIndex !== null && earlyReportTrips.has(tripIndex)
        : dutyStart !== null && clockMinutes(dutyStart) >= WOCL_START_MIN && clockMinutes(dutyStart) < WOCL_END_MIN,
      layoverCode,
      layoverHotel: layover && layover.label !== layoverCode ? layover.label : null,
      layoverRest: layover ? restOf(layover.detail) : null,
      layoverInternational: layoverCode ? isInternationalCity(layoverCode) : false,
      citySentiment: layoverCode ? (cityPreferences[layoverCode] ?? null) : null,
      offRun: null,
      preReportTime: null,
    };
    return { ...d, title: describeDay(day, d, clock) };
  });

  // A trip's last flight landing after midnight lands on the next calendar day (a day off, or the next trip's first);
  // the trip's own last day says so, the way the bid pack keeps a trip to its own days.
  days.forEach((d, i) => {
    if (d.finish || d.kind === "off" || d.tripIndex === null) return;
    const next = calendar.days[i + 1];
    // The trip's last day in the grid — the calendar marks the end on the day it lands, which here is the next one.
    if (next?.tripIndex === d.tripIndex) return;
    if (!next?.spill || next.spill.tripIndex !== d.tripIndex) return;
    const landing = next.spill.segments
      .filter((s) => (s.kind === "flying" || s.kind === "deadhead") && !s.continuesToNextDay && s.leg)
      .sort((a, b) => a.endMinuteOfDay - b.endMinuteOfDay)
      .at(-1);
    if (landing?.leg) d.finish = { city: landing.leg.arr, time: landing.endClock ?? hhmm(landing.endMinuteOfDay), nextDay: true };
  });

  // Trips flown as one departure are joined. With the base known, that's the same grouping the scores count (his rule:
  // two trips are one departure unless he'd get 24 hours at home between them); without it, a trip reporting within a
  // few hours of the last one landing at the same base turns straight out of it.
  let departureCount: number | null = null;
  let summaryBase: MonthSummary["base"] = null;
  let summaryHubs: HubTurnSummary | null = null;
  let summaryHome: MonthSummary["home"] = null;
  let pastMonthEnd: MonthSummary["pastMonthEnd"] = null;
  if (departureOptions && bidPeriodStart) {
    const length = lineLengthDays(line, { bidPeriodStart, bidPeriodDays, base: departureOptions.base });
    if (length > bidPeriodDays) {
      const zone = timezoneForAirport(departureOptions.base) ?? "UTC";
      const last = DateTime.fromISO(bidPeriodStart, { zone }).plus({ milliseconds: length * 86_400_000 });
      pastMonthEnd = { days: Math.ceil(length - bidPeriodDays), lastLanding: last.toFormat("ccc LLL d") };
    }
  }
  if (departureOptions) {
    const deps = groupDepartures(line.trips, { bidPeriodStart, base: departureOptions.base }, departureOptions);
    departureCount = deps.length;
    const indexOf = new Map(line.trips.map((t, i) => [t, i] as const));
    const link = new Map<number, { prev: number; turnHours: number }>();
    for (const dep of deps) dep.trips.forEach((t, k) => k > 0 && link.set(indexOf.get(t)!, { prev: indexOf.get(dep.trips[k - 1])!, turnHours: dep.turnHours[k - 1] }));
    // What each departure means at base for a commuter, said on the day it happens.
    const code = departureOptions.base;
    const firstDayOf = (trip: number) => days.find((x) => x.tripIndex === trip && x.isTripStart);
    const lastDayOf = (trip: number) => days.filter((x) => x.tripIndex === trip && x.kind !== "off").at(-1);
    const nightsWord = (n: number) => `${n} night${n === 1 ? "" : "s"}`;
    const note = (day: DetailedDay | undefined, text: string) => {
      if (!day) return;
      day.baseNote = day.baseNote ? `${day.baseNote} ${text}` : text;
      day.title = `${day.title}; ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    };
    for (const dep of deps) {
      const first = indexOf.get(dep.trips[0])!;
      const last = indexOf.get(dep.trips[dep.trips.length - 1])!;
      const startDay = firstDayOf(first);
      if (dep.jumpseatIns > 0)
        note(startDay, `Shows at ${startDay?.dutyStart ?? "an early hour"} in ${code}, too early to commute in that morning — but the first duty is short, so this is a jumpseat in on the evening flight the night before, with a nap at the hub, rather than a hotel.`);
      for (const b of dep.baseNights) {
        if (b.reason === "before")
          note(startDay, `Shows at ${startDay?.dutyStart ?? "an early hour"} in ${code} — too early to commute in that morning, and the duty is long, so a night in a ${code} hotel before it.`);
        if (b.reason === "between") {
          const k = dep.trips.findIndex((t) => t.pairingNumber === b.tripNumber);
          const day = k > 0 ? firstDayOf(indexOf.get(dep.trips[k])!) : undefined;
          note(day, `${nightsWord(b.nights)} in a ${code} hotel waiting for this trip — not long enough at home to be worth the trip back.`);
        }
        if (b.reason === "after") {
          const day = lastDayOf(last);
          note(day, `Back in ${code}${day?.finish ? ` at ${day.finish.time}` : ""} — too late to get home that night, so a night in ${code}.`);
        }
      }
    }
    // Hub turns, said on the day the duty they're part of started: a night one on the evening before the sort.
    const turns = bidPeriodStart ? hubTurnsOf(line.trips, { bidPeriodStart, base: code }) : [];
    summaryHubs = turns.length ? summarizeHubTurns(turns) : null;
    for (const h of turns) {
      const zone = timezoneForAirport(h.hub) ?? "UTC";
      const local = (ms: number) => DateTime.fromMillis(ms, { zone }).toFormat("HH:mm");
      const date = h.night ? h.nightOf : DateTime.fromMillis(h.arrive, { zone }).toISODate();
      const index = date && bidPeriodStart ? Math.round(DateTime.fromISO(date).diff(DateTime.fromISO(bidPeriodStart), "days").days) : -1;
      const day = days.find((d) => d.dayIndex === index && d.kind !== "off") ?? days.find((d) => d.dayIndex === index);
      if (!day) continue;
      const sit = `${Math.floor(h.sitHours)}h${String(Math.round((h.sitHours % 1) * 60)).padStart(2, "0")}`;
      const text = `${h.night ? "Night hub turn" : "Hub turn"} at ${h.hub}: in ${local(h.arrive)}, out ${local(h.depart)} (${sit} through the sort${h.restHotel ? `, with a nap at the ${h.restHotel}` : ""}).`;
      day.hubNote = day.hubNote ? `${day.hubNote} ${text}` : text;
      day.title = `${day.title}; ${text.charAt(0).toLowerCase()}${text.slice(1, -1)}`;
    }
    // Time at home between departures, door to door, said on the day the pilot gets home.
    const stretches = homeStretches(deps, { bidPeriodStart, bidPeriodDays, base: code }, departureOptions.homeAirports);
    if (stretches) {
      const minBreak = departureOptions.minBreakNights ?? DEFAULT_MIN_BREAK_NIGHTS;
      const t = summarizeHomeTime(stretches, minBreak);
      const between = stretches.filter((x) => x.edge === null);
      summaryHome = { between: between.map((x) => ({ hours: x.hours, nights: x.nights })), nightsHome: t.nightsHome, shortGaps: t.shortGaps, minBreakNights: minBreak };
      const homes = (departureOptions.homeAirports ?? []).filter((a) => a && a !== code);
      const homeZone = timezoneForAirport(homes[0] ?? code) ?? timezoneForAirport(code) ?? "UTC";
      for (const x of between) {
        const date = DateTime.fromMillis(x.from, { zone: homeZone }).toISODate();
        const index = date && bidPeriodStart ? Math.round(DateTime.fromISO(date).diff(DateTime.fromISO(bidPeriodStart), "days").days) : -1;
        const day = days.find((d) => d.dayIndex === index);
        if (!day) continue;
        const leaves = DateTime.fromMillis(x.to, { zone: homeZone }).toFormat("ccc HH:mm");
        const short = x.nights < minBreak;
        const text = `Home for ${Math.round(x.hours)}h — ${x.nights} night${x.nights === 1 ? "" : "s"} in your own bed before leaving again ${leaves}${homes.length ? " (home time)" : ""}${short ? ", short of a real break" : ""}.`;
        day.homeNote = text;
        day.title = `${day.title}; ${text.charAt(0).toLowerCase()}${text.slice(1, -1)}`;
      }
    }
    summaryBase = departureOptions.homeAirports?.some((a) => a && a !== code)
      ? {
          code,
          commutes: deps.reduce((n, d) => n + d.baseCommutes, 0),
          nights: deps.reduce((n, d) => n + d.baseNights.reduce((a, b) => a + b.nights, 0), 0),
          jumpseatIns: deps.reduce((n, d) => n + d.jumpseatIns, 0),
        }
      : null;

    days.forEach((d) => {
      if (!d.isTripStart || d.tripIndex === null) return;
      const l = link.get(d.tripIndex);
      if (!l) return;
      const prevLast = days.filter((x) => x.tripIndex === l.prev && x.kind !== "off").at(-1);
      d.chain = {
        fromTripNumber: line.trips[l.prev]?.pairingNumber ?? null,
        city: prevLast?.finish?.city ?? d.route[0]?.city ?? departureOptions.base,
        turnMinutes: Math.max(0, Math.round(l.turnHours * 60)),
        landed: prevLast?.finish?.time ?? "",
        reports: d.dutyStart ?? "",
      };
    });
  } else days.forEach((d, i) => {
    const prev = days[i - 1];
    if (!d.isTripStart || !d.dutyStart || d.tripIndex === null || !prev?.finish || prev.tripIndex === null || prev.tripIndex === d.tripIndex) return;
    if (d.route[0]?.city !== prev.finish.city) return;
    const turn = i * 1440 + clockMinutes(d.dutyStart) - ((i - 1) * 1440 + clockMinutes(prev.finish.time) + (prev.finish.nextDay ? 1440 : 0));
    if (turn < 0 || turn > CHAIN_MAX_MINUTES) return;
    d.chain = { fromTripNumber: prev.tripNumber ?? line.trips[prev.tripIndex]?.pairingNumber ?? null, city: prev.finish.city, turnMinutes: turn, landed: prev.finish.time, reports: d.dutyStart };
  });

  const firstWeekday = calendar.days[0]?.weekday ?? null;
  const startAt = firstWeekday ? WEEKDAY_ORDER.indexOf(firstWeekday) : -1;
  const weekdayHeaders = calendar.placementIsReal && startAt >= 0 ? Array.from({ length: 7 }, (_, i) => WEEKDAY_ORDER[(startAt + i) % 7]) : null;

  return {
    days,
    clock,
    summary: local ? local.summary : summarize(
      line,
      days,
      departureCount,
      summaryBase,
      summaryHubs,
      summaryHome,
      pastMonthEnd,
      runs.map((r) => r.length),
      cityPreferences
    ),
    weekdayHeaders,
    placementIsReal: calendar.placementIsReal,
  };
}

function summarize(
  line: Line,
  days: DetailedDay[],
  departureCount: number | null,
  base: MonthSummary["base"],
  hubTurns: HubTurnSummary | null,
  home: MonthSummary["home"],
  pastMonthEnd: MonthSummary["pastMonthEnd"],
  offRuns: number[],
  cityPreferences: Record<string, CityMark>
): MonthSummary {
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
    departures: departureCount ?? line.trips.length - days.filter((d) => d.chain).length,
    base,
    hubTurns,
    home,
    pastMonthEnd,
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
