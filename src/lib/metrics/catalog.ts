import { DateTime } from "luxon";
import { computeCircadianAssessment } from "@/lib/circadian";
import { dateOfDayIndex, longestDaysOffBlock, singleDaysOff, weekendDaysOff } from "@/lib/days-off-pattern";
import { lineDutyPeriods } from "@/lib/duty-periods";
import { isHotelStandbyLeg, tripStandbyDays } from "@/lib/standby";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { backupsToWork, earliestHome, flightsForTrip, realTravelForTrip, type FlightAnswers, type TripFlights } from "@/lib/flights/trip-travel";
import { tripStartUtc } from "@/lib/flights/needs";
import { groupDepartures, type Departure } from "@/lib/metrics/departures";
import { hubTurnsOf, summarizeHubTurns, type HubTurnSummary } from "@/lib/metrics/hub-turns";
import { DEFAULT_MIN_BREAK_NIGHTS, homeStretches, summarizeHomeTime, type HomeStretch, type HomeTime } from "@/lib/metrics/home-stretches";
import { DEFAULT_HOME_PARAMS, homeAwayForTrip, type HomeAway, type TravelTimeProvider } from "@/lib/metrics/home-travel";
import { legDeepNightMinutes, nightsWorked, type LayoverFact, type LegFact, type Region, type TripFacts } from "@/lib/metrics/trip-facts";
import type { Line } from "@/types/bidpack";

/**
 * The metric library: every measurable thing about a line a pilot might
 * care about, in real units, each with a plain-English name. The interview
 * binds a pilot's priorities to these ids; the scorer evaluates them.
 *
 * Measurements can take parameters a pilot gives us — which cities, how
 * many legs is too many, how much rest he needs before deadheading home —
 * so "avoid three-leg duties" and "minimize hours in Guangzhou" are
 * measured exactly as he means them, not approximated by an average.
 *
 * Trip-level measurements roll up to the line with a stated aggregation
 * (sum, mean, max, min); line-level ones read the line directly.
 */

export type MetricCategory = "pay" | "time" | "duty" | "commute" | "layover" | "city" | "body" | "standby" | "calendar";
export type Aggregation = "sum" | "mean" | "max" | "min";

export interface MetricParams {
  /** City codes, for city-specific measurements. */
  cities?: string[];
  regions?: Region[];
  /** A count threshold, e.g. "duties with at least N operated legs". */
  n?: number;
  /** An hours window, e.g. layovers between minHours and maxHours long. */
  minHours?: number;
  maxHours?: number;
  /** Hours a pilot wants between arriving on his own flight and the first operated report — backups and rest (front-end deviation). */
  frontBufferHours?: number;
  /** Hours of rest a pilot wants after the last operated leg before heading home on his own (back-end deviation). */
  backRestHours?: number;
  /** Where the pilot lives — the airports he flies from (home first, then alternates). */
  homeAirports?: string[];
  /** Hours a commuter arrives at base ahead of a report. */
  commuteBufferHours?: number;
  /** The fewest backup flights a commuter wants on the way to work. */
  backupFlights?: number;
  /** Hours at home a commuter needs between two trips before he'd go home at all — under it, the trips are one departure. */
  minHomeHours?: number;
  /** A crash pad at base: nights there cost a commuter nothing extra. */
  hasCrashPad?: boolean;
  /** Nights at home that make a stretch a real break, for this pilot (see `metrics/home-stretches.ts`). */
  minBreakNights?: number;
  /** Calendar dates ("2026-10-10"), for date-specific measurements. */
  dates?: string[];
  /** Days of the week, 1 = Monday … 7 = Sunday. */
  weekdays?: number[];
  /** How much the pilot likes each layover city, −1 (hates it) … +1 (loves it); cities left out are neutral. */
  cityScores?: Record<string, number>;
  /** The pack's base — filled in when a line is measured, not set by the brain. */
  base?: string;
}

export interface LineContext {
  bidPeriodStart: string | null;
  bidPeriodDays: number;
  homeBaseOffsetMinutes: number | null;
  base: string;
  /** Travel times between a pilot's home and trip cities — estimated from distance. */
  travel?: TravelTimeProvider;
  /** Real airline flights looked up for this pilot's trips (see `lib/flights/`), by need id; trips not looked up are estimated. */
  flights?: FlightAnswers;
}

/**
 * Commutes, departures, trips and nights at base: below the number a pilot calls fine, half the priority still rides on
 * fewer (`MetricDef.belowFine`). Set on a free sweep (Oct 2026) of every saved reading: the ex-pilot's sort on his 32 v21
 * readings 97.03 → 97.76% (with his trip picks 97.05 → 97.51%, full order 85.5 → 86.4%), on 20 v22 readings 97.86 →
 * 98.09%; the simulated ex-pilot 0.806 → 0.820 on 28 saved readings (0.777 → 0.790 with trips); the two simulated pilots
 * who live at base unchanged; trip picks all kept. 0.6 scored the same, 0.7 lost a trip pick. Every other priority keeps
 * its flat "fine": a gentler 0.2 on all of them helped most pilots on saved readings but dipped one on its trips.
 */
const BELOW_FINE_COUNTS = 0.5;

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  category: MetricCategory;
  description: string;
  /** Which parameters it reads, so the interview knows what to ask for. */
  params?: (keyof MetricParams)[];
  /** Default parameters, used when a pilot hasn't given his own. */
  defaults?: MetricParams;
  trip?: { measure: (f: TripFacts, p: MetricParams) => number | null; aggregate: Aggregation };
  line?: (line: Line, trips: TripFacts[], ctx: LineContext, p: MetricParams) => number | null;
  /**
   * For a "less is better" priority with no worst point given, the bad end of the scale is the pack's worst line rather
   * than the 5% mark. For counts with only a few values across a month — departures run 2 to 5 — the 5% mark is a step
   * from the best, so a single extra departure would cost half the priority.
   */
  badEndAtWorst?: boolean;
  /**
   * A count that adds up over the line's trips, carry-over included — compared at the month length the pilot's numbers
   * are for, so a five-week line isn't held to a four-week line's numbers (see `metrics/line-length.ts`).
   */
  perMonth?: boolean;
  /**
   * For a "less" priority with a number that's fine ("two commutes is fine"): how much of the priority still rides on
   * going below it, 0–1. Fine isn't indifferent — a pilot who says two commutes is fine still takes the line with none
   * (two double deadheads) over the line with two. See `utilityOf`.
   */
  belowFine?: number;
}

