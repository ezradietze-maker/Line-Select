import { DateTime } from "luxon";
import { bidMonthEnd, uncutTrip } from "@/lib/bid-month";
import { lineBodyClockScore, tripBodyClockScore } from "@/lib/body-clock-score";
import { dateOfDayIndex, longestDaysOffBlock, singleDaysOff, weekendDaysOff } from "@/lib/days-off-pattern";
import { lineDutyPeriods } from "@/lib/duty-periods";
import { hotelInPlaces, hotelKey } from "@/lib/hotel-addresses";
import { freezeShare, monthAt, scoreInMonth, type SeasonScores } from "@/lib/seasons";
import { isHotelStandbyLeg, tripStandbyDays } from "@/lib/standby";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { backupsToWork, earliestHome, flightsForTrip, realTravelForTrip, type FlightAnswers, type TripFlights } from "@/lib/flights/trip-travel";
import { tripStartUtc } from "@/lib/flights/needs";
import { groupDepartures, type Departure } from "@/lib/metrics/departures";
import { hubTurnsOf, summarizeHubTurns, type HubTurnSummary } from "@/lib/metrics/hub-turns";
import { DEFAULT_MIN_BREAK_NIGHTS, homeStretches, summarizeHomeTime, type HomeStretch, type HomeTime } from "@/lib/metrics/home-stretches";
import { DEFAULT_HOME_PARAMS, homeAwayForTrip, type HomeAway, type TravelTimeProvider } from "@/lib/metrics/home-travel";
import { legDeepNightMinutes, nightsWorked, type LayoverFact, type LegFact, type Region, type TripFacts } from "@/lib/metrics/trip-facts";
import { timezoneForAirport } from "@/lib/airport-timezones";
import type { Line, Trip } from "@/types/bidpack";

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

export type DayPart = "morning" | "afternoon" | "evening" | "night";

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
  /** Which part of a chosen weekday is meant, by weekday ("3": "night" — "home on Wednesday nights"); the whole day otherwise. */
  weekdayParts?: Record<string, DayPart>;
  /** How much the pilot likes each layover city, −1 (hates it) … +1 (loves it); cities left out are neutral. */
  cityScores?: Record<string, number>;
  /** A city's grade (−1 … +1) in the months it differs from its usual one in `cityScores` — winter, summer, months the pilot picked (`lib/seasons.ts`). */
  citySeasons?: Record<string, SeasonScores>;
  /** A hotel's grade (−1 … +1) where it differs from its city's, by `hotelKey` (city and printed name). */
  hotelScores?: Record<string, number>;
  /**
   * Places whose hotels a city's grade changes for (−1 … +1), matched by the hotel's name and address (`hotelInPlaces`);
   * `longLayovers`: only on a layover long enough to enjoy the place (`hasRealFullDay`).
   */
  hotelAreas?: { city: string; places: string[]; score: number; longLayovers?: boolean }[];
  /** The pack's base — filled in when a line is measured, not set by the brain. */
  base?: string;
  /** The bid period's first day, filled in beside `base`, so each layover is graded for its own month. */
  bidPeriodStart?: string | null;
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
  /**
   * `line` is the line's bid month and `trips` its trips cut at the month's end (`lib/bid-month.ts`) — for counts and
   * totals; `whole` the same trips uncut — for rates and runs, what the trips are like (see `metrics/compute.ts`).
   */
  line?: (line: Line, trips: TripFacts[], ctx: LineContext, p: MetricParams, whole: TripFacts[]) => number | null;
  /** Kept so an old priority still reads, but no longer offered to the interview (and moved off when a model loads — see `lib/brain/model-upgrade.ts`). */
  retired?: boolean;
  /**
   * For a "less is better" priority with no worst point given, the bad end of the scale is the pack's worst line rather
   * than the 5% mark. For counts with only a few values across a month — departures run 2 to 5 — the 5% mark is a step
   * from the best, so a single extra departure would cost half the priority.
   */
  badEndAtWorst?: boolean;
  /**
   * For a "more is better" priority with no enough point given, the good end of the scale is the 95% mark rather than
   * the pack's best line: a few lines far above the rest (standby lines pay 15–23 credit per hour flown, ordinary ones
   * 1.5–3) would otherwise squash every ordinary line into the bottom tenth of the priority.
   */
  goodEndAtMark?: boolean;
  /**
   * A count that adds up over the bid month — compared at the four weeks the pilot's numbers are for, so a five-week
   * bid month isn't held to a four-week month's numbers (see `fourWeekFactor`).
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
/** Rates per day away compare whole trips to whole trips (pass `whole`) — the line's printed totals stop at the bid period's edge while a trip running into next month doesn't. */
const tripCredit = (trips: TripFacts[]) => sum(flying(trips).map((f) => f.creditHours));
const inCities = (l: LayoverFact, p: MetricParams) => !!p.cities?.includes(l.city);
/**
 * How much the pilot likes a city, −1 … +1. Their own base counts as neutral: time there isn't a layover somewhere — a
 * pilot who lives there is home, and a commuter's time at base is what the commute and base-standby measures are for.
 * Counted as a layover city, a month of hotel standby at base read as hundreds of hours "in a place you avoid".
 */
