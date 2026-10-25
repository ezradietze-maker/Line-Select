import { DateTime } from "luxon";
import { dateOfDayIndex } from "@/lib/days-off-pattern";
import { tripDutyPeriods } from "@/lib/duty-periods";
import { formatValue } from "@/lib/brain/describe";
import { METRICS_BY_ID, type MetricDef, type MetricParams } from "@/lib/metrics/catalog";
import { measure, prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import type { TripFacts } from "@/lib/metrics/trip-facts";
import {
  BEYOND_BAD,
  criterionWeight,
  HARD_LIMIT_CAP,
  homeParams,
  MAX_SHARE_RULED_OUT,
  scorePackV2,
  SHORTFALL_POWER,
  spreadOf,
  utilityOf,
  type CriterionResult,
  type ScoreOptions,
  type V2LineScore,
} from "@/lib/scoring-v2/score";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { Criterion, CriterionShape, PilotModel } from "@/types/pilot-model";

/**
 * Trip scores: every trip in the pack scored 0–100 against the same pilot model that ranks the lines — the same
 * criteria, weights, anchors, dealbreakers and maths — so every answer in the interview, every line choice and every
 * edit to their priorities moves a trip's score the way it moves a line's.
 *
 * A trip isn't a small line, though, so each measurement is translated into what it honestly says about one trip
 * (`tripReadingOf`):
 *
 * - **as is** — what a trip has in itself, in the same units as the line's number: pay per day away, its length, legs
 *   per duty, its body-clock stars, its layovers' length, how late it gets back to base. A line's "longest trip" or
 *   "worst body clock" is just this trip's own value.
 * - **its own count** — what a line adds up over the month (commutes, red-eye finishes, nights worked, hours in cities
 *   they love) is the trip's own count, set against the pack's other trips. Where the pilot gave a monthly number
 *   ("three commutes is fine, five is too many"), it keeps its meaning by its place in the pack: the share of lines it
 *   rules good or bad becomes the same share of trips. (Read as a month of trips like it instead, a short trip that
 *   needs a commute sank to the floor whatever else it had — graders reading pilots' own words disagreed, Oct 2026: a
 *   pilot sizes a trip up as a unit.)
 * - **from its own dates** — weekend days and chosen weekdays by the share of the calendar it takes (a two-day trip
 *   over a weekend takes all of it); a date they must have off, literally.
 * - **not something a trip has** — days off and blocks of them belong to how a line strings trips together; one trip
 *   can't show them, so they sit out of its score rather than counting as average.
 *
 * Where a pilot gave no anchor, the scale comes from the pack's trips, not its lines: trips spread much further than
 * lines (a line averages its good and bad trips), and a trip's score should place it among trips. A dealbreaker caps a
 * trip only when the trip itself can break it — a 6-day trip against "nothing over 5 days", a date they need off — never
 * a monthly limit, which one trip can't break on its own.
 */

export type TripReading = "asIs" | "count" | "dates" | "none";

/**
 * On one trip, joining it from home on a deadhead and the commute that saves are one fact read twice. Lines weigh both
 * in full (over a month they part ways); on a trip, joining from home keeps this share of its weight when commutes are
 * weighed too — what it adds beyond the commute saved. Counted twice, a double-deadhead trip outran four nights of hub
 * turns against the ex-pilot's own pick (Oct 2026: his trip picks 121 → 125 of 125 over 25 readings of his interview,
 * with his sort, the simulated pilots and the trip bench unchanged).
 */
const JOINED_BEYOND_COMMUTE = 0.25;
const COMMUTE_MEASURES = new Set(["departureCommutes", "baseCommutesNeeded"]);

/** How each line-level measurement reads on one trip. Trip-level ones follow their aggregation (see `tripReadingOf`). */
const LINE_METRIC_READING: Record<string, TripReading> = {
  // Rates, shares, averages and extremes: the trip's own value is in the line's units.
  creditPerDayAway: "asIs",
  effectiveCreditPerDayAway: "asIs",
  creditPerDayAwayFromHome: "asIs",
  fewestBackupFlights: "asIs",
  longestTripHome: "asIs",
  singleLegDutyShare: "asIs",
  avgLegsPerDuty: "asIs",
  earliestBaseReport: "asIs",
  latestBaseRelease: "asIs",
  avgLayoverHours: "asIs",
  avgLayoverNightHours: "asIs",
  internationalLayoverShare: "asIs",
  layoverShareInRegions: "asIs",
  worstCircadianStars: "asIs",
  avgCircadianStars: "asIs",
  longestNightStreak: "asIs",
  dayFlyingShare: "asIs",
  // Counts over the month.
  creditHours: "count",
  tafbHours: "count",
  homeAwayHours: "count",
  tripsJoinedFromHome: "count",
  tripsEndingStraightHome: "count",
  tripsShortOnBackups: "count",
  tripCount: "count",
  // A trip on its own is one departure; its commutes and nights at base are its own, as if flown alone.
  homeDepartures: "count",
  // A trip's own hub turns; a week of night hub turns inside one trip counts as on a line.
  nightHubTurnRuns: "count",
  nightHubTurns: "count",
  restHotelHubTurns: "count",
  dayHubTurns: "count",
  hubTurns: "count",
  longestHubTurnRun: "asIs",
  departureCommutes: "count",
  baseHotelNights: "count",
  dutyPeriods: "count",
  landings: "count",
  nightsWorked: "count",
  tripStandbyDays: "count",
  standbyDaysByCity: "count",
  baseStandbyDays: "count",
  // The calendar, from the trip's own dates.
  requestedDatesWorked: "dates",
  weekdaysOff: "dates",
  weekendDaysOff: "dates",
  // How a line strings its trips together.
  daysOff: "none",
  longestDaysOffBlock: "none",
  shortHomeGaps: "none",
  realBreakNights: "none",
  nightsHome: "none",
  longestHomeStretch: "none",
  singleDaysOff: "none",
};

/** Line-level measurements that read the line's printed totals rather than its trips: the trip's own figure instead. */
const FROM_TRIP: Record<string, (f: TripFacts) => number | null> = {
  creditHours: (f) => f.creditHours,
  tafbHours: (f) => f.tafbHours,
  tripCount: () => 1,
  homeDepartures: () => 1,
  dutyPeriods: (f) => tripDutyPeriods(f.trip),
  landings: (f) => f.trip.landings,
};

export function tripReadingOf(def: MetricDef): TripReading | undefined {
  if (def.trip) return def.trip.aggregate === "sum" ? "count" : "asIs";
  return LINE_METRIC_READING[def.id];
}

/** A trip as flown on its dates — the same pairing on the same day is the same trip in every line that has it. */
export function tripKey(trip: Trip): string {
  return `${trip.id}@${trip.startDayIndex ?? "?"}`;
}

export interface TripCriterionResult extends CriterionResult {
  reading: TripReading;
  raw: number | null;
}

export interface TripScore {
  key: string;
  /** 0–100, the trip's score for this pilot; null for a trip with no real schedule to measure. */
  score: number;
  uncapped: number;
  /** Every criterion that applies to a trip and its pull. `value` is what's scored; `raw` is the trip's own figure — its commutes, its weekend days worked — for showing the pilot. */
  results: TripCriterionResult[];
  /** Criteria a single trip can't show (days off and how they fall). */
  notApplicable: { criterionId: string; label: string }[];
  violations: { criterionId: string; label: string; value: number; limit: number; op: "max" | "min" }[];
}

interface Instance {
  key: string;
  facts: TripFacts;
  line: Line;
}

/** Days a line in this pack typically works — what a trip's share of the calendar is scaled to. */
function typicalWorkDays(bidPack: BidPack): number {
  const worked = bidPack.lines.filter((l) => !l.estimated).map((l) => bidPack.bidPeriodDays - l.daysOff).filter((d) => d > 0).sort((a, b) => a - b);
  return worked.length ? worked[Math.floor(worked.length / 2)] : Math.max(1, Math.round(bidPack.bidPeriodDays / 2));
}

/** The bid-period days a trip works, by index — null when its dates aren't known. */
function workedDays(trip: Trip): number[] | null {
  if (trip.startDayIndex === null || trip.startDayIndex === undefined) return null;
  return Array.from({ length: Math.max(1, trip.days) }, (_, i) => trip.startDayIndex! + i);
}

interface Measured {
  /** What's scored, in the line's units. */
  value: number;
  /** The trip's own figure. */
  raw: number;
}

function datesReading(def: MetricDef, f: TripFacts, pack: PackMetrics, p: MetricParams, workDays: number): Measured | null {
  const start = pack.ctx.bidPeriodStart;
  const days = workedDays(f.trip);
  if (!start || !days) return null;
  const weekday = (i: number) => DateTime.fromISO(start, { zone: "utc" }).plus({ days: i }).weekday;
  const inPeriod = Array.from({ length: pack.ctx.bidPeriodDays }, (_, i) => i);
  // "Days off on these weekdays", for a month of trips like this: the month's such days, less the share this trip works.
  const offOn = (wanted: (wd: number) => boolean): Measured => {
    const total = inPeriod.filter((i) => wanted(weekday(i))).length;
    const worked = days.filter((i) => wanted(weekday(i))).length;
    return { value: Math.max(0, total - (worked * workDays) / Math.max(1, f.trip.days)), raw: worked };
  };
  switch (def.id) {
    case "requestedDatesWorked": {
      // Literal: a date they must have off that this trip works.
      if (!p.dates?.length) return null;
      const n = p.dates.filter((d) => days.some((i) => dateOfDayIndex(start, i) === d)).length;
      return { value: n, raw: n };
    }
    case "weekendDaysOff":
      return offOn((wd) => wd >= 6);
    case "weekdaysOff":
      return p.weekdays?.length ? offOn((wd) => p.weekdays!.includes(wd)) : null;
    default:
      return null;
  }
}

/**
 * A count criterion's anchors, moved from lines to trips by their place in the pack: "five commutes is too many", when
 * that's worse than 70% of lines, becomes the count worse than 70% of trips. Shapes without anchors are unchanged.
 */
function countShapeForTrips(c: Criterion, bidPack: BidPack, pack: PackMetrics, home: MetricParams, tripValues: (number | null)[]): CriterionShape {
  const shape = c.shape;
  const anchored = (shape.kind === "less" && (shape.fineAt !== undefined || shape.worstAt !== undefined)) || (shape.kind === "more" && shape.enoughAt !== undefined);
  if (!anchored) return shape;
  const lines = bidPack.lines.map((l) => measure(c.metric, l, pack, { ...home, ...c.params })).filter((v): v is number => v !== null);
  const trips = tripValues.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!lines.length || !trips.length) return shape;
  const share = (x: number) => lines.filter((v) => v <= x).length / lines.length;
  // The trip count at that share, read between whole numbers: most trips have the same small count (two commutes), so a
  // plain quantile lands on it for most shares — "four commutes a month is fine" would make every trip's two fine, and
  // a trip that needs one commute no better than one that needs two.
  const steps = [...new Set(trips)].map((v) => ({ v, at: trips.filter((t) => t <= v).length / trips.length }));
  const atShare = (q: number) => {
    const k = steps.findIndex((x) => x.at >= q);
    if (k <= 0) return steps[Math.max(0, k)].v;
    const lo = steps[k - 1];
    const hi = steps[k];
    return lo.v + ((q - lo.at) / (hi.at - lo.at)) * (hi.v - lo.v);
  };
  const move = (x: number | undefined) => (x === undefined ? undefined : atShare(share(x)));
  // Trip counts are small whole numbers, so two anchors can land on the same count: keep the bad end, and let the pack's
  // best trip set the good end rather than flattening the scale.
  if (shape.kind === "less") {
    const worstAt = move(shape.worstAt);
    let fineAt = move(shape.fineAt);
    if (fineAt !== undefined && worstAt !== undefined && worstAt <= fineAt) fineAt = undefined;
    return { kind: "less", ...(fineAt !== undefined ? { fineAt } : {}), ...(worstAt !== undefined && worstAt > trips[0] ? { worstAt } : {}) };
  }
  if (shape.kind === "more") {
    const enoughAt = move(shape.enoughAt);
    return { kind: "more", ...(enoughAt !== undefined && enoughAt > trips[0] ? { enoughAt } : {}) };
  }
  return shape;
}

