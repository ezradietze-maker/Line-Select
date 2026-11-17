import { DateTime } from "luxon";
import { dateOfDayIndex } from "@/lib/days-off-pattern";
import { formatHoursValue } from "@/lib/interview-config";
import { baseClock } from "@/lib/line-timeline";
import { layoverScore, type MetricParams } from "@/lib/metrics/catalog";
import { tripFactsOf, type LayoverFact, type TripFacts } from "@/lib/metrics/trip-facts";
import { criterionWeight, homeParams, spreadOf, utilityOf } from "@/lib/scoring-v2/score";
import { lineByDay } from "@/lib/trip-anchor";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, CriterionShape, PilotModel } from "@/types/pilot-model";

/**
 * The Heat Map: every piece of a line's trips — each duty period and each layover — rated from cold (bad
 * for this pilot) to hot (good), so a pilot can see at a glance how much of a month is the kind they want and where
 * the rest sits. Each piece's heat is a weighted mean of the things that make it good or bad (its factors), and each
 * factor keeps its reason in the pack's words or the ex-pilot's: "Report 0435", "26h in HNL", "3 legs".
 *
 * What counts, and how much, is the pilot's own reading from the interview — the same priorities, weights, numbers
 * and dealbreakers that rank their lines: a pilot who said three-leg duties are too many sees every three-leg duty go
 * cold, and one who loves Honolulu sees every Honolulu layover glow. Things they never mentioned still show, faintly,
 * from what most pilots feel (an 0400 report, a 10-hour layover, a four-leg duty); a pilot with no interview yet sees
 * those alone. Things only the pilot can say are good or bad — international layovers, hotel standby — show only when
 * they've said.
 *
 * Days off aren't rated: a day off is plainly good, and the owner wants the colour on the trips (Nov 2026). What a pilot
 * said about days off still counts in the line's score, and a duty on a weekend or a date they want off shows as cold.
 *
 * Measured once per line (`measureLineHeat`, the pack's facts), then rated for a pilot (`lineHeat`). Pieces sit on the
 * month's timeline at base (`lib/line-timeline.ts`), so a strip can draw them under the Timeline's own flights.
 */

const DAY = 24 * 60;

export type HeatPieceKind = "duty" | "layover";

export type HeatFactorId =
  | "report"
  | "legs"
  | "dutyHours"
  | "night"
  | "credit"
  | "standby"
  | "deadhead"
  | "commuteIn"
  | "commuteHome"
  | "layoverLength"
  | "sleep"
  | "city"
  | "fullDays"
  | "international"
  | "atDomicile"
  | "weekend"
  | "weekdays"
  | "dates";

/** One thing that makes a piece good or bad, and why. */
export interface HeatFactor {
  id: HeatFactorId;
  /** 0 (as bad as it gets for this pilot) … 1 (as good). */
  heat: number;
  /** How much it counts in its piece. */
  weight: number;
  /** In the pack's words or the ex-pilot's: "Report 0435", "26h in HNL". */
  text: string;
  /** It breaks one of the pilot's dealbreakers. */
  dealbreaker?: boolean;
}

export interface HeatPiece {
  kind: HeatPieceKind;
  /** Minutes from the bid period's first midnight at base, as `buildLineTimeline`. */
  start: number;
  end: number;
  /** The trip it's on, by its place on the line's timeline (`TimelineTrip.index`, `lineByDay(line).trips`). */
  trip: number;
  /** The duty period it is, or the layover follows (`trip.schedule` index, as `TimelineSegment.dutyIndex`). */
  duty: number;
  /** 0 (cold) … 1 (hot); 0.5 when nothing is known about it. */
  heat: number;
  /** Its factors, warmest first. */
  factors: HeatFactor[];
}

export interface LineHeat {
  pieces: HeatPiece[];
  /** Each trip's heat, time-weighted over its duties and layovers, by `TimelineTrip.index`. */
  trips: Map<number, number>;
  /** The whole month's heat, time-weighted. */
  heat: number;
  /** Shares of the trips' time that run hot, mild and cold (they add up to 1, or are all 0 with nothing rated). */
  share: HeatShare;
}

export interface HeatShare {
  hot: number;
  mild: number;
  cold: number;
}

/**
 * A share as whole percents that always add up to 100 (or are all 0, with nothing rated): each rounded down, then the
 * points left over go to the ones that lost the most. Rounded on their own, 33.4 / 33.3 / 33.3 read 33 + 33 + 33.
 */