const cityScore = (city: string, p: MetricParams, month: number | null = null) =>
  city === p.base ? 0 : Math.max(-1, Math.min(1, scoreInMonth(p.cityScores?.[city] ?? 0, p.citySeasons?.[city], city, month)));
/** A city's grade at some minutes into a trip — its winter or summer grade when the pilot gave one, else its usual one. */
const cityScoreOn = (f: TripFacts, city: string, minutes: number, p: MetricParams) => cityScore(city, p, p.citySeasons?.[city] ? monthAt(p, f.trip, minutes, city) : null);
/** A hotel's own grade, from the pilot's grade for it or for the place it's in; null when it has none. */
/**
 * A layover with a whole free day in it, the way the ex-pilot counts one when it's strict: "that second full night's
 * sleep only counts if I don't have to get up before, say 6 AM." A "just barely" one (up around 4) counts as a full
 * day elsewhere, but isn't the long layover he means.
 */
const hasRealFullDay = (l: LayoverFact) => l.fullDays > 1 || (l.fullDays === 1 && !l.barelyFullDay);

/**
 * A hotel's own grade, from the pilot's grade for it or for the place it's in; null when it has none. A place they tied
 * to a long layover counts only on one: "a long layover away from Oakland (like over the hill in Pleasanton …) would
 * make it much better." Counted on every stay at the Pleasanton hotel in his October pack, it lifted his last line
 * (1049, two 29-hour stays picked up at 03:43) and cost his sort 2 to 3 pairs; on the stays with a real full day, his
 * sort comes out as before.
 */
function hotelScore(l: LayoverFact, p: MetricParams): number | null {
  if (!l.hotel) return null;
  const own = p.hotelScores?.[hotelKey(l.city, l.hotel)];
  if (own !== undefined) return own;
  const area = p.hotelAreas?.find((a) => a.city === l.city && hotelInPlaces(l.city, l.hotel!, a.places) && (!a.longLayovers || hasRealFullDay(l)));
  return area?.score ?? null;
}
/**
 * A layover's grade: its season's when it falls in one the pilot graded (the weather is the weather, whatever the
 * hotel), else its hotel's when that has one, else its city's.
 */
function layoverScore(f: TripFacts, l: LayoverFact, p: MetricParams): number {
  if (l.city === p.base) return 0;
  const usual = hotelScore(l, p) ?? p.cityScores?.[l.city] ?? 0;
  const month = p.citySeasons?.[l.city] ? monthAt(p, f.trip, l.start, l.city) : null;
  return Math.max(-1, Math.min(1, scoreInMonth(usual, p.citySeasons?.[l.city], l.city, month)));
}
/**
 * A trip's time away from home in days, as the ex-pilot counts them: any part of a day is a day. Monday morning to Friday
 * afternoon, about 4.3 days, is "really a 5-day trip for me for 32 credit hours". Counted as hours over 24, a commute
 * that leaves home the morning of an afternoon show made a line look better paid than he'd see it, and cost his sort
 * 0.7 points; counted whole, his sort came out higher than before the same-day commute (98.94% with his trip picks over
 * 8 readings, 98.64% over 16, against 98.15%) and the simulated ex-pilot back where it was. Rounding to the nearest
 * day, or forgiving the first few hours over, both scored well below.
 */
const daysAway = (hours: number) => Math.max(1, Math.ceil(hours / 24 - 1e-9));
/** The hours of a day each part covers, from its midnight; a night runs into the next morning. */
const DAY_PART_HOURS: Record<DayPart | "day", [number, number]> = { morning: [7, 12], afternoon: [12, 17], evening: [17, 22], night: [22, 30], day: [8, 20] };
/** Calendar days from one instant to another on a clock, both days counted; 0 when either isn't known. */
function daysTouched(from: number | null, to: number | null, zone: string): number {
  if (from === null || to === null || to < from) return 0;
  const a = DateTime.fromMillis(from, { zone }).startOf("day");
  const b = DateTime.fromMillis(to, { zone }).startOf("day");
  return Math.round(b.diff(a, "days").days) + 1;
}
/** Standby days (one standby row each) at cities matching `where`. */
const standbyDaysWhere = (trips: TripFacts[], where: (city: string) => boolean) =>
  sum(trips.map((f) => f.trip.schedule.flatMap((d) => d.legs).filter((l) => isHotelStandbyLeg(l) && where(l.depAirport)).length));