/** One criterion's measurement on one trip, in the line's units; undefined when a trip can't show it at all. */
function measureTrip(def: MetricDef, inst: Instance, pack: PackMetrics, p: MetricParams, workDays: number): Measured | null | undefined {
  const reading = tripReadingOf(def);
  if (!reading || reading === "none") return undefined;
  const f = inst.facts;
  if (reading === "dates") return datesReading(def, f, pack, p, workDays);
  let raw: number | null;
  if (def.trip) raw = def.trip.measure(f, p);
  else if (FROM_TRIP[def.id]) raw = FROM_TRIP[def.id](f);
  else raw = def.line ? def.line(inst.line, [f], pack.ctx, p) : null;
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  return { value: raw, raw };
}

/**
 * Every trip in the pack, scored for this pilot, by `tripKey`. Trips with no real schedule (an estimated line's) have no
 * entry. Pass the same `pack` and `flights` the line ranking uses.
 */
export function scoreTripsV2(bidPack: BidPack, model: PilotModel, options: ScoreOptions = {}): Map<string, TripScore> {
  const pack = options.pack ?? prepareMetrics(bidPack);
  if (options.travel) pack.ctx.travel = options.travel;
  if (options.flights) pack.ctx.flights = options.flights;
  const out = new Map<string, TripScore>();
  const criteria = model.criteria.filter((c) => METRICS_BY_ID.has(c.metric));
  if (!criteria.length) return out;

  // Each distinct trip once.
  const seen = new Map<string, Instance>();
  for (const line of bidPack.lines) {
    if (line.estimated) continue;
    (pack.factsByLine.get(line.id) ?? []).forEach((facts) => {
      if (facts.trip.schedule.length === 0) return;
      const key = tripKey(facts.trip);
      if (!seen.has(key)) seen.set(key, { key, facts, line });
    });
  }
  const trips = [...seen.values()];
  if (!trips.length) return out;

  const workDays = typicalWorkDays(bidPack);
  const home = homeParams(model);
  const defs = criteria.map((c) => METRICS_BY_ID.get(c.metric)!);
  const applies = defs.map((d) => {
    const r = tripReadingOf(d);
    return !!r && r !== "none";
  });
  const scored: { c: Criterion; ci: number }[] = criteria.flatMap((c, ci) => (applies[ci] ? [{ c, ci }] : []));
  const notApplicable = criteria.filter((_, ci) => !applies[ci]).map((c) => ({ criterionId: c.id, label: c.label }));

  const measured = scored.map(({ c, ci }) => trips.map((t) => measureTrip(defs[ci], t, pack, { ...defs[ci].defaults, ...home, ...c.params, base: pack.ctx.base }, workDays) ?? null));
  const values = measured.map((ms) => ms.map((m) => m?.value ?? null));
  const shapes = scored.map(({ c, ci }, k) => (tripReadingOf(defs[ci]) === "count" ? countShapeForTrips(c, bidPack, pack, home, values[k]) : c.shape));
  const spreads = scored.map((_, k) => spreadOf(values[k], shapes[k]));
  // On a trip, each priority counts as on a line, times what the pilot's own trip choices taught (see `fitTripWeights`) —
  // and joining from home only for what it adds beyond the commute it saves, when commutes count too.
  const weighsCommutes = scored.some(({ c }) => COMMUTE_MEASURES.has(c.metric));
  const weights = scored.map(({ c }) => criterionWeight(c) * (model.tripWeights?.[c.id] ?? 1) * (weighsCommutes && c.metric === "tripsJoinedFromHome" ? JOINED_BEYOND_COMMUTE : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const beyond = options.beyondBad ?? BEYOND_BAD;
  const utilities = scored.map((_, k) => values[k].map((v) => (v === null ? 0.5 : utilityOf(v, shapes[k], spreads[k], beyond))));
  const meanUtility = utilities.map((us) => us.reduce((a, b) => a + b, 0) / Math.max(1, us.length));
  // A dealbreaker caps a trip only when the trip can break it by itself — its own length, its worst duty, a date — and,
  // as for lines, not when it would rule out most of the pack's trips (then it's misread, and its weight still counts).
  const enforced = scored.map(({ c, ci }, k) => {
    if (!c.hardLimit) return false;
    const reading = tripReadingOf(defs[ci]);
    if (c.metric === "requestedDatesWorked") return true;
    if (reading !== "asIs") return false;
    const measured = values[k].filter((v): v is number => v !== null);
    const broken = measured.filter((v) => (c.hardLimit!.op === "max" ? v > c.hardLimit!.value : v < c.hardLimit!.value)).length;
    return measured.length === 0 || broken / measured.length <= MAX_SHARE_RULED_OUT;
  });

  trips.forEach((t, ti) => {
    const results = scored.map(({ c, ci }, k) => {
      const u = utilities[k][ti];
      const w = values[k][ti] === null ? weights[k] / 2 : weights[k];
      return {
        criterionId: c.id,
        label: c.label,
        metric: c.metric,
        value: values[k][ti],
        unit: defs[ci].unit,
        utility: u,
        weight: w,
        contribution: ((u - meanUtility[k]) * weights[k] * 100) / totalWeight,
        reading: tripReadingOf(defs[ci])!,
        raw: measured[k][ti]?.raw ?? null,
      };
    });
    const w = results.reduce((a, r) => a + r.weight, 0) || 1;
    const p = options.power ?? SHORTFALL_POWER;
    const shortfall = Math.pow(results.reduce((a, r) => a + r.weight * Math.pow(1 - r.utility, p), 0) / w, 1 / p);
    const uncapped = (1 - shortfall) * 100;
    const violations = scored.flatMap(({ c }, k) => {
      const v = values[k][ti];
      if (!c.hardLimit || v === null || !enforced[k]) return [];
      const broken = c.hardLimit.op === "max" ? v > c.hardLimit.value : v < c.hardLimit.value;
      return broken ? [{ criterionId: c.id, label: c.label, value: v, limit: c.hardLimit.value, op: c.hardLimit.op }] : [];
    });
    // Past the bad end of a scale utility can dip below zero (so 10 commutes still ranks below 7); a score can't.
    const score = Math.max(0, violations.length ? uncapped * HARD_LIMIT_CAP : uncapped);
    out.set(t.key, { key: t.key, score: Math.round(score * 10) / 10, uncapped, results, notApplicable, violations });
  });
  return out;
}

/** A criterion's figure on one trip, the way a pilot would say it: "2 commutes on this trip", "works 2 weekend days", "back at base 23:10". */
export function tripValueText(r: TripCriterionResult): string | null {
  const def = METRICS_BY_ID.get(r.metric);
  if (!def || r.raw === null) return null;
  if (r.reading === "dates") {
    const n = Math.round(r.raw);
    if (r.metric === "weekendDaysOff") return n === 0 ? "no weekend days" : `works ${n} weekend ${n === 1 ? "day" : "days"}`;
    if (r.metric === "weekdaysOff") return n === 0 ? "keeps your days free" : `works ${n} of your days`;
    return n === 0 ? "keeps your dates free" : `works ${n} of your dates`;
  }
  if (r.metric === "earliestBaseReport") return `reports at base ${formatValue(r.raw, def)}`;
  if (r.metric === "latestBaseRelease") return `back at base ${formatValue(r.raw, def)}`;
  // Something a trip either is or isn't (ends on a red-eye, can be shortened by a day): yes or no.
  if (r.reading === "count" && def.unit === "trips") return r.raw >= 1 ? "yes" : "no";
  // A count sits next to a label that may carry a monthly number ("credit 76 or more"): say whose number this is.
  return r.reading === "count" && def.unit !== "weighted hours" ? `${formatValue(r.raw, def)} on this trip` : formatValue(r.raw, def);
}

/**
 * Once a pilot has graded trips (their trip weights are fitted), lines and trips work together two ways:
 *
 * - What the trip grades taught carries over to the line weights in part (`TRIP_LESSONS` of each trip factor, on a log
 *   scale): a pilot whose grades say red-eye finishes count for more on a trip probably minds them on a line too.
 * - Each line's score leans on how good its own trips are for them (`TRIP_LEAN`), so a line built from trips they'd
 *   trade away can't sit at the top on its totals alone.
 *
 * Set on the ex-pilot's own sort first (Oct 22 2026, with his five real trip picks, across his five readings): no lean
 * 95.2%, 5% 95.8%, 15% 96.1% (full order 83.4%, its best), 20% 96.3% (full order 83.2%), 25% 96.1% — 15–20% is one
 * plateau, and 15% costs a simulated commuter less (line agreement 0.820 → 0.808; 20%: 0.799), while helping a
 * simulated local pilot (0.925 → 0.938) and leaving another flat. Before a pilot has graded trips, leaning on them
 * only made lines worse — trip scores are then just the line weights read trip by trip.
 */
export const TRIP_LESSONS = 0.25;
export const TRIP_LEAN = 0.15;

/** The pilot's lines with their trip grades taken into account (see `TRIP_LESSONS`, `TRIP_LEAN`), best first. */
export function rankLinesWithTrips(bidPack: BidPack, model: PilotModel, options: ScoreOptions = {}): V2LineScore[] {
  const pack = options.pack ?? prepareMetrics(bidPack);
  const tw = model.tripWeights;
  if (!tw || !Object.keys(tw).length) return scorePackV2(bidPack, model, { ...options, pack }).sort((a, b) => b.score - a.score || a.lineNumber.localeCompare(b.lineNumber));
  const taught: PilotModel = { ...model, tripWeights: undefined, criteria: model.criteria.map((c) => ({ ...c, weight: c.weight * (tw[c.id] ?? 1) ** TRIP_LESSONS })) };
  const lines = scorePackV2(bidPack, taught, { ...options, pack });
  const trips = scoreTripsV2(bidPack, model, { ...options, pack });
  for (const s of lines) {
    const line = bidPack.lines.find((l) => l.id === s.lineId);
    const ts = (line?.trips ?? []).flatMap((t) => {
      const x = trips.get(tripKey(t));
      return x ? [{ score: x.score, days: Math.max(1, t.days) }] : [];
    });
    if (!ts.length) continue;
    const days = ts.reduce((a, t) => a + t.days, 0);
    const tripMean = ts.reduce((a, t) => a + t.score * t.days, 0) / days;
    s.uncapped = (1 - TRIP_LEAN) * s.uncapped + TRIP_LEAN * tripMean;
    s.score = Math.round((s.violations.length ? s.uncapped * HARD_LIMIT_CAP : s.uncapped) * 10) / 10;
  }
  return lines.sort((a, b) => b.score - a.score || a.lineNumber.localeCompare(b.lineNumber));
}
