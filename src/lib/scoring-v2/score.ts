import { METRICS_BY_ID, type MetricDef, type MetricParams } from "@/lib/metrics/catalog";
import { measure, prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import type { TravelTimeProvider } from "@/lib/metrics/home-travel";
import { TIER_WEIGHT, type Criterion, type CriterionShape, type PilotModel } from "@/types/pilot-model";
import type { BidPack } from "@/types/bidpack";

/**
 * Scoring v2: every line scored against the pilot model, criterion by
 * criterion, in the metric library's real units.
 *
 * - Only the pilot's own criteria count. Nothing he never mentioned dilutes
 *   what he did — the flaw in v1, where a dozen untouched dimensions each
 *   pulled every line toward the middle.
 * - Each criterion's shape decides what "good" is: more, less, a sweet spot,
 *   a range, or a cost per occurrence — so "avoid three-leg duties" and
 *   "36-hour layovers" score the way he means them.
 * - Where a pilot gave no anchor ("more is better"), the pack's own spread
 *   sets the scale: its real best at the good end, the 5% mark at the bad end.
 * - A hard limit caps the line, like a dealbreaker.
 * - Every score explains itself: each criterion's real value and how much
 *   it moved this line against the pack's average.
 */

export const HARD_LIMIT_CAP = 0.35;
/** A hard limit that would rule out more than this share of the pack's lines doesn't cap (see `scorePackV2`)… */
export const MAX_SHARE_RULED_OUT = 0.45;
/** …unless it's one a pilot means literally whatever it rules out. */
const LITERAL_LIMITS = new Set(["requestedDatesWorked"]);

/**
 * Shortfalls combine as a weighted root-mean-square: chosen on the eval panel (Oct 2026), where it beat a plain average
 * with every brain model and gained most on the real pilot's interview — lines that badly miss a top priority sink
 * instead of being rescued by small wins elsewhere.
 */
export const SHORTFALL_POWER = 2;

/** How fast utility keeps falling past the bad end of a scale (see `utilityOf`). 0.25: best on the Oct 13 2026 traces (70 brain reads) and the eval panel; 0 = it stops at zero. */
export const BEYOND_BAD = 0.25;

export interface CriterionResult {
  criterionId: string;
  label: string;
  metric: string;
  value: number | null;
  unit: string;
  /** 0–1: how well this line satisfies the criterion. */
  utility: number;
  weight: number;
  /** Points this criterion moved the line's score, relative to the pack's average line. */
  contribution: number;
}

export interface V2LineScore {
  lineId: string;
  lineNumber: string;
  score: number;
  /** Score before any hard-limit cap. */
  uncapped: number;
  results: CriterionResult[];
  violations: { criterionId: string; label: string; value: number; limit: number; op: "max" | "min" }[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The scale a criterion is scored on where the pilot gave no anchor: the good end is the real best measured — exactly
 * where a top priority has to tell things apart — while the bad end stops at the 5% mark, so one terrible outlier can't
 * squash everything else together (or, for a measure marked `badEndAtWorst`, at the pack's worst line).
 */
export function spreadOf(values: (number | null)[], shape: CriterionShape, def?: Pick<MetricDef, "badEndAtWorst">): { lo: number; hi: number } {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  if (shape.kind === "less") return { lo: min, hi: def?.badEndAtWorst ? max : quantile(sorted, 0.95) };
  if (shape.kind === "more") return { lo: quantile(sorted, 0.05), hi: max };
  return { lo: quantile(sorted, 0.05), hi: quantile(sorted, 0.95) };
}

/** However far past the bad end a line is, its utility goes no lower than this. */
const UTILITY_FLOOR = -0.5;

/**
 * `beyondBad`: past the bad end of a "more"/"less" scale, how fast utility keeps falling, as a share of the slope inside
 * it — so a line with 10 commutes still scores below one with 7 when 6 is "as bad as it gets", instead of the two tying.
 */
export function utilityOf(value: number, shape: CriterionShape, spread: { lo: number; hi: number }, beyondBad = 0): number {
  switch (shape.kind) {
    case "more": {
      const lo = spread.lo;
      const hi = shape.enoughAt ?? spread.hi;
      if (hi - lo < 1e-9) return value >= hi ? 1 : 0.5;
      const u = (value - lo) / (hi - lo);
      return u < 0 ? Math.max(UTILITY_FLOOR, u * beyondBad) : Math.min(1, u);
    }
    case "less": {
      const best = shape.fineAt ?? spread.lo;
      const worst = shape.worstAt ?? spread.hi;
      if (worst - best < 1e-9) return value <= best ? 1 : 0.5;
      const u = (worst - value) / (worst - best);
      return u < 0 ? Math.max(UTILITY_FLOOR, u * beyondBad) : Math.min(1, u);
    }
    case "target": {
      const tol = Math.max(1e-6, shape.tolerance);
      return Math.pow(0.5, ((value - shape.ideal) / tol) ** 2);
    }
    case "range": {
      const below = shape.min !== undefined && value < shape.min ? shape.min - value : 0;
      const above = shape.max !== undefined && value > shape.max ? value - shape.max : 0;
      const off = below + above;
      if (off === 0) return 1;
      const scale = Math.max(1e-6, (spread.hi - spread.lo) / 2);
      return clamp01(1 - off / scale);
    }
    case "perOccurrence":
      return clamp01(1 - shape.costEach * value);
  }
}

export function criterionWeight(c: Criterion): number {
  return (c.weight > 0 ? c.weight : TIER_WEIGHT[c.tier]) * (0.5 + 0.5 * c.confidence);
}

/** The pilot's home settings, passed to every measurement that needs them. */
export function homeParams(model: PilotModel): MetricParams {
  const h = model.home;
  if (!h) return {};
  return {
    homeAirports: h.airports,
    ...(h.commuteBufferHours !== undefined ? { commuteBufferHours: h.commuteBufferHours } : {}),
    ...(h.frontBufferHours !== undefined ? { frontBufferHours: h.frontBufferHours } : {}),
    ...(h.backRestHours !== undefined ? { backRestHours: h.backRestHours } : {}),
    ...(h.backupFlights !== undefined ? { backupFlights: h.backupFlights } : {}),
    ...(h.minHomeHours !== undefined ? { minHomeHours: h.minHomeHours } : {}),
    ...(h.hasCrashPad !== undefined ? { hasCrashPad: h.hasCrashPad } : {}),
  };
}

export interface ScoreOptions {
  travel?: TravelTimeProvider;
  /** Real airline flights looked up for this pilot's trips. */
  flights?: FlightAnswers;
  pack?: PackMetrics;
  /**
   * How shortfalls combine. 1 = a plain weighted average, where enough small wins can buy back a big miss. Above 1, a
   * line's biggest misses on what matters count disproportionately — the way a pilot drops a line that fails a top
   * priority no matter what else it has. Defaults to `SHORTFALL_POWER`.
   */
  power?: number;
  /** See `utilityOf`. Defaults to `BEYOND_BAD`. */
  beyondBad?: number;
}

export function scorePackV2(bidPack: BidPack, model: PilotModel, options: ScoreOptions = {}): V2LineScore[] {
  const pack = options.pack ?? prepareMetrics(bidPack);
  if (options.travel) pack.ctx.travel = options.travel;
  if (options.flights) pack.ctx.flights = options.flights;
  const home = homeParams(model);
  const criteria = model.criteria.filter((c) => METRICS_BY_ID.has(c.metric));

  // Measure every criterion on every line once.
  const values = criteria.map((c) => bidPack.lines.map((l) => measure(c.metric, l, pack, { ...home, ...c.params })));
  const spreads = criteria.map((c, ci) => spreadOf(values[ci], c.shape, METRICS_BY_ID.get(c.metric)));
  const weights = criteria.map(criterionWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const beyond = options.beyondBad ?? BEYOND_BAD;
  const utilities = criteria.map((c, ci) => values[ci].map((v) => (v === null ? 0.5 : utilityOf(v, c.shape, spreads[ci], beyond))));
  const meanUtility = utilities.map((us) => us.reduce((a, b) => a + b, 0) / Math.max(1, us.length));
  // A dealbreaker that rules out most of the pack is usually misread or bound to the wrong measure ("not two all-nighters
  // in a row" as a cap on every night worked capped two-thirds of a pack, its best lines included): it still counts
  // through its criterion's weight, it just stops capping. Dates a pilot must have off are the exception — those really
  // can rule out most lines, and the pilot means it.
  const enforced = criteria.map((c, ci) => {
    if (!c.hardLimit) return false;
    if (LITERAL_LIMITS.has(c.metric)) return true;
    const measured = values[ci].filter((v): v is number => v !== null);
    const broken = measured.filter((v) => (c.hardLimit!.op === "max" ? v > c.hardLimit!.value : v < c.hardLimit!.value)).length;
    return measured.length === 0 || broken / measured.length <= MAX_SHARE_RULED_OUT;
  });

  return bidPack.lines.map((line, li) => {
    const results: CriterionResult[] = criteria.map((c, ci) => {
      const def = METRICS_BY_ID.get(c.metric)!;
      const u = utilities[ci][li];
      // A line with no real measurement for this criterion counts half, neither rewarded nor punished.
      const w = values[ci][li] === null ? weights[ci] / 2 : weights[ci];
      return {
        criterionId: c.id,
        label: c.label,
        metric: c.metric,
        value: values[ci][li],
        unit: def.unit,
        utility: u,
        weight: w,
        contribution: ((u - meanUtility[ci]) * weights[ci] * 100) / totalWeight,
      };
    });
    const w = results.reduce((a, r) => a + r.weight, 0) || 1;
    const p = options.power ?? SHORTFALL_POWER;
    const shortfall = Math.pow(results.reduce((a, r) => a + r.weight * Math.pow(1 - r.utility, p), 0) / w, 1 / p);
    const uncapped = (1 - shortfall) * 100;

    const violations = criteria.flatMap((c, ci) => {
      const v = values[ci][li];
      if (!c.hardLimit || v === null || !enforced[ci]) return [];
      const broken = c.hardLimit.op === "max" ? v > c.hardLimit.value : v < c.hardLimit.value;
      return broken ? [{ criterionId: c.id, label: c.label, value: v, limit: c.hardLimit.value, op: c.hardLimit.op }] : [];
    });
    const score = violations.length ? uncapped * HARD_LIMIT_CAP : uncapped;

    return { lineId: line.id, lineNumber: line.lineNumber, score: Math.round(score * 10) / 10, uncapped, results, violations };
  });
}

/** Best first, with a stable tie-break on line number. */
export function rankPackV2(bidPack: BidPack, model: PilotModel, options: Parameters<typeof scorePackV2>[2] = {}): V2LineScore[] {
  return scorePackV2(bidPack, model, options).sort((a, b) => b.score - a.score || a.lineNumber.localeCompare(b.lineNumber));
}