/**
 * For "how late" measures, the night runs on until 05:00: an arrival before then belongs to the evening before. From
 * 05:00 a commuter makes the first flights out in the morning — a 05:19 block-in isn't a night stuck at base.
 */
const NIGHT_RUNS_UNTIL = 5 * 60;
/** "How early / how late at base" for a line whose every trip starts (or ends) on a deadhead: no report to make, no flight home to catch. */
const NO_BASE_REPORT = 23 * 60 + 59;
const NO_BASE_RELEASE = NIGHT_RUNS_UNTIL;

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
 * Body-clock scores (1–100, 100 gentlest — `lib/body-clock-score.ts`) for trips with scheduled flying. A trip that's all
 * standby has nothing scheduled to rate — and a call-out can come at any hour — so it counts as unknown, not as a 100.
 */
function tripBodyClocks(trips: TripFacts[], c: LineContext): number[] {
  return trips
    .filter((f) => !f.noFlying)
    .map((f) => tripBodyClockScore(f.trip, c.homeBaseOffsetMinutes)?.score)
    .filter((s): s is number => s !== undefined);
}

/** Time away from home for each trip, or null when the pilot's home isn't known or a trip can't be placed. */
function homeAway(trips: TripFacts[], c: LineContext, p: MetricParams): HomeAway[] | null {
  if (!p.homeAirports?.length) return null;
  const params = {
    homeAirports: p.homeAirports,
    commuteBufferHours: p.commuteBufferHours,
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

/**
 * How much of a departure (or trip) is this month's: all of it, or — for one running into the next month — the share of
 * its time away, from leaving (`from`, ms) to the last landing, that falls before the month's end. A count of departures
 * or trips splits one that carries over this way, as the pack splits its credit: a departure leaving home three days
 * before the month's end and landing back two days after is 0.6 of this month's (the ex-pilot's sort, 20 readings:
 * counted whole 97.18% lines only, 97.54% with his trip picks; split 98.20%, 97.82%).
 */
function monthShare(last: Trip, from: number | null, c: LineContext): number {
  if (!last.carriesIntoNextMonth || from === null) return 1;
  const end = bidMonthEnd(c);
  const whole = uncutTrip(last);
  const start = tripStartUtc(c, whole);
  if (end === null || start === null) return 1;
  const landed = start + Math.max(0, ...whole.schedule.flatMap((x) => x.legs.map((l) => l.endMinutes))) * 60_000;
  return landed > from ? Math.min(1, Math.max(0, (end - from) / (landed - from))) : 1;
}

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
    id: "creditPerBlockHour",
    label: "Pay for the flying",
    unit: "credit per block hour",
    category: "pay",
    description:
      "Credit per block hour flown — what the line pays for the work itself. A trip that pays well for little flying (a double deadhead around one long leg) scores high; one that flies 18 hours for 28 credit scores low. For a pilot who weighs pay against the work it takes (\"25% less pay — but maybe 65% less work\"); creditPerDayAway weighs it against time away.",
    line: (_l, _t, _c, _p, whole) => {
      const block = sum(flying(whole).map((f) => f.blockHours ?? 0));
      return block > 0 ? tripCredit(whole) / block : null;
    },
    goodEndAtMark: true,
  },
  {
    id: "creditPerDayAway",
    label: "Credit per day away",
    unit: "hours/day",
    category: "pay",
    description: "Credit earned per 24 hours away from base, as scheduled, across the line's whole trips.",
    line: (_l, _t, _c, _p, trips) => {
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
    line: (_l, _t, _c, p, trips) => {
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
    description: "Hours from leaving home to getting back home — including the commute to the domicile, or flying straight to where a trip starts on a front-end deadhead and straight home after a back-end one.",
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
    description:
      "Credit per day away from home, commute included — the number a commuter actually lives. Days counted the way pilots count them: any part of a day away is a day (\"really a 5-day trip for me for 32 credit hours\", for Monday morning to Friday afternoon).",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, _t, c, p, trips) => {
      const away = homeAway(trips, c, p);
      const days = away?.reduce((s, a) => s + daysAway(a.awayHours), 0) ?? 0;
      return away && days > 0 ? tripCredit(trips) / days : null;
    },
  },
  {
    id: "tripsJoinedFromHome",
    label: "Trips that start with a deadhead from home",
    unit: "trips",
    category: "commute",
    description: "Trips that start with a deadhead the pilot can catch from home (a front-end deadhead from home) rather than commuting to the domicile.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, trips, c, p) => homeAway(trips, c, p)?.filter((a) => a.start === "deviate").length ?? null,
  },
  {
    id: "tripsEndingStraightHome",
    label: "Trips you can deviate home from",
    unit: "trips",
    category: "commute",
    description: "Trips the pilot can deviate home from: heading home after the last operated leg beats riding back to the domicile and commuting.",
    params: ["homeAirports", "backRestHours"],
    defaults: { ...DEFAULT_HOME_PARAMS },
    line: (_l, trips, c, p) => homeAway(trips, c, p)?.filter((a) => a.end === "deviate").length ?? null,
  },

  // ---- Real airline flights, for commuters (only for lines whose trips were looked up) ----
  {
    id: "fewestBackupFlights",
    label: "Fewest other flights you could commute on",
    unit: "flights",
    category: "commute",
    description:
      "Across the month's trips, the fewest real airline flights beyond the one you'd plan on that still get you to work in time — to the domicile, or straight to where a trip's flying starts — from published schedules, with the time you leave before show. Unknown for lines whose flights haven't been looked up.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours"],
    line: (_l, trips, c) => {
      const ts = tripFlights(trips, c);
      const backups = ts?.map(({ t }) => backupsToWork(t)).filter((b): b is number => b !== null);
      return backups?.length ? Math.min(...backups) : null;
    },
  },
  {
    id: "tripsShortOnBackups",
    label: "Trips short on other flights to commute on",
    unit: "trips",
    category: "commute",
    description: "Trips where fewer real airline flights than you want to have (n; your stated minimum by default, else 2) still get you to work in time. Unknown for lines whose flights haven't been looked up.",
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
      "The most hours, across the month's trips, from the end of the work (the last operated flight or standby) until the first real airline flight lands you home — from the domicile, or straight from where the flying ends. Unknown for lines whose flights haven't been looked up.",
    params: ["homeAirports", "backRestHours"],
    line: (_l, trips, c) => {
      const ts = tripFlights(trips, c);
      if (!ts) return null;
      // A trip still flying at the month's end comes home next month: its flight home was looked up for the whole
      // trip, so measured from this month's cut it counted the carried-over flying as waiting.
      const hours = ts.flatMap(({ f, t }) => {
        if (f.trip.carriesIntoNextMonth) return [];
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
  // Judged at four weeks' worth in a five-week month, as work days are: whole, "at least 15 days off" never bound there,
  // where every line has 16 or more (CBA 2026 25.D.1.b: 19 work days in five weeks), while "at most 13 work days" did.
  { id: "daysOff", label: "Days off", unit: "days", category: "calendar", description: "Days off in the bid period.", perMonth: true, line: (l) => l.daysOff },
  { id: "longestDaysOffBlock", label: "Longest stretch of days off", unit: "days", category: "calendar", description: "The longest run of consecutive days off.", line: (l) => longestDaysOffBlock(l) },
  {
    id: "singleDaysOff",
    label: "Single days off",
    unit: "days",
    category: "calendar",
    description: "Days off standing alone between two working days — scattered singles instead of real breaks ('a single day off between trips is useless'). Days off in runs of two or more don't count.",
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
    label: "Chosen weekdays at home",
    unit: "days",
    category: "calendar",
    description:
      "The pilot's chosen days of the week (e.g. Wednesdays and Sundays) spent at home — door to door, so a day off spent commuting home doesn't count — for a standing weekly commitment. A part of the day the pilot names (\"home on Wednesday nights and Sunday mornings\") is that part: the evening (17:00–22:00), the night (22:00–06:00), the morning (07:00–12:00) or the afternoon (12:00–17:00); otherwise the day, 08:00–20:00. Counted on the clock at home.",
    params: ["weekdays"],
    line: (line, trips, ctx, p) => {
      if (line.estimated || !ctx.bidPeriodStart || !p.weekdays?.length) return null;
      const home = homeTimeOf(trips, ctx, p);
      if (!home) return null;
      const homeAirport = p.homeAirports?.find((a) => a && a !== ctx.base);
      const zone = timezoneForAirport(homeAirport ?? ctx.base) ?? timezoneForAirport(ctx.base) ?? "UTC";
      const start = DateTime.fromISO(ctx.bidPeriodStart, { zone });
      let n = 0;
      for (let i = 0; i < ctx.bidPeriodDays; i++) {
        const day = start.plus({ days: i });
        if (!p.weekdays.includes(day.weekday)) continue;
        const [from, to] = DAY_PART_HOURS[p.weekdayParts?.[String(day.weekday)] ?? "day"];
        const a = day.plus({ hours: from }).toMillis();
        const b = day.plus({ hours: to }).toMillis();
        if (home.stretches.some((s) => s.from <= a && s.to >= b)) n++;
      }
      return n;
    },
  },
  { id: "weekendDaysOff", label: "Weekend days off", unit: "days", category: "calendar", description: "Saturdays and Sundays off.", line: (l, _t, c) => weekendDaysOff(l, c.bidPeriodStart) },
  { id: "tripCount", label: "Trips", unit: "trips", category: "calendar", description: "Number of trips in the month. For a pilot who lives in the domicile city; a commuter's are counted in homeDepartures. A trip running into the next bid month counts by the share of it in this one.", perMonth: true, belowFine: BELOW_FINE_COUNTS, line: (l, _t, c) => l.trips.reduce((n, t) => n + monthShare(t, tripStartUtc(c, t), c), 0) },
  {
    id: "homeDepartures",
    label: "Departures",
    unit: "departures",
    category: "calendar",
    description:
      "How many times the pilot leaves home to fly — trips flown without going home in between count once (a \"series of trips\" or \"trip sequence\"). For a commuter, two trips are one departure unless there would be at least minHomeHours (default 24) at home between them, counted door to door: deadheading home from where one trip's flying ends, or commuting home from the domicile, then back out for the next. For a pilot who lives in the domicile city, only trips that turn within a few hours there are joined. A departure running into the next bid month counts by the share of it in this one (0.6 when three of its five days are this month's).",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours"],
    badEndAtWorst: true,
    perMonth: true,
    line: (_l, trips, c, p) => departuresOf(trips, c, p).reduce((n, d) => n + monthShare(d.trips[d.trips.length - 1], d.leaveHome ?? d.reportAt, c), 0),
    belowFine: BELOW_FINE_COUNTS,
  },
  {
    id: "workDays",
    label: "Days given to work",
    unit: "days",
    category: "calendar",
    description:
      "Calendar days each departure touches, from the day the pilot leaves home to the day they're back, both counted — commute days and all: a two-day trip with a commute either side takes four (\"there are four days that I'm thinking about work — for just 12 hours of pay\"). Counted on the clock at home; for a pilot who lives in the domicile city, from report to the end of the last duty period. A departure running into the next bid month counts its days in this one. For a pilot who talks about days lost to work rather than hours away.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours"],
    perMonth: true,
    line: (_l, trips, c, p) => {
      const home = p.homeAirports?.find((a) => a && a !== c.base);
      const zone = timezoneForAirport(home ?? c.base) ?? timezoneForAirport(c.base) ?? "UTC";
      return departuresOf(trips, c, p).reduce((n, d) => n + daysTouched(d.leaveHome ?? d.reportAt, d.backHome ?? d.releaseAt, zone), 0);
    },
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
    description: "Nights spent at home in the bid period, door to door — every night not away on a trip, commuting, or in the domicile city.",
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
    label: "Commutes to or from the domicile",
    unit: "commutes",
    category: "commute",
    description:
      "Commutes to or from the domicile the month really takes, counted per departure (trips flown without going home count once): 0–2 each, none at an end that starts or finishes on a deadhead the pilot can catch from home or ride home on. A pilot who lives in the domicile city has none.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours"],
    badEndAtWorst: true,
    line: (_l, trips, c, p) => departuresOf(trips, c, p).reduce((s, d) => s + d.baseCommutes, 0),
    belowFine: BELOW_FINE_COUNTS,
  },
  {
    id: "baseHotelNights",
    label: "Nights in the domicile city",
    unit: "nights",
    category: "commute",
    description:
      "Nights a commuter without a crash pad spends in the domicile city: the night before a report too early to commute in that morning (unless the first duty is short enough to jumpseat in the evening before and nap at the hub), nights waiting there between trips of one departure, and the night after a duty period that ends too late to get home.",
    params: ["homeAirports", "commuteBufferHours", "frontBufferHours", "backRestHours", "minHomeHours", "hasCrashPad"],
    badEndAtWorst: true,
    line: (_l, trips, c, p) => departuresOf(trips, c, p).reduce((s, d) => s + d.baseNights.reduce((a, b) => a + b.nights, 0), 0),
    belowFine: BELOW_FINE_COUNTS,
  },
  { id: "avgTripDays", label: "Average trip length", unit: "days", category: "calendar", description: "Average trip length in days.", trip: { measure: (f) => f.trip.days, aggregate: "mean" } },
  { id: "longestTripDays", label: "Longest trip", unit: "days", category: "calendar", description: "Length of the longest trip.", trip: { measure: (f) => f.trip.days, aggregate: "max" } },

  // ---- Duty structure ----
  { id: "dutyPeriods", label: "Duty periods", unit: "duties", category: "duty", description: "Duty periods in the month, as the pack prints them (NO. DP'S).", line: (l) => lineDutyPeriods(l) },
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
    label: "Long duty periods",
    unit: "duties",
    category: "duty",
    description: "Duty periods longer than N hours, report to the last leg's arrival (default 12).",
    params: ["minHours"],
    defaults: { minHours: 12 },
    trip: { measure: (f, p) => f.duties.filter((d) => d.legs.length > 0 && (d.end - d.start) / 60 > (p.minHours ?? 12)).length, aggregate: "sum" },
  },
  {
    id: "maxDutyHours",
    label: "Longest duty period",
    unit: "hours",
    category: "duty",
    description: "The longest duty period, report to the last leg's arrival.",
    trip: { measure: (f) => Math.max(0, ...f.duties.filter((d) => d.legs.length).map((d) => (d.end - d.start) / 60)), aggregate: "max" },
  },

  // ---- Commute and deadheads ----
  {
    id: "frontDeadheadTrips",
    label: "Trips that start with a deadhead",
    unit: "trips",
    category: "commute",
    description: "Trips whose first leg is a deadhead — a commuter can often fly straight from home to where the flying starts, skipping the domicile.",
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
    description: "Trips that start and end with a deadhead — no commute to or from the domicile at either end.",
    trip: { measure: (f) => (f.front && f.back ? 1 : 0), aggregate: "sum" },
  },
  {
    id: "baseCommutesNeeded",
    label: "Commutes to or from the domicile, trip by trip",
    unit: "commutes",
    category: "commute",
    description:
      "Retired: it counted two commutes a trip — even between trips flown back to back without going home — and took any front-end deadhead as one caught from home, wherever it left from, so a line could read 10 commutes with 5 real. A pilot's commutes are departureCommutes.",
    retired: true,
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
    description: "Average hours between a front-end deadhead's arrival and the first operated departure — room to arrive later or have other flights to commute on.",
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
    label: "Earliest report at the domicile",
    unit: "minute of day",
    category: "commute",
    description:
      "Earliest local report time at the domicile on a trip that starts with operated flying (a commuter must be there in time). A line whose every trip starts on a deadhead has no report there to make: it counts as 23:59, the easiest there is.",
    line: (_l, trips) => {
      const flying = trips.filter((t) => !t.noFlying);
      const reports = flying.filter((t) => !t.front).map((t) => t.duties[0]?.reportLocalMinute).filter((m): m is number => m !== null && m !== undefined);
      if (reports.length) return Math.min(...reports);
      return flying.length && flying.every((t) => t.front) ? NO_BASE_REPORT : null;
    },
  },
  {
    id: "latestBaseRelease",
    label: "Latest arrival back at the domicile",
    unit: "minute of day",
    category: "commute",
    description:
      "Latest local arrival at the domicile on a trip that ends with operated flying (a commuter then needs a flight home). The night runs on past midnight: an arrival before 05:00 counts as later than the evening before it (02:30 is measured as 26:30, i.e. 1590 minutes); from 05:00 it's morning, with flights home. A line whose every trip ends on a deadhead has no flight home to catch from the domicile: it counts as 05:00, the earliest there is.",
    line: (_l, trips) => {
      const flying = trips.filter((t) => !t.noFlying);
      if (flying.length && flying.every((t) => t.back)) return NO_BASE_RELEASE;
      const arrivals = flying
        .filter((t) => !t.back)
        .map((t) => t.operatedLegs[t.operatedLegs.length - 1]?.arrLocalMinute)
        .filter((m): m is number => m !== null && m !== undefined)
        // A 02:30 block-in is the end of a long night, not an early release.
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
    label: "Layovers where you'd sleep in the daytime",
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
    trip: { measure: (f, p) => f.layovers.reduce((a, l) => a + layoverScore(f, l, p) * l.hours, 0), aggregate: "sum" },
  },
  {
    id: "fullDaysInLikedCities",
    label: "Full days in cities you like",
    unit: "weighted days",
    category: "city",
    description:
      "Full days free on layovers, each weighted by how much the pilot likes the city (−1 … +1). A full day the way pilots count it: land one day (late at night or an hour or two past midnight counts), a full night's sleep, the whole next day free to see the city and eat well, a second full night, and not up before about 6 AM the day after (up around 4 is \"just barely\" one, and still counts). Every free day between two full nights is another, worth as much as the first. For a pilot who talks about \"a full day\" or \"a real day off\" in cities they like; layoverValue is hours in a city, however they fall.",
    params: ["cityScores"],
    trip: { measure: (f, p) => f.layovers.reduce((a, l) => a + layoverScore(f, l, p) * l.fullDays, 0), aggregate: "sum" },
  },
  {
    id: "layoverFullDays",
    label: "Full days off on layovers",
    unit: "days",
    category: "layover",
    description: "Full days free on layovers in any city, counted as fullDaysInLikedCities counts them — for a pilot who wants a real day off on the road wherever it is.",
    trip: { measure: (f) => f.layovers.reduce((a, l) => a + l.fullDays, 0), aggregate: "sum" },
  },
  {
    id: "eatAndSleepLayovers",
    label: "Layovers with only time to eat and sleep",
    unit: "layovers",
    category: "layover",
    description: "Layovers with no full day free in them — time to eat and sleep, perhaps an afternoon, and back to work.",
    trip: { measure: (f) => f.layovers.filter((l) => l.fullDays === 0).length, aggregate: "sum" },
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
    id: "hardestTripBodyClock",
    label: "Hardest trip on the body clock",
    unit: "score (1–100, 100 gentlest)",
    category: "body",
    description: "Body-clock score of the line's hardest trip: night work, nights in a row, early reports, time awake, layover sleep, going between day and night flying, and time zones.",
    line: (_l, _t, c, _p, trips) => {
      const scores = tripBodyClocks(trips, c);
      return scores.length ? Math.min(...scores) : null;
    },
  },
  {
    id: "bodyClockScore",
    label: "Body-clock score",
    unit: "score (1–100, 100 gentlest)",
    category: "body",
    description:
      "How gentle the line is on the body clock, 1–100: night work, nights in a row, early reports, time awake, layover sleep, going between day and night flying, time zones and recovery between trips (see lib/body-clock-score.ts). On one trip, that trip's own score.",
    line: (_l, _t, c, _p, trips) => {
      // A trip read on its own (trip scores hand over the trip's line and just that trip) gets its own score, the same
      // number its trip shows — the old stars were always the trip's own. A line's trips are scored whole: a run of
      // nights the last trip flies on into the next month weighs on the body all the same.
      if (trips.length === 1) return tripBodyClocks(trips, c)[0] ?? null;
      return lineBodyClockScore(trips.map((f) => f.trip), c.homeBaseOffsetMinutes)?.score ?? null;
    },
  },
  {
    id: "redEyeLegs",
    label: "Night legs",
    unit: "legs",
    category: "body",
    description: "Operated legs flying through the night: at least an hour between midnight and 5am local (00:00–05:00) — a leg in just after midnight, or out just before five, isn't one.",
    trip: { measure: (f) => f.operatedLegs.filter((l) => legDeepNightMinutes(l) >= RED_EYE_MINUTES).length, aggregate: "sum" },
  },
  {
    id: "deIcingExposure",
    label: "Takeoffs where you'd likely de-ice",
    unit: "takeoffs",
    category: "duty",
    description:
      "Operated takeoffs where de-icing is likely, each counted by how often nights freeze at that airport in that month (its climate on record): a January takeoff from Anchorage counts about 1, Memphis about half, Honolulu 0. For a pilot who'd bid around de-icing, snow and freezing rain — the work of a cold-station winter, not the time in the city (that's the city's winter grade).",
    perMonth: true,
    trip: { measure: (f, p) => f.operatedLegs.reduce((a, l) => a + (freezeShare(l.from, monthAt(p, f.trip, l.start, l.from) ?? 0) ?? 0), 0), aggregate: "sum" },
  },
  {
    id: "nightsWorked",
    label: "Nights worked",
    unit: "nights",
    category: "body",
    description: "Nights with at least half an hour between midnight and 5am (00:00–05:00, on the domicile's clock or the local one) spent on operated flying or hotel standby — standby through the night keeps a pilot on a night schedule as surely as flying does.",
    line: (_l, trips) => nightsOfLine(trips)?.length ?? null,
  },
  {
    id: "nightHubTurnRuns",
    label: "Weeks of night hub turns",
    unit: "hub turns",
    category: "body",
    description:
      "Night hub turns that come three or more nights in a row — a week of flying into a sort hub in the evening, sitting through the sort and flying back out before dawn. Work on the backside of the clock that pilots call onerous, where one now and then is fine. For a pilot who talks about hub turning, use this rather than the general night measures.",
    badEndAtWorst: true,
    // A week of night turns starting this month is this month's, counted whole — into the next month if it goes on there
    // (cut at midnight, a five-night week reads as three; counted whole, the ex-pilot's sort on 7 readings went 96.3% →
    // 96.6% lines only, 96.6% → 97.2% with his trip picks).
    line: (_l, _t, c, _p, trips) => hubTurnsOfLine(trips, c).inWeeks,
  },
  {
    id: "longestHubTurnRun",
    label: "Most night hub turns in a row",
    unit: "nights",
    category: "body",
    description: "The longest run of consecutive nights with a night hub turn — for a pilot who gives a limit ('two nights of hub turning in a row is fine').",
    badEndAtWorst: true,
    line: (_l, _t, c, _p, trips) => hubTurnsOfLine(trips, c).longestRun,
  },
  {
    id: "nightHubTurns",
    label: "Night hub turns",
    unit: "hub turns",
    category: "body",
    description: "Every hub turn whose time in the sort hub runs between midnight and 5am (00:00–05:00 local), however they fall.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).night,
  },
  {
    id: "restHotelHubTurns",
    label: "Hub turns with a crew-rest hotel",
    unit: "hub turns",
    category: "duty",
    description:
      "Hub turns with long enough in the hub (about 4 hours or more) that the crew gets a short airport hotel for a nap before the outbound leg. Some pilots like the nap; others find the leg after it feels like a whole extra duty period and would rather have a shorter hub turn. Direction as they say.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).withRestHotel,
  },
  {
    id: "dayHubTurns",
    label: "Day hub turns",
    unit: "hub turns",
    category: "duty",
    description: "Hub turns by day: flying into a sort hub (the domicile included) and sitting several hours on the ground before flying back out, without a night at a hotel.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).day,
  },
  {
    id: "hubTurns",
    label: "Hub turns",
    unit: "hub turns",
    category: "duty",
    description: "Every hub turn: a leg into a sort hub (MEM, IND, OAK, EWR, AFW, GSO, ANC, CDG, CAN), sitting while the packages are sorted, then a leg back out. Only for a pilot who minds hub turns as such — most mind the night weeks, not the occasional one.",
    line: (_l, trips, c) => hubTurnsOfLine(trips, c).all,
  },
  {
    id: "longestNightStreak",
    label: "Most nights in a row worked",
    unit: "nights",
    category: "body",
    description: "The longest run of consecutive nights worked across the month, across trips.",
    line: (_l, _t, _c, _p, trips) => {
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
    label: "Hours of work between midnight and 5 am",
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
    label: "Trips that end with a night leg",
    unit: "trips",
    category: "body",
    description:
      "Trips whose last operated leg flies through the night and lands at dawn (03:00–07:00 local, after at least an hour between midnight and 5am) — finishing a trip flying through the night. A late leg that's in by 01:30 doesn't count.",
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
    label: "Most all-night duties in a row",
    unit: "duties",
    category: "body",
    description:
      "The longest run of consecutive all-night duties on a trip — duties whose flying spans at least 3 of the 5 hours from midnight to 5am (00:00–05:00 local). Early reports and late arrivals don't count.",
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
    label: "All-night duties back to back",
    unit: "duties",
    category: "body",
    description:
      "Consecutive all-night duties: duties whose flying runs, first leg out to last arrival, across at least 3 of the 5 hours from midnight to 5am (00:00–05:00 local). A late leg in at 01:30, or an early leg out at 04:15, isn't one.",
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
    description: "All hotel standby days, at the domicile or on a trip — on call, paid, not flying.",
    trip: { measure: (f) => tripStandbyDays(f.trip), aggregate: "sum" },
  },
  {
    id: "tripStandbyDays",
    label: "Standby days on trips",
    unit: "days",
    category: "standby",
    description: "Hotel standby days at a layover city away from the domicile, in the middle of a trip — on call instead of flying, without sitting at the domicile.",
    line: (_l, trips, ctx) => standbyDaysWhere(trips, (city) => city !== ctx.base),
  },
  {
    id: "standbyDaysByCity",
    label: "Standby days, valued by where they are",
    unit: "days",
    category: "standby",
    description:
      "Hotel standby days, each worth 1 + the pilot's score for that city (−1 … +1): a standby day in a city they love counts 2, a neutral city 1, a city they avoid 0. For a commuter with no crash pad, a day at the domicile counts 0 — it's a hotel in that city, away from home (\"I don't want to do reserve in Memphis, given that I don't live there and don't have a crash pad there\"); baseStandbyDays counts those days on their own.",
    params: ["cityScores"],
    line: (_l, trips, ctx, p) => {
      const commuter = !!p.homeAirports?.some((a) => a && a !== ctx.base) && !p.homeAirports?.includes(ctx.base);
      const worth = (f: TripFacts, l: Trip["schedule"][number]["legs"][number]) =>
        l.depAirport === ctx.base && commuter && !p.hasCrashPad ? 0 : Math.max(0, 1 + cityScoreOn(f, l.depAirport, l.startMinutes, p));
      return sum(trips.map((f) => f.trip.schedule.flatMap((d) => d.legs).filter((l) => isHotelStandbyLeg(l)).reduce((a, l) => a + worth(f, l), 0)));
    },
  },
  {
    id: "baseStandbyDays",
    label: "Standby days at the domicile",
    unit: "days",
    category: "standby",
    description: "Hotel standby days at the domicile itself — a commuter spends them in that city, away from home.",
    line: (_l, trips, ctx) => standbyDaysWhere(trips, (city) => city === ctx.base),
  },
];

export const METRICS_BY_ID = new Map(METRICS.map((m) => [m.id, m]));