/** Minutes of a stretch starting at `start` (minutes after local midnight) that fall between 06:00 and 22:00. */
function dayMinutes(start: number, minutes: number): number {
  let total = 0;
  for (let day = -1440; day <= 2880; day += 1440) total += Math.max(0, Math.min(start + minutes, 22 * 60 + day) - Math.max(start, 6 * 60 + day));
  return total;
}
/** A duty is an all-nighter when its flying spans at least this much of the small hours (00:00–05:00). */
const ALL_NIGHTER_MINUTES = 3 * 60;

/** Whether a duty's flying, first operated departure to last arrival, spans most of the night on the local clock. */
function isAllNighter(d: { legs: LegFact[] }): boolean {
  const flown = d.legs.filter((l) => !l.deadhead);
  const first = flown[0];
  const last = flown[flown.length - 1];
  if (!first || !last || first.depLocalMinute === null) return false;
  // The whole stretch as one leg: on the clock it departs on, and the clock it lands on.
  return legDeepNightMinutes({ ...first, end: last.end, arrLocalMinute: last.arrLocalMinute }) >= ALL_NIGHTER_MINUTES;
}
/** A layover with less local night than this is one a pilot can't really sleep on (see `daytimeLayovers`). */
const DAYTIME_LAYOVER_NIGHT_HOURS = 4;
/** Flying this much of the local small hours makes a leg (or duty) a red-eye — a leg just into or out of the night isn't. */
const RED_EYE_MINUTES = 60;
/** A trip ends on a red-eye when its last leg flies through the night and lands in this window (local). */
const RED_EYE_FINISH_LANDS = [3 * 60, 7 * 60] as const;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const flying = (trips: TripFacts[]) => trips.filter((t) => t.trip.schedule.length > 0);
const allLayovers = (trips: TripFacts[]) => trips.flatMap((t) => t.layovers);
/** Rates per day away compare whole trips to whole trips — the line's printed totals stop at the bid period's edge while a trip running into next month doesn't. */
const tripCredit = (trips: TripFacts[]) => sum(flying(trips).map((f) => f.creditHours));
const inCities = (l: LayoverFact, p: MetricParams) => !!p.cities?.includes(l.city);
/**
 * How much the pilot likes a city, −1 … +1. Their own base counts as neutral: time there isn't a layover somewhere — a
 * pilot who lives there is home, and a commuter's time at base is what the commute and base-standby measures are for.
 * Counted as a layover city, a month of hotel standby at base read as hundreds of hours "in a place you avoid".
 */
const cityScore = (city: string, p: MetricParams) => (city === p.base ? 0 : Math.max(-1, Math.min(1, p.cityScores?.[city] ?? 0)));
/** Standby days (one standby row each) at cities matching `where`. */
const standbyDaysWhere = (trips: TripFacts[], where: (city: string) => boolean) =>
  sum(trips.map((f) => f.trip.schedule.flatMap((d) => d.legs).filter((l) => isHotelStandbyLeg(l) && where(l.depAirport)).length));
/** For "how late" measures, the night runs on until 06:00: an arrival before then belongs to the evening before. */
const NIGHT_RUNS_UNTIL = 6 * 60;

/** Every night the line works, as bid-period day indexes of the morning each night ends on; null when a trip's dates or schedule are unknown. */
function nightsOfLine(trips: TripFacts[]): number[] | null {
  const nights = new Set<number>();
  for (const f of trips) {
    if (f.trip.schedule.length === 0) continue;
    if (f.trip.startDayIndex === null) return null;
    for (const k of nightsWorked(f)) nights.add(f.trip.startDayIndex + k);
  }
  return [...nights].sort((a, b) => a - b);
}

/**
 * Body-clock ratings for trips with scheduled flying. A trip that's all
 * standby has nothing scheduled to rate — and a call-out can come at any
 * hour — so it counts as unknown, not as a perfect five.
 */
function circadianStars(trips: TripFacts[], c: LineContext): number[] {
  return trips
    .filter((f) => !f.noFlying)
    .map((f) => computeCircadianAssessment(f.trip, c.homeBaseOffsetMinutes)?.stars)
    .filter((s): s is 1 | 2 | 3 | 4 | 5 => !!s);
}

/** Time away from home for each trip, or null when the pilot's home isn't known or a trip can't be placed. */
function homeAway(trips: TripFacts[], c: LineContext, p: MetricParams): HomeAway[] | null {
  if (!p.homeAirports?.length) return null;
  const params = {
    homeAirports: p.homeAirports,
    commuteBufferHours: p.commuteBufferHours ?? DEFAULT_HOME_PARAMS.commuteBufferHours,
    frontBufferHours: p.frontBufferHours ?? DEFAULT_HOME_PARAMS.frontBufferHours,
    backRestHours: p.backRestHours ?? DEFAULT_HOME_PARAMS.backRestHours,
  };
  const out = flying(trips).map((f) => homeAwayForTrip(f, c.base, params, c.travel, realTravelForTrip(c.flights, c, f.trip)));
  return out.some((a) => a === null) ? null : (out as HomeAway[]);
}

/**
 * A line's departures depend only on its trips, the pilot's home settings and the flights looked up for them, so they're
 * worked out once per line and shared — by the three departure measures, and by every re-score while choices are fitted.
 */
const departuresCache = new WeakMap<TripFacts[], { travel?: TravelTimeProvider; flights?: FlightAnswers; byKey: Map<string, Departure[]> }>();

/** The line's trips grouped into departures, with the pilot's own home and buffers (see `metrics/departures.ts`). */
function departuresOf(trips: TripFacts[], c: LineContext, p: MetricParams): Departure[] {
  let entry = departuresCache.get(trips);
  if (!entry || entry.travel !== c.travel || entry.flights !== c.flights) {
    entry = { travel: c.travel, flights: c.flights, byKey: new Map() };
    departuresCache.set(trips, entry);
  }
  const key = JSON.stringify([c.base, c.bidPeriodStart, p.homeAirports, p.commuteBufferHours, p.frontBufferHours, p.backRestHours, p.minHomeHours, p.hasCrashPad]);
  const known = entry.byKey.get(key);
  if (known) return known;
  const departures = groupDepartures(
    trips.map((f) => f.trip),
    { bidPeriodStart: c.bidPeriodStart, base: c.base },
    {
      homeAirports: p.homeAirports,
      commuteBufferHours: p.commuteBufferHours,
      frontBufferHours: p.frontBufferHours,
      backRestHours: p.backRestHours,
      minHomeHours: p.minHomeHours,
      hasCrashPad: p.hasCrashPad,
      travel: c.travel,
      flights: c.flights,
      facts: new Map(trips.map((f) => [f.trip, f])),
    }
  );
  entry.byKey.set(key, departures);
  return departures;
}

