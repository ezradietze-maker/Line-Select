import { DateTime } from "luxon";
import { computeCircadianAssessment } from "@/lib/circadian";
import { dateOfDayIndex, longestDaysOffBlock, weekendDaysOff } from "@/lib/days-off-pattern";
import { lineDutyPeriods } from "@/lib/duty-periods";
import { isHotelStandbyLeg, tripStandbyDays } from "@/lib/standby";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { backupsToWork, earliestHome, flightsForTrip, realTravelForTrip, type FlightAnswers, type TripFlights } from "@/lib/flights/trip-travel";
import { tripStartUtc } from "@/lib/flights/needs";
import { DEFAULT_HOME_PARAMS, homeAwayForTrip, type HomeAway, type TravelTimeProvider } from "@/lib/metrics/home-travel";
import { legDeepNightMinutes, nightsWorked, type LayoverFact, type Region, type TripFacts } from "@/lib/metrics/trip-facts";
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
  /** Calendar dates ("2026-10-10"), for date-specific measurements. */
  dates?: string[];
  /** Days of the week, 1 = Monday … 7 = Sunday. */
  weekdays?: number[];
  /** How much the pilot likes each layover city, −1 (hates it) … +1 (loves it); cities left out are neutral. */
  cityScores?: Record<string, number>;
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
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const flying = (trips: TripFacts[]) => trips.filter((t) => t.trip.schedule.length > 0);
const allLayovers = (trips: TripFacts[]) => trips.flatMap((t) => t.layovers);
/** Rates per day away compare whole trips to whole trips — the line's printed totals stop at the bid period's edge while a trip running into next month doesn't. */
const tripCredit = (trips: TripFacts[]) => sum(flying(trips).map((f) => f.creditHours));
const inCities = (l: LayoverFact, p: MetricParams) => !!p.cities?.includes(l.city);
const cityScore = (city: string, p: MetricParams) => Math.max(-1, Math.min(1, p.cityScores?.[city] ?? 0));
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
    label: "Trips joined straight from home",
    unit: "trips",
    category: "commute",
    description: "Trips where flying from home to where the trip starts beats commuting to base.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, trips, c, p) => homeAway(trips, c, p)?.filter((a) => a.start === "deviate").length ?? null,
  },
  {
    id: "tripsEndingStraightHome",
    label: "Trips you can leave straight for home",
    unit: "trips",
    category: "commute",
    description: "Trips where heading home after the last operated leg beats riding back to base and commuting.",
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
  { id: "tripCount", label: "Trips", unit: "trips", category: "calendar", description: "Number of trips in the month.", line: (l) => l.trips.length },
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
    label: "Commutes to or from base",
    unit: "commutes",
    category: "commute",
    description: "Trip ends where the pilot must be at base for operated flying — each one is a commute for someone who lives elsewhere.",
    trip: { measure: (f) => (f.noFlying ? 2 : (f.front ? 0 : 1) + (f.back ? 0 : 1)), aggregate: "sum" },
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
    label: "Time between front deadhead and flying",
    unit: "hours",
    category: "commute",
    description: "Average hours between a front-end deadhead's arrival and the first operated departure — room to arrive later or have backup flights.",
    trip: { measure: (f) => f.front?.slackHours ?? null, aggregate: "mean" },
  },
  {
    id: "backSlackHours",
    label: "Time between last flight and deadhead home",
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
    label: "Layover time where you like to be",
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
    description: "Operated legs flying any part of the local small hours (00:00–05:00) — including one that takes off before midnight and lands after 05:00.",
    trip: { measure: (f) => f.operatedLegs.filter((l) => legDeepNightMinutes(l) > 0).length, aggregate: "sum" },
  },
  {
    id: "nightsWorked",
    label: "Nights worked",
    unit: "nights",
    category: "body",
    description: "Nights with at least half an hour of the small hours (00:00–05:00 on the home-base clock) spent on operated flying or hotel standby — standby through the night keeps a pilot on a night schedule as surely as flying does.",
    line: (_l, trips) => nightsOfLine(trips)?.length ?? null,
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
    id: "backToBackRedEyes",
    label: "Back-to-back red-eye duties",
    unit: "duties",
    category: "body",
    description: "Consecutive duties that each include a red-eye.",
    trip: { measure: (f) => computeTripAnalytics(f.trip).backToBackRedEyeDuties, aggregate: "sum" },
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