export function sharePercents(share: HeatShare): HeatShare {
  const keys = ["hot", "mild", "cold"] as const;
  const sum = share.hot + share.mild + share.cold;
  if (!(sum > 0)) return { hot: 0, mild: 0, cold: 0 };
  const exact = keys.map((k) => (share[k] / sum) * 100);
  const out = exact.map(Math.floor);
  const order = keys.map((_, i) => i).sort((a, b) => exact[b] - out[b] - (exact[a] - out[a]) || a - b);
  for (let left = 100 - out.reduce((a, b) => a + b, 0), j = 0; left > 0; left--, j++) out[order[j % 3]]++;
  return { hot: out[0], mild: out[1], cold: out[2] };
}

/** At and above this a piece reads as hot; below `COLD_BELOW`, cold. */
export const HOT_AT = 0.6;
export const COLD_BELOW = 0.4;

// ---------------------------------------------------------------------------------------------------------------------
// Measuring: what each piece is, the same for every pilot.

interface MeasuredDuty {
  kind: "duty";
  start: number;
  end: number;
  trip: number;
  duty: number;
  /** Report on the local clock, minutes after midnight. */
  report: number | null;
  legs: number;
  deadheads: number;
  hours: number;
  nightMinutes: number;
  /**
   * Its trip's credit per day away, a day for any part of one — how a pilot sizes up what a trip pays ("really a 5-day
   * trip for me for 32 credit hours"), and what the pay priorities measure. A duty's own printed credit isn't in every
   * pack (the ex-pilot's October one has none), and a long sit pays the same however the trip spreads it.
   */
  credit: number | null;
  standby: boolean;
  /** Bid-period day indexes it touches at base. */
  days: number[];
  /** The trip's first duty, when the trip starts with flying out of the domicile ("in") or on a deadhead ("deadhead"). */
  tripStart: "in" | "deadhead" | null;
  /** The trip's last duty: flying back into the domicile, landing at this local minute — or ending on a deadhead. */
  tripEnd: { release: number | null } | "deadhead" | null;
}

interface MeasuredLayover {
  kind: "layover";
  start: number;
  end: number;
  trip: number;
  duty: number;
  facts: TripFacts;
  layover: LayoverFact;
  atDomicile: boolean;
}

type Measured = MeasuredDuty | MeasuredLayover;

const measuredByLine = new WeakMap<Line, { key: string; pieces: Measured[] }>();

type HeatPack = Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">;

/** A line's pieces as measured, on its timeline; none without the pack's real dates. */
export function measureLineHeat(line: Line, pack: HeatPack): Measured[] {
  const key = `${pack.bidPeriodStart}|${pack.bidPeriodDays}|${pack.base}`;
  const known = measuredByLine.get(line);
  if (known?.key === key) return known.pieces;
  const pieces = measure(line, pack);
  measuredByLine.set(line, { key, pieces });
  return pieces;
}