/** A line's stretches at home, worked out once per set of departures (see `metrics/home-stretches.ts`). */
const homeStretchCache = new WeakMap<Departure[], HomeStretch[] | null>();
/**
 * Time at home over the line's month, door to door: its stretches and nights at home, with a real break at the pilot's
 * own number of nights (`n` on the criterion, else their stated one, else 3). Null when the month can't be placed.
 */
function homeTimeOf(trips: TripFacts[], c: LineContext, p: MetricParams): HomeTime | null {
  const departures = departuresOf(trips, c, p);
  let stretches = homeStretchCache.get(departures);
  if (stretches === undefined) {
    stretches = homeStretches(departures, { bidPeriodStart: c.bidPeriodStart, bidPeriodDays: c.bidPeriodDays, base: c.base }, p.homeAirports);
    homeStretchCache.set(departures, stretches);
  }
  return stretches ? summarizeHomeTime(stretches, p.n ?? p.minBreakNights ?? DEFAULT_MIN_BREAK_NIGHTS) : null;
}

/** A line's hub turns (see `metrics/hub-turns.ts`), worked out once per line and shared by the hub-turn measures. */
const hubTurnCache = new WeakMap<TripFacts[], HubTurnSummary>();
function hubTurnsOfLine(trips: TripFacts[], c: LineContext): HubTurnSummary {
  const known = hubTurnCache.get(trips);
  if (known) return known;
  const s = summarizeHubTurns(hubTurnsOf(trips.map((f) => f.trip), { bidPeriodStart: c.bidPeriodStart, base: c.base }));
  hubTurnCache.set(trips, s);
  return s;
}

/**
 * Each flying trip's looked-up airline flights, or null unless every one of them was looked up — a line measured on
 * some of its trips would look better or worse than it is.
 */
function tripFlights(trips: TripFacts[], c: LineContext): { f: TripFacts; t: TripFlights }[] | null {
  if (!c.flights) return null;
  const out: { f: TripFacts; t: TripFlights }[] = [];
  for (const f of flying(trips)) {
    const t = flightsForTrip(c.flights, f.trip);
    if (!t) return null;
    out.push({ f, t });
  }
  return out;
}

/** Hours a trip can realistically be shortened by deviating — arriving later on a front-end deadhead, or heading home sooner after the last operated leg — keeping the buffer and rest the pilot wants. */
function shortenableHours(f: TripFacts, p: MetricParams): number {
  const front = f.front?.slackHours != null ? Math.max(0, f.front.slackHours - (p.frontBufferHours ?? 12)) : 0;
  const back = f.back?.slackHours != null ? Math.max(0, f.back.slackHours - (p.backRestHours ?? 10)) : 0;
  return front + back;
}