function measure(line: Line, pack: HeatPack): Measured[] {
  const clock = line.estimated ? null : baseClock(pack);
  if (!clock) return [];
  const out: Measured[] = [];
  // The same trips, a run of day trips a day at a time, in the same order as the Timeline's (`TimelineTrip.index`).
  lineByDay(line).trips.forEach((trip, index) => {
    if (!trip.zuluAnchor || trip.schedule.length === 0) return;
    const facts = tripFactsOf(trip);
    const timed = trip.schedule.flatMap((duty, i) => {
      const legs = duty.legs.filter((l) => l.depTimeZulu && l.arrTimeZulu);
      return legs.length ? [{ duty, i, legs }] : [];
    });
    timed.forEach(({ duty, i, legs }, k) => {
      const d = facts.duties[i];
      const start = Math.min(clock.fromAnchor(trip.zuluAnchor, duty.startMinutes), clock.at(legs[0].depTimeZulu));
      const end = clock.at(legs.at(-1)!.arrTimeZulu);
      const touched: number[] = [];
      for (let day = Math.floor(start / DAY); day <= Math.floor((end - 1) / DAY); day++) touched.push(day);
      const first = k === 0;
      const last = k === timed.length - 1;
      const operated = facts.operatedLegs;
      out.push({
        kind: "duty",
        start,
        end,
        trip: index,
        duty: i,
        report: d?.reportLocalMinute ?? null,
        legs: d?.operatedLegs ?? 0,
        deadheads: d?.deadheadLegs ?? 0,
        hours: d ? (d.end - d.start) / 60 : (end - start) / 60,
        nightMinutes: d?.deepNightMinutes ?? 0,
        credit: trip.creditHours > 0 && trip.tafbHours > 0 ? trip.creditHours / Math.max(1, Math.ceil(trip.tafbHours / 24 - 1e-9)) : null,
        standby: !!d?.standby && d.operatedLegs === 0,
        days: touched,
        tripStart: !first ? null : facts.front ? "deadhead" : operated[0]?.from === pack.base ? "in" : null,
        tripEnd:
          !last || trip.carriesIntoNextMonth
            ? null
            : facts.back
              ? "deadhead"
              : operated.at(-1)?.to === pack.base
                ? { release: operated.at(-1)!.arrLocalMinute }
                : null,
      });
      if (duty.layover) {
        const layover = facts.layovers.find((l) => l.start === duty.layover!.startMinutes);
        if (layover)
          out.push({
            kind: "layover",
            start: clock.fromAnchor(trip.zuluAnchor, duty.layover.startMinutes),
            end: clock.fromAnchor(trip.zuluAnchor, duty.layover.endMinutes),
            trip: index,
            duty: i,
            facts,
            layover,
            atDomicile: layover.city === pack.base,
          });
      }
    });
  });
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------------------------------------------------
// The pilot's reading: how much each factor counts for them, and the numbers they gave.

interface FactorRule {
  weight: number;
  /** The pilot's own numbers for it, in the factor's units. */
  shape?: CriterionShape;
  /** For a factor only the pilot can call good or bad: which they said. */
  good?: boolean;
  /** A dealbreaker a single piece can break, in the factor's units. */
  limit?: { op: "max" | "min"; value: number };
  /** One of the pilot's priorities is on it. */
  asked?: boolean;
}

/** What a priority says about a factor: which factor, and — where it's in the factor's own units — the pilot's numbers. */
interface PriorityReading {
  factor: HeatFactorId;
  /** The pilot's numbers, when the priority measures the same thing as the factor. */
  shape?: (c: Criterion) => CriterionShape | undefined;
  /** Its dealbreaker applies to a single piece. */
  limit?: boolean;
  /** For a two-sided factor: what a "more" reads as (true: they want it). */
  signed?: boolean;
}

const asIs = (c: Criterion) => c.shape;
/** "At least N" as a scale: N − 1 is fine, N as bad as it gets. */
const atLeast = (n: number): CriterionShape => ({ kind: "less", fineAt: n - 1, worstAt: n });

/** Every measure a pilot's priority can be on, and the factor it colours. Measures of a whole month (TAFB, trips) aren't pieces. */
const PRIORITY_FACTORS: Record<string, PriorityReading[]> = {
  earliestBaseReport: [{ factor: "report", shape: asIs, limit: true }, { factor: "commuteIn" }],
  earlyReports: [{ factor: "report" }],
  dutiesWithManyLegs: [{ factor: "legs", shape: (c) => atLeast(c.params?.n ?? 3) }],
  extraLegs: [{ factor: "legs" }],
  maxLegsInADuty: [{ factor: "legs", shape: asIs, limit: true }],
  avgLegsPerDuty: [{ factor: "legs", shape: asIs }],
  singleLegDutyShare: [{ factor: "legs" }],
  landings: [{ factor: "legs" }],
  deIcingExposure: [{ factor: "legs" }],
  longDuties: [{ factor: "dutyHours", shape: (c) => ({ kind: "less", fineAt: (c.params?.minHours ?? 12) - 2, worstAt: c.params?.minHours ?? 12 }) }],
  maxDutyHours: [{ factor: "dutyHours", shape: asIs, limit: true }],
  nightsWorked: [{ factor: "night" }],
  deepNightHours: [{ factor: "night" }],
  redEyeLegs: [{ factor: "night" }],
  redEyeFinishes: [{ factor: "night" }],
  dayFlyingShare: [{ factor: "night" }],
  longestNightStreak: [{ factor: "night" }],
  allNighterStreak: [{ factor: "night" }],
  backToBackRedEyes: [{ factor: "night" }],
  bodyClockScore: [{ factor: "night" }],
  hardestTripBodyClock: [{ factor: "night" }],
  nightHubTurns: [{ factor: "night" }, { factor: "atDomicile" }],
  nightHubTurnRuns: [{ factor: "night" }, { factor: "atDomicile" }],
  longestHubTurnRun: [{ factor: "night" }, { factor: "atDomicile" }],
  timezoneHoursCrossed: [{ factor: "night" }],
  creditHours: [{ factor: "credit" }],
  blockHours: [{ factor: "credit" }],
  creditPerDayAway: [{ factor: "credit" }],
  effectiveCreditPerDayAway: [{ factor: "credit" }],
  creditPerDayAwayFromHome: [{ factor: "credit" }],
  creditPerBlockHour: [{ factor: "credit" }],
  hotelStandbyDays: [{ factor: "standby", signed: true }],
  tripStandbyDays: [{ factor: "standby", signed: true }],
  standbyDaysByCity: [{ factor: "standby", signed: true }],
  baseStandbyDays: [{ factor: "standby", signed: true }],
  departureCommutes: [{ factor: "commuteIn" }, { factor: "commuteHome" }],
  baseCommutesNeeded: [{ factor: "commuteIn" }, { factor: "commuteHome" }],
  homeDepartures: [{ factor: "commuteIn" }],
  tripsJoinedFromHome: [{ factor: "commuteIn" }],
  frontDeadheadTrips: [{ factor: "commuteIn" }],
  fewestBackupFlights: [{ factor: "commuteIn" }],
  tripsShortOnBackups: [{ factor: "commuteIn" }],
  tripsEndingStraightHome: [{ factor: "commuteHome" }],
  backDeadheadTrips: [{ factor: "commuteHome" }],
  doubleDeadheadTrips: [{ factor: "commuteIn" }, { factor: "commuteHome" }],
  midTripDeadheads: [{ factor: "deadhead", signed: true }],
  latestBaseRelease: [{ factor: "commuteHome" }],
  longestTripHome: [{ factor: "commuteHome" }],
  avgLayoverHours: [{ factor: "layoverLength", shape: asIs }],
  layoversInRange: [{ factor: "layoverLength", shape: (c) => ({ kind: "range", min: c.params?.minHours ?? 30, max: c.params?.maxHours ?? 48 }) }],
  shortLayovers: [{ factor: "layoverLength", shape: (c) => ({ kind: "more", enoughAt: c.params?.maxHours ?? 24 }) }],
  longLayoverHours: [{ factor: "layoverLength" }],
  eatAndSleepLayovers: [{ factor: "layoverLength" }, { factor: "sleep" }],
  sleepableLayovers: [{ factor: "sleep" }],
  daytimeLayovers: [{ factor: "sleep" }],
  avgLayoverNightHours: [{ factor: "sleep", shape: asIs }],
  layoverValue: [{ factor: "city" }],
  layoverHoursInCities: [{ factor: "city" }],
  layoversInCities: [{ factor: "city" }],
  tripsTouchingCities: [{ factor: "city" }],
  layoverShareInRegions: [{ factor: "city" }],
  fullDaysInLikedCities: [{ factor: "city" }, { factor: "fullDays" }],
  layoverFullDays: [{ factor: "fullDays" }],
  internationalLayoverShare: [{ factor: "international", signed: true }],
  baseHotelNights: [{ factor: "atDomicile" }],
  hubTurns: [{ factor: "atDomicile" }],
  dayHubTurns: [{ factor: "atDomicile" }],
  restHotelHubTurns: [{ factor: "atDomicile" }],
  weekendDaysOff: [{ factor: "weekend" }],
  weekdaysOff: [{ factor: "weekdays" }],
  requestedDatesWorked: [{ factor: "dates", limit: true }],
};

/**
 * How much each factor counts with no priority behind it — what most pilots feel, enough to show without drowning out
 * what the pilot said. Factors only the pilot can call good or bad (international, hotel standby) and ones that need
 * their own say (dates, weekdays, commutes) start at nothing.
 */
const UNASKED: Record<HeatFactorId, number> = {
  report: 0.5,
  legs: 0.5,
  dutyHours: 0.4,
  night: 0.6,
  credit: 0.4,
  standby: 0,
  deadhead: 0.4,
  commuteIn: 0,
  commuteHome: 0,
  layoverLength: 0.5,
  sleep: 0.4,
  city: 0.6,
  fullDays: 0.3,
  international: 0,
  atDomicile: 0.3,
  weekend: 0,
  weekdays: 0,
  dates: 0,
};
/** With a pilot's reading, what they didn't mention counts this share of the above. */
const UNASKED_WITH_READING = 0.25;
/** A commuter's commute in and home counts this much with no priority on it. */
const COMMUTE_UNASKED = 0.5;
/** A layover outside the cities they like, for a pilot whose priorities are on those cities. */
const NOT_A_LIKED_CITY = 0.4;
/** A piece that breaks a dealbreaker is held at or below this. */
const DEALBREAKER_HEAT = 0.05;

/** A pilot's heat reading for one pack: the factors' rules, the pack's spread on each, and their city grades and dates. */
export interface HeatModel {
  rules: Record<HeatFactorId, FactorRule>;
  /** The pack's spread for each measured factor, for scoring the pilot's own numbers (`utilityOf`). */
  spreads: Partial<Record<HeatFactorId, { lo: number; hi: number }>>;
  params: MetricParams;
  commuter: boolean;
  /** Cities and regions a priority says the pilot wants (+1) or doesn't (−1), beyond their grades. */
  cityLeans: Map<string, number>;
  regionLeans: Map<string, number>;
}

const heatModels = new WeakMap<BidPack, Map<string, HeatModel>>();

/**
 * The heat reading for a pilot on a pack. `model` null: no interview yet, so only what most pilots feel. `grades`: their
 * city grades (`cityGradesOf`), when the reading doesn't carry them.
 */
export function heatModelOf(bidPack: BidPack, model: PilotModel | null, grades: MetricParams | null = null): HeatModel {
  let byPilot = heatModels.get(bidPack);
  if (!byPilot) heatModels.set(bidPack, (byPilot = new Map()));
  const key = JSON.stringify([model?.criteria.map((c) => [c.id, c.metric, c.weight, c.tier, c.confidence, c.shape, c.params, c.hardLimit]), model?.home, grades]);
  const known = byPilot.get(key);
  if (known) return known;

  const criteria = model?.criteria ?? [];
  const unasked = model && criteria.length ? UNASKED_WITH_READING : 1;
  const commuter = !!model?.home?.commuter && !model.home.airports.includes(bidPack.base);
  const rules = Object.fromEntries(
    (Object.keys(UNASKED) as HeatFactorId[]).map((id) => [id, { weight: UNASKED[id] * unasked + (commuter && (id === "commuteIn" || id === "commuteHome") ? COMMUTE_UNASKED * unasked : 0) }])
  ) as Record<HeatFactorId, FactorRule>;
  const cityLeans = new Map<string, number>();
  const regionLeans = new Map<string, number>();
  let params: MetricParams = { ...(model ? homeParams(model) : {}), ...(grades ?? {}), base: bidPack.base, bidPeriodStart: bidPack.bidPeriodStart };

  for (const c of criteria) {
    const readings = PRIORITY_FACTORS[c.metric];
    if (!readings) continue;
    const wants = c.shape.kind === "more" ? true : c.shape.kind === "less" ? false : undefined;
    for (const r of readings) {
      const rule = rules[r.factor];
      // A priority on two factors (commutes in and home) counts in full on each: each piece shows what it costs.
      rule.weight += criterionWeight(c);
      rule.asked = true;
      const shape = r.shape?.(c);
      if (shape && !rule.shape) rule.shape = shape;
      if (r.signed && wants !== undefined) rule.good = wants;
      if (r.limit && c.hardLimit && !rule.limit) rule.limit = c.hardLimit;
    }
    // What a priority's own cities, regions, dates and weekdays say.
    if (c.params?.cityScores) params = { ...params, cityScores: { ...c.params.cityScores, ...params.cityScores }, citySeasons: params.citySeasons ?? c.params.citySeasons, hotelScores: params.hotelScores ?? c.params.hotelScores, hotelAreas: params.hotelAreas ?? c.params.hotelAreas };
    if (wants !== undefined && (c.metric === "layoverHoursInCities" || c.metric === "layoversInCities" || c.metric === "tripsTouchingCities")) for (const city of c.params?.cities ?? []) cityLeans.set(city, wants ? 1 : -1);
    if (wants !== undefined && c.metric === "layoverShareInRegions") for (const region of c.params?.regions ?? []) regionLeans.set(region, wants ? 1 : -1);
    if (c.metric === "requestedDatesWorked" && c.params?.dates?.length) params = { ...params, dates: [...new Set([...(params.dates ?? []), ...c.params.dates])] };
    if (c.metric === "weekdaysOff" && c.params?.weekdays?.length) params = { ...params, weekdays: [...new Set([...(params.weekdays ?? []), ...c.params.weekdays])] };
  }
  // Two-sided factors with no say either way stay out.
  for (const id of ["standby", "international"] as const) if (rules[id].good === undefined) rules[id].weight = 0;
  if (!params.dates?.length) rules.dates.weight = 0;
  if (!params.weekdays?.length) rules.weekdays.weight = 0;

  // The pack's spread on each measured factor, for the pilot's own numbers and for credit (which has no fixed scale).
  const values: Partial<Record<HeatFactorId, number[]>> = {};
  const add = (id: HeatFactorId, v: number | null) => {
    if (v !== null && Number.isFinite(v)) (values[id] ??= []).push(v);
  };
  for (const line of bidPack.lines) {
    for (const p of measureLineHeat(line, bidPack)) {
      if (p.kind === "duty") {
        add("report", p.report);
        if (p.legs > 0) add("legs", p.legs);
        add("dutyHours", p.hours);
        add("credit", p.credit);
      } else if (p.kind === "layover") {
        add("layoverLength", p.layover.hours);
        add("sleep", p.layover.localNightHours);
      }
    }
  }
  const spreads: HeatModel["spreads"] = {};
  for (const [id, vs] of Object.entries(values) as [HeatFactorId, number[]][]) spreads[id] = spreadOf(vs, rules[id].shape ?? { kind: "more" });

  const out: HeatModel = { rules, spreads, params, commuter, cityLeans, regionLeans };
  byPilot.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rating: each piece's factors, then the piece.

/** A straight-line read between points (x ascending), held at the ends. */
function curve(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * What most pilots feel, on each factor's own scale. An 0400 report is as bad as reports get and one after 0900 as
 * good; a 10-hour layover is barely a rest and 30 hours or more a real one; an hour of night flying is a long
 * night.
 */
const USUAL: Partial<Record<HeatFactorId, [number, number][]>> = {
  // Minute of the day.
  report: [[0, 0.15], [240, 0], [300, 0.1], [360, 0.35], [420, 0.6], [480, 0.85], [540, 1], [1080, 1], [1260, 0.7], [1440, 0.4]],
  legs: [[1, 1], [2, 0.65], [3, 0.3], [4, 0.1], [5, 0]],
  dutyHours: [[6, 1], [9, 0.8], [11, 0.55], [13, 0.25], [15, 0]],
  // Minutes in the local small hours.
  night: [[0, 1], [30, 0.75], [90, 0.4], [180, 0.15], [300, 0]],
  layoverLength: [[8, 0], [11, 0.1], [14, 0.3], [18, 0.5], [24, 0.75], [30, 1], [48, 1], [72, 0.85]],
  // Hours of local night.
  sleep: [[0, 0.05], [3, 0.3], [5, 0.6], [6.5, 0.9], [8, 1]],
  fullDays: [[0, 0.35], [1, 0.85], [2, 1]],
  // Back at the domicile, minute of the day (the small hours run on past midnight): a late one makes a commute home hard.
  commuteHome: [[600, 0.6], [1080, 0.45], [1260, 0.25], [1380, 0.1], [1740, 0]],
};

/** A factor's heat for this pilot: their own numbers when they gave them, else the usual scale. */
function rated(m: HeatModel, id: HeatFactorId, value: number): number {
  const rule = m.rules[id];
  const spread = m.spreads[id];
  if (rule.shape && spread) return Math.min(1, Math.max(0, utilityOf(value, rule.shape, spread)));
  const usual = USUAL[id];
  if (usual) return curve(usual, value);
  if (spread) return Math.min(1, Math.max(0, utilityOf(value, { kind: "more" }, spread)));
  return 0.5;
}

const breaks = (limit: FactorRule["limit"], value: number) => !!limit && (limit.op === "max" ? value > limit.value : value < limit.value);
const clockText = (minute: number) => {
  const m = ((Math.round(minute) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const GRADE_WORDS: [number, string][] = [
  [0.75, "a city you love"],
  [0.01, "a city you like"],
  [-0.74, "a city you dislike"],
  [-1, "a city you avoid"],
];
const gradeWords = (grade: number) => GRADE_WORDS.find(([at]) => grade >= at)?.[1] ?? "a city you avoid";
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function dutyFactors(p: MeasuredDuty, m: HeatModel, pack: HeatPack): HeatFactor[] {
  const out: HeatFactor[] = [];
  const push = (id: HeatFactorId, heat: number, text: string, dealbreaker = false) => {
    const weight = m.rules[id].weight;
    if (weight > 0) out.push({ id, heat, weight, text, ...(dealbreaker ? { dealbreaker } : {}) });
  };
  if (p.standby) {
    const good = m.rules.standby.good;
    if (good !== undefined) push("standby", good ? 0.85 : 0.15, "Hotel standby");
  } else if (p.legs === 0 && p.deadheads > 0) {
    // Riding, paid, with nothing to fly: easy for most pilots — unless they said deadheads mid-trip are what they mind.
    if (p.report !== null) push("report", rated(m, "report", p.report), `Report ${clockText(p.report)}`);
    push("deadhead", m.rules.deadhead.good === false ? 0.2 : 0.8, "Deadhead only");
  } else {
    if (p.report !== null) push("report", rated(m, "report", p.report), `Report ${clockText(p.report)}`, p.tripStart === "in" && breaks(m.rules.report.limit, p.report));
    if (p.legs > 0) push("legs", rated(m, "legs", p.legs), plural(p.legs, "leg"), breaks(m.rules.legs.limit, p.legs));
    if (p.legs > 0) push("dutyHours", rated(m, "dutyHours", p.hours), `${formatHoursValue(p.hours)} on duty`, breaks(m.rules.dutyHours.limit, p.hours));
    if (p.legs > 0) push("night", rated(m, "night", p.nightMinutes), p.nightMinutes > 0 ? `${formatHoursValue(p.nightMinutes / 60)} of night flying` : "No night flying");
  }
  if (p.credit !== null) push("credit", rated(m, "credit", p.credit), `Trip pays ${formatHoursValue(p.credit)} a day away`);
  if (m.commuter && p.tripStart) push("commuteIn", p.tripStart === "deadhead" ? 0.85 : 0.25, p.tripStart === "deadhead" ? "Starts with a deadhead" : "Commute in to the domicile");
  if (m.commuter && p.tripEnd) {
    if (p.tripEnd === "deadhead") push("commuteHome", 0.85, "Ends with a deadhead");
    else if (p.tripEnd.release !== null) {
      // The small hours belong to the night before (as `latestBaseRelease`): 0230 is later than 2330.
      const release = p.tripEnd.release < 5 * 60 ? p.tripEnd.release + DAY : p.tripEnd.release;
      push("commuteHome", rated(m, "commuteHome", release), `Back at the domicile ${clockText(release)}`);
    }
  }
  calendarFactors(p.days, pack, m, push);
  return out;
}

function layoverFactors(p: MeasuredLayover, m: HeatModel): HeatFactor[] {
  const out: HeatFactor[] = [];
  const push = (id: HeatFactorId, heat: number, text: string) => {
    const weight = m.rules[id].weight;
    if (weight > 0) out.push({ id, heat, weight, text });
  };
  const l = p.layover;
  push("layoverLength", rated(m, "layoverLength", l.hours), `${Math.round(l.hours)}h in ${l.city}`);
  if (p.atDomicile) {
    push("atDomicile", 0.15, "Layover at the domicile");
    return out;
  }
  if (l.localNightHours !== null) push("sleep", rated(m, "sleep", l.localNightHours), `${Math.round(l.localNightHours)}h of local night`);
  const grade = layoverScore(p.facts, l, m.params);
  const lean = m.cityLeans.get(l.city) ?? m.regionLeans.get(l.region) ?? 0;
  // A city's grade says it outright; a priority on the city only that it's one they want or don't. A city they love
  // counts in full on a layover long enough to enjoy it (a day); on a short one, half of it.
  const city = grade !== 0 ? grade * (grade > 0 ? Math.min(1, Math.max(0.5, l.hours / 24)) : 1) : lean * 0.7;
  if (city !== 0) push("city", (city + 1) / 2, grade !== 0 ? `${l.city}, ${gradeWords(grade)}` : `${l.city}, ${lean > 0 ? "a city you want" : "a city you'd rather not have"}`);
  // For a pilot whose priorities are on the cities they like, a layover anywhere else is time not spent in one: it runs
  // cool. Left out, line 1026 — the ex-pilot's month of Toronto layovers, low on his list for exactly that — read all hot.
  else if (m.rules.city.asked) push("city", NOT_A_LIKED_CITY, `${l.city}, not a city you like`);
  // A full day only means something on a layover long enough to hold one.
  if (l.localStartMinute !== null && l.hours >= 24) {
    const days = l.fullDays;
    push("fullDays", l.barelyFullDay && days === 1 ? 0.7 : rated(m, "fullDays", days), days === 0 ? "No full day off there" : `${plural(days, "full day")} in ${l.city}${l.barelyFullDay ? ", just barely" : ""}`);
  }
  const good = m.rules.international.good;
  if (l.international && good !== undefined) push("international", good ? 0.85 : 0.15, "International layover");
  return out;
}

/** A duty on a weekend, on one of the pilot's weekdays or on a date they asked to have off — for a pilot who said so. */
function calendarFactors(days: number[], pack: HeatPack, m: HeatModel, push: (id: HeatFactorId, heat: number, text: string, dealbreaker?: boolean) => void) {
  const start = pack.bidPeriodStart;
  if (!start) return;
  const weekday = (i: number) => DateTime.fromISO(start, { zone: "utc" }).plus({ days: i }).weekday;
  const weekend = days.filter((i) => weekday(i) >= 6);
  if (weekend.length) push("weekend", 0.15, `Works ${[...new Set(weekend.map((i) => WEEKDAY_NAMES[weekday(i) - 1]))].join(" and ")}`);
  const wanted = m.params.weekdays ?? [];
  const onWanted = [...new Set(days.map(weekday).filter((wd) => wanted.includes(wd)))].sort((a, b) => a - b);
  if (onWanted.length) push("weekdays", 0.1, `Works ${onWanted.map((wd) => WEEKDAY_NAMES[wd - 1]).join(" and ")}`);
  const dates = m.params.dates ?? [];
  const onDates = days.map((i) => dateOfDayIndex(start, i)).filter((d) => dates.includes(d));
  if (onDates.length) {
    const said = onDates.map((d) => DateTime.fromISO(d).toFormat("LLL d")).join(", ");
    push("dates", 0, `Works ${said}, a date you asked to have off`, !!m.rules.dates.limit);
  }
}

/** A piece's heat: its factors' weighted mean, held cold when one breaks a dealbreaker. */
function pieceHeat(factors: HeatFactor[]): number {
  const w = factors.reduce((a, f) => a + f.weight, 0);
  if (w <= 0) return 0.5;
  const mean = factors.reduce((a, f) => a + f.heat * f.weight, 0) / w;
  return factors.some((f) => f.dealbreaker) ? Math.min(mean, DEALBREAKER_HEAT) : mean;
}

/** A line's Heat Map for a pilot (`heatModelOf`). */
export function lineHeat(line: Line, pack: HeatPack, m: HeatModel): LineHeat {
  const pieces: HeatPiece[] = measureLineHeat(line, pack).map((p) => {
    const factors = p.kind === "duty" ? dutyFactors(p, m, pack) : layoverFactors(p, m);
    factors.sort((a, b) => b.heat - a.heat);
    return { kind: p.kind, start: p.start, end: p.end, trip: p.trip, duty: p.duty, heat: pieceHeat(factors), factors };
  });

  // Shares and means by time inside the bid period: what the strip shows as colour.
  const until = pack.bidPeriodDays * DAY;
  const span = (p: HeatPiece) => Math.max(0, Math.min(p.end, until) - Math.max(p.start, 0));
  const trips = new Map<number, { heat: number; minutes: number }>();
  let total = 0;
  let weighted = 0;
  const share = { hot: 0, mild: 0, cold: 0 };
  for (const p of pieces) {
    // A trip's own heat counts all of it, carried into next month or not.
    const whole = Math.max(0, p.end - p.start);
    const sum = trips.get(p.trip) ?? { heat: 0, minutes: 0 };
    trips.set(p.trip, { heat: sum.heat + p.heat * whole, minutes: sum.minutes + whole });
    const t = span(p);
    if (t <= 0 || p.factors.length === 0) continue;
    total += t;
    weighted += p.heat * t;
    share[p.heat >= HOT_AT ? "hot" : p.heat < COLD_BELOW ? "cold" : "mild"] += t;
  }
  return {
    pieces,
    trips: new Map([...trips].map(([k, v]) => [k, v.minutes > 0 ? v.heat / v.minutes : 0.5])),
    heat: total > 0 ? weighted / total : 0.5,
    share: total > 0 ? { hot: share.hot / total, mild: share.mild / total, cold: share.cold / total } : share,
  };
}

/** One trip's heat: its pieces by duty period, its heat and its time's share hot, mild and cold. */
export interface TripHeat {
  heat: number;
  share: HeatShare;
  duty: Map<number, HeatPiece>;
  layover: Map<number, HeatPiece>;
}

/** A line's heat trip by trip, by `TimelineTrip.index` (the place in `lineByDay(line).trips`). */
export function tripHeatsOf(h: LineHeat): Map<number, TripHeat> {
  const out = new Map<number, TripHeat & { minutes: HeatShare }>();
  for (const p of h.pieces) {
    let t = out.get(p.trip);
    if (!t) out.set(p.trip, (t = { heat: h.trips.get(p.trip) ?? 0.5, share: { hot: 0, mild: 0, cold: 0 }, minutes: { hot: 0, mild: 0, cold: 0 }, duty: new Map(), layover: new Map() }));
    (p.kind === "duty" ? t.duty : t.layover).set(p.duty, p);
    if (p.factors.length) t.minutes[p.heat >= HOT_AT ? "hot" : p.heat < COLD_BELOW ? "cold" : "mild"] += Math.max(0, p.end - p.start);
  }
  return new Map(
    [...out].map(([k, { minutes, ...t }]) => {
      const sum = minutes.hot + minutes.mild + minutes.cold;
      return [k, { ...t, share: sum > 0 ? { hot: minutes.hot / sum, mild: minutes.mild / sum, cold: minutes.cold / sum } : minutes }];
    })
  );
}

const PIECE_NAME: Record<HeatPieceKind, string> = { duty: "Duty period", layover: "Layover" };

/** What a piece is and why it's as hot or cold as it is: "Layover: 6h in CDG · 4h of local night". */
export function heatPieceText(p: HeatPiece): string {
  return `${PIECE_NAME[p.kind]}: ${p.factors.map((f) => f.text).join(" · ")}`;
}

/** Each piece's name alone, "Duty period" or "Layover". */
export const heatPieceName = (p: HeatPiece) => PIECE_NAME[p.kind];