export const METRICS: MetricDef[] = [
  // ---- Pay and time away ----
  { id: "creditHours", label: "Credit hours", unit: "hours", category: "pay", description: "Total credit for the month.", line: (l) => l.totalCreditHours },
  { id: "tafbHours", label: "Time away from base", unit: "hours", category: "time", description: "Total hours away from base across the month's trips.", line: (l) => l.totalTafbHours },
  {
    id: "blockHours",
    label: "Hours flown",
    unit: "hours",
    category: "pay",
    description: "Operated block hours — actual flying, deadheads excluded.",
    trip: { measure: (f) => f.blockHours, aggregate: "sum" },
  },
  {
    id: "creditPerDayAway",
    label: "Credit per day away",
    unit: "hours/day",
    category: "pay",
    description: "Credit earned per 24 hours away from base, as scheduled, across the line's whole trips.",
    line: (_l, trips) => {
      const away = sum(flying(trips).map((f) => f.tafbHours));
      return away > 0 ? tripCredit(trips) / (away / 24) : null;
    },
  },
  {
    id: "effectiveCreditPerDayAway",
    label: "Credit per day away, after shortening",
    unit: "hours/day",
    category: "pay",
    description: "Credit per 24 hours actually away, if the pilot shortens trips by deviating on front- and back-end deadheads.",
    params: ["frontBufferHours", "backRestHours"],
    defaults: { frontBufferHours: 12, backRestHours: 10 },
    line: (_l, trips, _c, p) => {
      const away = sum(flying(trips).map((f) => f.tafbHours - shortenableHours(f, p)));
      return away > 0 ? tripCredit(trips) / (away / 24) : null;
    },
  },
  {
    id: "shortenableHours",
    label: "Hours trips can be shortened",
    unit: "hours",
    category: "time",
    description: "Hours the month's trips could be cut by arriving later on a front-end deadhead or going home sooner after the last operated leg.",
    params: ["frontBufferHours", "backRestHours"],
    defaults: { frontBufferHours: 12, backRestHours: 10 },
    trip: { measure: (f, p) => shortenableHours(f, p), aggregate: "sum" },
  },
  {
    id: "tripsShortenableByADay",
    label: "Trips that can be shortened by a day",
    unit: "trips",
    category: "time",
    description: "Trips where deviating saves at least 24 hours away from home.",
    params: ["frontBufferHours", "backRestHours"],
    defaults: { frontBufferHours: 12, backRestHours: 10 },
    trip: { measure: (f, p) => (shortenableHours(f, p) >= 24 ? 1 : 0), aggregate: "sum" },
  },

  // ---- Time away from home, for pilots who don't live at base ----
  {
    id: "homeAwayHours",
    label: "Time away from home",
    unit: "hours",
    category: "time",
    description: "Hours from leaving home to getting back home — including the commute to base, or flying straight to where a trip starts on a front-end deadhead and straight home after a back-end one.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, trips, c, p) => {
      const away = homeAway(trips, c, p);
      return away && away.reduce((s, a) => s + a.awayHours, 0);
    },
  },
  {
    id: "creditPerDayAwayFromHome",
    label: "Credit per day away from home",
    unit: "hours/day",
    category: "pay",
    description: "Credit per 24 hours away from home, commute included — the number a commuter actually lives.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, trips, c, p) => {
      const away = homeAway(trips, c, p);
      const total = away?.reduce((s, a) => s + a.awayHours, 0) ?? 0;
      return away && total > 0 ? tripCredit(trips) / (total / 24) : null;
    },
  },
  {
    id: "tripsJoinedFromHome",
    label: "Trips that start with a deadhead from home",
    unit: "trips",
    category: "commute",
    description: "Trips that start with a deadhead the pilot can catch from home (a front-end deadhead from home) rather than commuting to base.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, trips, c, p) => homeAway(trips, c, p)?.filter((a) => a.start === "deviate").length ?? null,
  },
  {
    id: "tripsEndingStraightHome",
    label: "Trips you can deviate home from",
    unit: "trips",
    category: "commute",
    description: "Trips the pilot can deviate home from: heading home after the last operated leg beats riding back to base and commuting.",
    params: ["homeAirports", "backRestHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, trips, c, p) => homeAway(trips, c, p)?.filter((a) => a.end === "deviate").length ?? null,
  },

  // ---- Real airline flights, for commuters (only for lines whose trips were looked up) ----
  {
    id: "fewestBackupFlights",
    label: "Fewest backup flights to a trip",
    unit: "flights",
    category: "commute",
    description:
      "Across the month's trips, the fewest real airline flights beyond the one you'd plan on that still get you to work in time — to base, or straight to where a trip's flying starts — from published schedules, with your buffers. Unknown for lines whose flights haven't been looked up.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours"],
    line: (_l, trips, c) => {
      const ts = tripFlights(trips, c);
      const backups = ts?.map(({ t }) => backupsToWork(t)).filter((b): b is number => b !== null);
      return backups?.length ? Math.min(...backups) : null;
    },
  },
  {
    id: "tripsShortOnBackups",
    label: "Trips short on backup flights",
    unit: "trips",
    category: "commute",
    description: "Trips where fewer real airline flights than the backups you want (n; your stated minimum by default, else 2) still get you to work in time. Unknown for lines whose flights haven't been looked up.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "n"],
    line: (_l, trips, c, p) => {
      const ts = tripFlights(trips, c);
      const want = p.n ?? p.backupFlights ?? 2;
      return ts ? ts.filter(({ t }) => (backupsToWork(t) ?? Infinity) < want).length : null;
    },
  },
  {
    id: "longestTripHome",
    label: "Longest wait to get home",
    unit: "hours",
    category: "commute",
    description:
      "The most hours, across the month's trips, from the end of the work (the last operated flight or standby) until the first real airline flight lands you home — from base, or straight from where the flying ends. Unknown for lines whose flights haven't been looked up.",
    params: ["homeAirports", "backRestHours"],
    line: (_l, trips, c) => {
      const ts = tripFlights(trips, c);
      if (!ts) return null;
      const hours = ts.flatMap(({ f, t }) => {
        const home = earliestHome(t);
        const start = tripStartUtc(c, f.trip);
        // Done once the last operated flight or standby is over — a deadhead back to base is part of the trip home.
        const ends = [[...f.legs].reverse().find((l) => !l.deadhead)?.end, f.duties.flatMap((d) => d.standbyLegs).at(-1)?.end].filter((x): x is number => x !== undefined);
        return home === null || start === null || !ends.length ? [] : [(home - (start + Math.max(...ends) * 60_000)) / 3_600_000];
      });
      return hours.length ? Math.max(0, ...hours) : null;
    },
  },

  // ---- Calendar ----
  { id: "daysOff", label: "Days off", unit: "days", category: "calendar", description: "Days off in the bid period.", line: (l) => l.daysOff },
  { id: "longestDaysOffBlock", label: "Longest stretch of days off", unit: "days", category: "calendar", description: "The longest run of consecutive days off.", line: (l) => longestDaysOffBlock(l) },
  {
    id: "singleDaysOff",
    label: "Single days off",
    unit: "days",
    category: "calendar",
    description: "Days off standing alone between two working days — scattered singles instead of real blocks ('a single day off between trips is useless'). Days off in runs of two or more don't count.",
    line: (l, _t, c) => singleDaysOff(l, c.bidPeriodDays),
  },
  {
    id: "requestedDatesWorked",
    label: "Wanted dates not off",
    unit: "days",
    category: "calendar",
    description: "How many of the pilot's must-have dates off this line works (0 = every one of them off). Read from the line's own printed calendar.",
    params: ["dates"],
    line: (line, _t, ctx, p) => {
      if (line.estimated || !line.gridOffDays || !ctx.bidPeriodStart || !p.dates?.length) return null;
      const off = new Set(line.gridOffDays.map((i) => dateOfDayIndex(ctx.bidPeriodStart!, i)));
      const last = dateOfDayIndex(ctx.bidPeriodStart, ctx.bidPeriodDays - 1);
      return p.dates.filter((d) => d >= ctx.bidPeriodStart! && d <= last && !off.has(d)).length;
    },
  },
  {
    id: "weekdaysOff",
    label: "Chosen weekdays off",
    unit: "days",
    category: "calendar",
    description: "Days off that fall on the pilot's chosen days of the week (e.g. Wednesdays and Sundays) — for a standing weekly commitment.",
    params: ["weekdays"],
    line: (line, _t, ctx, p) => {
      if (line.estimated || !line.gridOffDays || !ctx.bidPeriodStart || !p.weekdays?.length) return null;
      const start = DateTime.fromISO(ctx.bidPeriodStart, { zone: "utc" });
      return [...new Set(line.gridOffDays)].filter((i) => p.weekdays!.includes(start.plus({ days: i }).weekday)).length;
    },
  },
  { id: "weekendDaysOff", label: "Weekend days off", unit: "days", category: "calendar", description: "Saturdays and Sundays off.", line: (l, _t, c) => weekendDaysOff(l, c.bidPeriodStart) },
  { id: "tripCount", label: "Trips", unit: "trips", category: "calendar", description: "Number of trips in the month. For a pilot who lives at base; a commuter's are counted in homeDepartures.", perMonth: true, belowFine: BELOW_FINE_COUNTS, line: (l) => l.trips.length },
  {
    id: "homeDepartures",
    label: "Departures",
    unit: "departures",
    category: "calendar",
    description:
      "How many times the pilot leaves home to fly — trips flown without going home in between count once (a \"series of trips\" or \"trip sequence\"). For a commuter, two trips are one departure unless there would be at least minHomeHours (default 24) at home between them, counted door to door: deadheading home from where one trip's flying ends, or commuting home from base, then back out for the next. For a pilot who lives at base, only trips that turn within a few hours at base are joined.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours"],
    badEndAtWorst: true,
    perMonth: true,
    line: (_l, trips, c, p) => departuresOf(trips, c, p).length,
    belowFine: BELOW_FINE_COUNTS,
  },
  {
    id: "shortHomeGaps",
    label: "Short stretches at home",
    unit: "gaps",
    category: "calendar",
    description:
      "Stretches at home between two departures too short to feel like a real break — fewer than n nights in the pilot's own bed (default 3, or the number they gave). Counted door to door: a day off spent commuting home, or getting in at dawn, isn't time at home. A month chopped into many short stays at home feels like no time off at all, whatever its days off say.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours", "n"],
    badEndAtWorst: true,
    line: (_l, trips, c, p) => homeTimeOf(trips, c, p)?.shortGaps ?? null,
  },
  {
    id: "realBreakNights",
    label: "Nights at home in real breaks",
    unit: "nights",
    category: "calendar",
    description:
      "Nights in the pilot's own bed during stretches at home long enough to be a real break (n nights or more, default 3), door to door. For a commuter, the honest measure of real time off — calendar days off count commute days as home.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours", "n"],
    line: (_l, trips, c, p) => homeTimeOf(trips, c, p)?.breakNights ?? null,
  },
  {
    id: "nightsHome",
    label: "Nights in your own bed",
    unit: "nights",
    category: "calendar",
    description: "Nights spent at home in the bid period, door to door — every night not away on a trip, commuting, or at base.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours"],
    line: (_l, trips, c, p) => homeTimeOf(trips, c, p)?.nightsHome ?? null,
  },
  {
    id: "longestHomeStretch",
    label: "Longest stretch at home",
    unit: "nights",
    category: "calendar",
    description: "The longest stretch at home in the month, in nights in the pilot's own bed, door to door — the commuter's version of the longest run of days off.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours"],
    line: (_l, trips, c, p) => homeTimeOf(trips, c, p)?.longestNights ?? null,
  },
  {
    id: "departureCommutes",
    label: "Commutes to or from base",
    unit: "commutes",
    category: "commute",
    description:
      "Commutes to or from base the month really takes, counted per departure (trips flown without going home count once): 0–2 each, none at an end that starts or finishes on a deadhead the pilot can catch from home or ride home on. A pilot who lives at base has none.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours"],
    badEndAtWorst: true,
    line: (_l, trips, c, p) => departuresOf(trips, c, p).reduce((s, d) => s + d.baseCommutes, 0),
    belowFine: BELOW_FINE_COUNTS,
  },
  {
    id: "baseHotelNights",
    label: "Nights at base",
    unit: "nights",
    category: "commute",
    description:
      "Nights a commuter without a crash pad spends at base: the night before a report too early to commute in that morning (unless the first duty is short enough to jumpseat in the evening before and nap at the hub), nights waiting at base between trips of one departure, and the night after a release too late to get home.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours", "hasCrashPad"],
    badEndAtWorst: true,
    line: (_l, trips, c, p) => departuresOf(trips, c, p).reduce((s, d) => s + d.baseNights.reduce((a, b) => a + b.nights, 0), 0),
    belowFine: BELOW_FINE_COUNTS,
  },
  { id: "avgTripDays", label: "Average trip length", unit: "days", category: "calendar", description: "Average trip length in days.", trip: { measure: (f) => f.trip.days, aggregate: "mean" } },
  { id: "longestTripDays", label: "Longest trip", unit: "days", category: "calendar", description: "Length of the longest trip.", trip: { measure: (f) => f.trip.days, aggregate: "max" } },

  // ---- Duty structure ----
  { id: "dutyPeriods", label: "Duty periods", unit: "duties", category: "duty", description: "Report-to-release stretches in the month.", line: (l) => lineDutyPeriods(l) },
  { id: "landings", label: "Landings", unit: "landings", category: "duty", description: "Operated landings in the month.", line: (l) => l.totalLandings },
  {
    id: "dutiesWithManyLegs",
    label: "Duties with many legs",
    unit: "duties",
    category: "duty",
    description: "Duty periods with at least N operated legs (default 3).",
    params: ["n"],
    defaults: { n: 3 },
    trip: { measure: (f, p) => f.duties.filter((d) => d.operatedLegs >= (p.n ?? 3)).length, aggregate: "sum" },
  },
  {
    id: "extraLegs",
    label: "Extra legs in multi-leg duties",
    unit: "legs",
    category: "duty",
    description: "Every operated leg beyond the first in a duty period, summed over the month — a two-leg duty counts 1, a three-leg duty 2. For pilots who feel a two-leg duty is nearly twice the work of a one-leg duty, whatever the block time.",
    trip: { measure: (f) => f.duties.reduce((a, d) => a + Math.max(0, d.operatedLegs - 1), 0), aggregate: "sum" },
  },
  {
    id: "maxLegsInADuty",
    label: "Most legs in one duty",
    unit: "legs",
    category: "duty",
    description: "The most operated legs in any single duty period.",
    trip: { measure: (f) => Math.max(0, ...f.duties.map((d) => d.operatedLegs)), aggregate: "max" },
  },
  {
    id: "singleLegDutyShare",
    label: "Single-leg duties",
    unit: "share",
    category: "duty",
    description: "Share of flying duties with just one operated leg.",
    line: (_l, trips) => {
      const flyingDuties = trips.flatMap((t) => t.duties).filter((d) => d.operatedLegs > 0);
      return flyingDuties.length ? flyingDuties.filter((d) => d.operatedLegs === 1).length / flyingDuties.length : null;
    },
  },
  {
    id: "avgLegsPerDuty",
    label: "Legs per duty",
    unit: "legs",
    category: "duty",
    description: "Average operated legs per flying duty.",
    line: (_l, trips) => mean(trips.flatMap((t) => t.duties).filter((d) => d.operatedLegs > 0).map((d) => d.operatedLegs)),
  },
  {
    id: "longDuties",
    label: "Long duty days",
    unit: "duties",
    category: "duty",
    description: "Duty periods longer than N hours, report to last block-in (default 12).",
    params: ["minHours"],
    defaults: { minHours: 12 },
    trip: { measure: (f, p) => f.duties.filter((d) => d.legs.length > 0 && (d.end - d.start) / 60 > (p.minHours ?? 12)).length, aggregate: "sum" },
  },
  {
    id: "maxDutyHours",
    label: "Longest duty day",
    unit: "hours",
    category: "duty",
    description: "The longest duty period, report to last block-in.",
    trip: { measure: (f) => Math.max(0, ...f.duties.filter((d) => d.legs.length).map((d) => (d.end - d.start) / 60)), aggregate: "max" },
  },

  // ---- Commute and deadheads ----
  {
    id: "frontDeadheadTrips",
    label: "Trips that start with a deadhead",
    unit: "trips",
    category: "commute",
    description: "Trips whose first leg is a deadhead — a commuter can often fly straight from home to where the flying starts, skipping the base.",
    trip: { measure: (f) => (f.front ? 1 : 0), aggregate: "sum" },
  },
  {
    id: "backDeadheadTrips",
    label: "Trips that end with a deadhead",
    unit: "trips",
    category: "commute",
    description: "Trips whose last leg is a deadhead — a commuter can often head straight home from where the flying ends.",
    trip: { measure: (f) => (f.back ? 1 : 0), aggregate: "sum" },
  },
  {
    id: "doubleDeadheadTrips",
    label: "Double-deadhead trips",
    unit: "trips",
    category: "commute",
    description: "Trips that start and end with a deadhead — no commute to or from base at either end.",
    trip: { measure: (f) => (f.front && f.back ? 1 : 0), aggregate: "sum" },
  },
  {
    id: "baseCommutesNeeded",
    label: "Commutes to or from base, trip by trip",
    unit: "commutes",
    category: "commute",
    description: "Trip ends where the pilot must be at base for operated flying, counted trip by trip — even between trips flown back to back without going home. A commuter's real commutes are departureCommutes.",
    trip: { measure: (f) => (f.noFlying ? 2 : (f.front ? 0 : 1) + (f.back ? 0 : 1)), aggregate: "sum" },
    belowFine: BELOW_FINE_COUNTS,
  },
  {
    id: "midTripDeadheads",
    label: "Mid-trip deadheads",
    unit: "legs",
    category: "commute",
    description: "Deadhead legs in the middle of a trip — riding, not commuting.",
    trip: {
      measure: (f) => f.legs.filter((l) => l.deadhead).length - (f.front?.legs.length ?? 0) - (f.back?.legs.length ?? 0),
      aggregate: "sum",
    },
  },
  {
    id: "frontSlackHours",
    label: "Time between the front-end deadhead and the flying",
    unit: "hours",
    category: "commute",
    description: "Average hours between a front-end deadhead's arrival and the first operated departure — room to arrive later or have backup flights.",
    trip: { measure: (f) => f.front?.slackHours ?? null, aggregate: "mean" },
  },
  {
    id: "backSlackHours",
    label: "Time between the last flight and the deadhead home",
    unit: "hours",
    category: "commute",
    description: "Average hours between the last operated arrival and the back-end deadhead — room to head home sooner.",
    trip: { measure: (f) => f.back?.slackHours ?? null, aggregate: "mean" },
  },
  {
    id: "earliestBaseReport",
    label: "Earliest report at base",
    unit: "minute of day",
    category: "commute",
    description: "Earliest local report time at base on a trip that starts with operated flying (a commuter must be there in time).",
    line: (_l, trips) => {
      const reports = trips.filter((t) => !t.front && !t.noFlying).map((t) => t.duties[0]?.reportLocalMinute).filter((m): m is number => m !== null && m !== undefined);
      return reports.length ? Math.min(...reports) : null;
    },
  },
  {
    id: "latestBaseRelease",
    label: "Latest arrival back at base",
    unit: "minute of day",
    category: "commute",
    description:
      "Latest local block-in at base on a trip that ends with operated flying (a commuter then needs a flight home). The night runs on past midnight: an arrival before 06:00 counts as later than the evening before it (05:19 is measured as 29:19, i.e. 1759 minutes).",
    line: (_l, trips) => {
      const arrivals = trips
        .filter((t) => !t.back && !t.noFlying)
        .map((t) => t.operatedLegs[t.operatedLegs.length - 1]?.arrLocalMinute)
        .filter((m): m is number => m !== null && m !== undefined)
        // A 05:19 block-in is the end of a long night, not an early release.
        .map((m) => (m < NIGHT_RUNS_UNTIL ? m + 1440 : m));
      return arrivals.length ? Math.max(...arrivals) : null;
    },
  },

  // ---- Layovers ----
  { id: "layoverCount", label: "Layovers", unit: "layovers", category: "layover", description: "Layovers in the month.", trip: { measure: (f) => f.layovers.length, aggregate: "sum" } },
  {
    id: "avgLayoverHours",
    label: "Average layover",
    unit: "hours",
    category: "layover",
    description: "Average layover length.",
    line: (_l, trips) => mean(allLayovers(trips).map((l) => l.hours)),
  },
  {
    id: "layoversInRange",
    label: "Layovers in a length range",
    unit: "layovers",
    category: "layover",
    description: "Layovers between minHours and maxHours long (default 30–48h).",
    params: ["minHours", "maxHours"],
    defaults: { minHours: 30, maxHours: 48 },
    trip: { measure: (f, p) => f.layovers.filter((l) => l.hours >= (p.minHours ?? 30) && l.hours <= (p.maxHours ?? 48)).length, aggregate: "sum" },
  },
  {
    id: "shortLayovers",
    label: "Short layovers",
    unit: "layovers",
    category: "layover",
    description: "Layovers shorter than maxHours (default 24h).",
    params: ["maxHours"],
    defaults: { maxHours: 24 },
    trip: { measure: (f, p) => f.layovers.filter((l) => l.hours < (p.maxHours ?? 24)).length, aggregate: "sum" },
  },
  {
    id: "sleepableLayovers",
    label: "Layovers you can sleep on",
    unit: "layovers",
    category: "layover",
    description: "Layovers that include at least 6.5 hours of local night (22:00–07:00).",
    trip: { measure: (f) => f.layovers.filter((l) => (l.localNightHours ?? 0) >= 6.5).length, aggregate: "sum" },
  },
  {
    id: "daytimeLayovers",
    label: "Layovers with no real night",
    unit: "layovers",
    category: "layover",
    description:
      "Layovers with under 4 hours of local night (22:00–07:00) — the 'arrive at 6 am, leave at 8 pm' layover a pilot can't really sleep on, however long it is.",
    trip: { measure: (f) => f.layovers.filter((l) => (l.localNightHours ?? 0) < DAYTIME_LAYOVER_NIGHT_HOURS).length, aggregate: "sum" },
  },
  {
    id: "avgLayoverNightHours",
    label: "Night hours per layover",
    unit: "hours",
    category: "layover",
    description: "Average hours of local night (22:00–07:00) per layover — how sleepable layovers are.",
    line: (_l, trips) => mean(allLayovers(trips).map((l) => l.localNightHours).filter((h): h is number => h !== null)),
  },
  {
    id: "internationalLayoverShare",
    label: "International layovers",
    unit: "share",
    category: "layover",
    description: "Share of layovers outside the US.",
    line: (_l, trips) => {
      const ls = allLayovers(trips);
      return ls.length ? ls.filter((l) => l.international).length / ls.length : null;
    },
  },

  // ---- Cities and regions ----
  {
    id: "layoverHoursInCities",
    label: "Hours on layover in chosen cities",
    unit: "hours",
    category: "city",
    description: "Total layover hours in the given cities.",
    params: ["cities"],
    trip: { measure: (f, p) => sum(f.layovers.filter((l) => inCities(l, p)).map((l) => l.hours)), aggregate: "sum" },
  },
  {
    id: "layoversInCities",
    label: "Layovers in chosen cities",
    unit: "layovers",
    category: "city",
    description: "Number of layovers in the given cities.",
    params: ["cities"],
    trip: { measure: (f, p) => f.layovers.filter((l) => inCities(l, p)).length, aggregate: "sum" },
  },
  {
    id: "layoverValue",
    label: "Time in cities you like",
    unit: "weighted hours",
    category: "city",
    description: "Layover hours weighted by how much the pilot likes each city (−1 … +1): a 48-hour Sydney layover the pilot loves counts +48, 36 hours in a city they avoid counts −36, a city they're neutral on counts 0. Location and length together, in one number.",
    params: ["cityScores"],
    trip: { measure: (f, p) => f.layovers.reduce((a, l) => a + cityScore(l.city, p) * l.hours, 0), aggregate: "sum" },
  },
  {
    id: "longLayoverHours",
    label: "Long-layover time",
    unit: "hours",
    category: "layover",
    description: "Hours of layover beyond minHours (default 24), summed over every layover — rewards having some long layovers, with no ceiling: an 84-hour layover counts 60.",
    params: ["minHours"],
    defaults: { minHours: 24 },
    trip: { measure: (f, p) => f.layovers.reduce((a, l) => a + Math.max(0, l.hours - (p.minHours ?? 24)), 0), aggregate: "sum" },
  },
  {
    id: "tripsTouchingCities",
    label: "Trips through chosen cities",
    unit: "trips",
    category: "city",
    description: "Trips that land in any of the given cities, layover or not.",
    params: ["cities"],
    trip: { measure: (f, p) => (f.legs.some((l) => p.cities?.includes(l.to)) ? 1 : 0), aggregate: "sum" },
  },
  {
    id: "layoverShareInRegions",
    label: "Layovers in chosen regions",
    unit: "share",
    category: "city",
    description: "Share of layovers in the given regions (domestic, alaska, hawaii, asia, oceania, europe…).",
    params: ["regions"],
    line: (_l, trips, _c, p) => {
      const ls = allLayovers(trips);
      return ls.length ? ls.filter((l) => p.regions?.includes(l.region)).length / ls.length : null;
    },
  },

  // ---- Body clock ----
  {
    id: "worstCircadianStars",
    label: "Hardest trip on the body clock",
    unit: "stars (1–5, 5 easiest)",
    category: "body",
    description: "Circadian rating of the line's hardest trip.",
    line: (_l, trips, c) => {
      const stars = circadianStars(trips, c);
      return stars.length ? Math.min(...stars) : null;
    },
  },
  {
    id: "avgCircadianStars",
    label: "Body-clock rating",
    unit: "stars (1–5, 5 easiest)",
    category: "body",
    description: "Average circadian rating across the line's trips.",
    line: (_l, trips, c) => mean(circadianStars(trips, c)),
  },
  {
    id: "redEyeLegs",
    label: "Red-eye legs",
    unit: "legs",
    category: "body",
    description: "Operated legs flying through the night: at least an hour of the local small hours (00:00–05:00) — a leg in just after midnight, or out just before five, isn't one.",
    trip: { measure: (f) => f.operatedLegs.filter((l) => legDeepNightMinutes(l) >= RED_EYE_MINUTES).length, aggregate: "sum" },
  },
  {
    id: "nightsWorked",
    label: "Nights worked",
    unit: "nights",
    category: "body",
    description: "Nights with at least half an hour of the small hours (00:00–05:00, on the home-base clock or the local one) spent on operated flying or hotel standby — standby through the night keeps a pilot on a night schedule as surely as flying does.",
    line: (_l, trips) => nightsOfLine(trips)?.length ?? null,
  },
  {
    id: "nightHubTurnRuns",
    label: "Weeks of night hub turns",
    unit: "hub turns",
    category: "body",
    description:
      "Night hub turns that come three or more nights in a row — a week of flying into a sort hub in the evening, sitting through the sort and flying back out before dawn. The back-of-the-clock work pilots call onerous, where one now and then is fine. For a pilot who talks about hub turning, use this rather than the general night measures.",
    badEndAtWorst: true,
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).inWeeks,
  },
  {
    id: "longestHubTurnRun",
    label: "Most night hub turns in a row",
    unit: "nights",
    category: "body",
    description: "The longest run of consecutive nights with a night hub turn — for a pilot who gives a limit ('two nights of hub turning in a row is fine').",
    badEndAtWorst: true,
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).longestRun,
  },
  {
    id: "nightHubTurns",
    label: "Night hub turns",
    unit: "hub turns",
    category: "body",
    description: "Every hub turn whose sit at the sort hub runs through the small hours (00:00–05:00 local), however they fall.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).night,
  },
  {
    id: "restHotelHubTurns",
    label: "Hub turns with a crew-rest hotel",
    unit: "hub turns",
    category: "duty",
    description:
      "Hub turns with a sit long enough (about 4 hours or more) that the crew gets a short airport hotel for a nap before the outbound leg. Some pilots like the nap; others find the leg after it feels like a whole extra duty period and would rather have a shorter sit. Direction as they say.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).withRestHotel,
  },
  {
    id: "dayHubTurns",
    label: "Day hub turns",
    unit: "hub turns",
    category: "duty",
    description: "Hub turns by day: flying into a sort hub (base included) and sitting several hours on the ground before flying back out, without a night at a hotel.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).day,
  },
  {
    id: "hubTurns",
    label: "Hub turns",
    unit: "hub turns",
    category: "duty",
    description: "Every hub turn: a leg into a sort hub (MEM, IND, OAK, EWR, AFW, GSO, ANC, CDG, CAN), a sit through the sort, then a leg back out. Only for a pilot who minds hub turns as such — most mind the night weeks, not the occasional one.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).all,
  },
  {
    id: "longestNightStreak",
    label: "Most nights in a row worked",
    unit: "nights",
    category: "body",
    description: "The longest run of consecutive nights worked across the month, across trips — 'two all-nighters in a row is my limit'.",
    line: (_l, trips) => {
      const nights = nightsOfLine(trips);
      if (!nights) return null;
      let best = 0;
      let run = 0;
      nights.forEach((n, i) => {
        run = i > 0 && n === nights[i - 1] + 1 ? run + 1 : 1;
        best = Math.max(best, run);
      });
      return best;
    },
  },
  {
    id: "deepNightHours",
    label: "Hours worked in the small hours",
    unit: "hours",
    category: "body",
    description: "Total hours of operated flying and on-call standby between 00:00 and 05:00 local across the month.",
    trip: { measure: (f) => f.duties.reduce((a, d) => a + d.deepNightMinutes, 0) / 60, aggregate: "sum" },
  },
  {
    id: "dayFlyingShare",
    label: "Share of flying in the daytime",
    unit: "share",
    category: "body",
    description: "Share of operated flying between 06:00 and 22:00 local — how much of a line is a day schedule (day turns, afternoon sorts) rather than night flying.",
    line: (_l, trips) => {
      let day = 0;
      let all = 0;
      for (const f of trips)
        for (const leg of f.operatedLegs) {
          if (leg.depLocalMinute === null) continue;
          const minutes = Math.max(0, leg.end - leg.start);
          all += minutes;
          day += dayMinutes(leg.depLocalMinute, minutes);
        }
      return all ? day / all : null;
    },
  },
  {
    id: "redEyeFinishes",
    label: "Trips that end on a red-eye",
    unit: "trips",
    category: "body",
    description:
      "Trips whose last operated leg flies through the night and lands at dawn (03:00–07:00 local, after at least an hour of the small hours) — finishing a trip on an all-nighter ('the 5 am red-eye into base'). A late leg that's in by 01:30 doesn't count.",
    trip: {
      measure: (f) => {
        const last = f.operatedLegs[f.operatedLegs.length - 1];
        if (!last || last.arrLocalMinute === null) return 0;
        return last.arrLocalMinute >= RED_EYE_FINISH_LANDS[0] && last.arrLocalMinute <= RED_EYE_FINISH_LANDS[1] && legDeepNightMinutes(last) >= RED_EYE_MINUTES ? 1 : 0;
      },
      aggregate: "sum",
    },
  },
  {
    id: "allNighterStreak",
    label: "Most all-nighters in a row",
    unit: "duties",
    category: "body",
    description:
      "The longest run of consecutive all-nighter duties on a trip — duties whose flying spans at least 3 of the 5 small hours (00:00–05:00 local). 'Two all-nighters in a row is my limit.' Early launches and late arrivals don't count.",
    trip: {
      measure: (f) => {
        let best = 0;
        let run = 0;
        for (const d of f.duties.filter((x) => x.operatedLegs > 0)) {
          run = isAllNighter(d) ? run + 1 : 0;
          best = Math.max(best, run);
        }
        return best;
      },
      aggregate: "max",
    },
  },
  {
    id: "backToBackRedEyes",
    label: "Back-to-back red-eye duties",
    unit: "duties",
    category: "body",
    description:
      "Consecutive all-nighter duties: duties whose flying runs, first departure to last arrival, across at least 3 of the 5 small hours (00:00–05:00 local) — back-to-back all-nighters. A late leg in at 01:30, or an early launch at 04:15, isn't one.",
    trip: {
      measure: (f) => {
        const allNighter = f.duties.filter((d) => d.operatedLegs > 0).map(isAllNighter);
        return allNighter.slice(1).filter((r, i) => r && allNighter[i]).length;
      },
      aggregate: "sum",
    },
  },
  {
    id: "timezoneHoursCrossed",
    label: "Time zones crossed",
    unit: "hours",
    category: "body",
    description: "Total time-zone distance crossed across every leg.",
    trip: {
      measure: (f) => {
        const m = computeTripAnalytics(f.trip).totalTimezoneCrossingMinutes;
        return m === null ? null : m / 60;
      },
      aggregate: "sum",
    },
  },
  {
    id: "earlyReports",
    label: "Early reports",
    unit: "duties",
    category: "body",
    description: "Duties reporting between 02:00 and 06:00 local.",
    trip: { measure: (f) => f.duties.filter((d) => d.reportLocalMinute !== null && d.reportLocalMinute >= 120 && d.reportLocalMinute < 360).length, aggregate: "sum" },
  },

  // ---- Standby ----
  {
    id: "hotelStandbyDays",
    label: "Hotel standby days",
    unit: "days",
    category: "standby",
    description: "All hotel standby days, at base or on a trip — on call, paid, not flying.",
    trip: { measure: (f) => tripStandbyDays(f.trip), aggregate: "sum" },
  },
  {
    id: "tripStandbyDays",
    label: "Standby days on trips",
    unit: "days",
    category: "standby",
    description: "Hotel standby days at a layover city away from base, in the middle of a trip — on call instead of flying, without sitting at base.",
    line: (_l, trips, ctx) => standbyDaysWhere(trips, (city) => city !== ctx.base),
  },
  {
    id: "standbyDaysByCity",
    label: "Standby days, valued by where they are",
    unit: "days",
    category: "standby",
    description: "Hotel standby days, each worth 1 + the pilot's score for that city (−1 … +1): a standby day in a city they love counts 2, a neutral city 1, a city they avoid 0.",
    params: ["cityScores"],
    line: (_l, trips, _ctx, p) => sum(trips.map((f) => f.trip.schedule.flatMap((d) => d.legs).filter((l) => isHotelStandbyLeg(l)).reduce((a, l) => a + Math.max(0, 1 + cityScore(l.depAirport, p)), 0))),
  },
  {
    id: "baseStandbyDays",
    label: "Standby days at base",
    unit: "days",
    category: "standby",
    description: "Hotel standby days at the base itself — a commuter spends them in the base city, away from home.",
    line: (_l, trips, ctx) => standbyDaysWhere(trips, (city) => city === ctx.base),
  },
];

export const METRICS_BY_ID = new Map(METRICS.map((m) => [m.id, m]));
