import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";
import { fitWeightsFromRanking, PRIOR_MEAN, PRIOR_SD, type LearnedPrior } from "@/lib/forecast/population";

/**
 * How the hold forecast gets better month over month. Two separate things
 * are learned, both from data pilots have chosen to share:
 *
 * 1. What pilots at a seat want (`learnForecastPriors`). Every shared
 *    ranking, from every past month, is turned into the weights that best
 *    explain it; their spread becomes the forecast's starting belief about
 *    the pilots who haven't shared anything. A seat with years of rankings
 *    stops relying on reasoned guesses.
 *
 * 2. How far to trust the forecast's own numbers (`fitCalibration`). When a
 *    pilot reports the line they were actually awarded, the forecast made
 *    for them that month can be checked: every line they ranked above their
 *    award was gone by their turn, and the awarded one was there. A shared
 *    award also checks every other pilot's forecast for that pack: its line
 *    was open for anyone ahead of its holder and gone for anyone behind.
 *    Across many pilots, "the forecast said 70%" can be compared with how
 *    often those lines really were still open — and corrected when it's been
 *    too optimistic or too cautious.
 */

/** A group of seats the forecast learns for: the whole fleet, one seat, or one base/aircraft/seat. */
export function forecastLevels(base: string, aircraft: string, seat: string): string[] {
  const s = seat.trim().toUpperCase();
  return ["all", `seat:${s}`, `pack:${base.trim().toUpperCase()}|${aircraft.trim().toUpperCase()}|${s}`];
}

/** One past month's shared rankings with that month's line features — what the prior is learned from. */
export interface PackHistory {
  base: string;
  aircraft: string;
  seat: string;
  features: LineFeatures;
  rankings: number[][];
}

interface WeightStats {
  n: number;
  sum: number[];
  sumSq: number[];
}

/** Per group, the fitted weights of every past ranking — summed, so years of data stay small. */
export interface ForecastPriorModel {
  version: string;
  createdAt: string;
  levels: Record<string, WeightStats>;
}

export function learnForecastPriors(history: PackHistory[], version: string, now: Date): ForecastPriorModel {
  const levels: Record<string, WeightStats> = {};
  for (const pack of history) {
    const keys = forecastLevels(pack.base, pack.aircraft, pack.seat);
    for (const ranking of pack.rankings) {
      if (ranking.length < 3) continue;
      const { weights } = fitWeightsFromRanking(pack.features, ranking);
      if (weights.some((w) => !Number.isFinite(w))) continue;
      for (const key of keys) {
        const s = (levels[key] ??= { n: 0, sum: new Array(FEATURE_COUNT).fill(0), sumSq: new Array(FEATURE_COUNT).fill(0) });
        s.n++;
        weights.forEach((w, k) => {
          s.sum[k] += w;
          s.sumSq[k] += w * w;
        });
      }
    }
  }
  return { version, createdAt: now.toISOString(), levels };
}

/** How many pilots' rankings a group needs before it counts as much as the beliefs above it. */
const PRIOR_SHRINK = 12;

/**
 * The starting belief for one seat: the reasoned defaults, moved toward the
 * whole fleet's learned weights, then the seat's, then this exact
 * base/aircraft/seat's, each by how much data it has. Null until there's
 * real data anywhere — the forecast then keeps its reasoned defaults.
 */
export function resolveForecastPrior(model: ForecastPriorModel, base: string, aircraft: string, seat: string): LearnedPrior | null {
  let mean = [...PRIOR_MEAN];
  let variance = PRIOR_SD.map((s) => s * s);
  let total = 0;
  for (const key of forecastLevels(base, aircraft, seat)) {
    const s = model.levels[key];
    if (!s || s.n < 2) continue;
    const w = s.n / (s.n + PRIOR_SHRINK);
    const m = s.sum.map((x) => x / s.n);
    const v = s.sumSq.map((x, k) => Math.max(0.01, x / s.n - m[k] * m[k]));
    mean = mean.map((x, k) => w * m[k] + (1 - w) * x);
    variance = variance.map((x, k) => w * v[k] + (1 - w) * x);
    total = s.n;
  }
  if (total === 0) return null;
  return { mean, sd: variance.map((v) => Math.sqrt(v)), n: total };
}

// ---------------------------------------------------------------------------
// Calibration against real awards
// ---------------------------------------------------------------------------

/** What the forecast told a pilot: their ranking (line indices, best first) and the chance each was still open at their turn. */
export interface StoredPrediction {
  ranking: number[];
  pAvailable: number[];
  /** The pilot's place in bid order — what other pilots' awards are checked against. */
  bidNumber?: number;
}

/** What the pilot actually got. `lineIndex` is the awarded line's index in the same pack, or null when it wasn't a regular line. */
export interface ReportedAward {
  outcome: "line" | "reserve" | "other";
  lineIndex: number | null;
}

export interface CalibrationPair {
  p: number;
  /** 1 = the line was still open at their turn, 0 = it was gone. */
  y: 0 | 1;
}

/**
 * The checkable part of one forecast. Bidding awards each pilot the first
 * line on their list still open, so every line ranked above the award was
 * gone, and the award itself was open. Lines ranked below it say nothing
 * (they may or may not have been there). A reserve award means everything
 * they ranked was gone. "Other" (leave, training) says nothing at all.
 */
export function pairsFromAward(prediction: StoredPrediction, award: ReportedAward): CalibrationPair[] {
  if (award.outcome === "other") return [];
  const { ranking, pAvailable } = prediction;
  const at = award.outcome === "line" && award.lineIndex !== null ? ranking.indexOf(award.lineIndex) : -1;
  // An award off the bottom of what was stored: everything stored was gone too.
  const goneThrough = award.outcome === "reserve" || at === -1 ? ranking.length : at;
  const pairs: CalibrationPair[] = [];
  for (let i = 0; i < goneThrough; i++) pairs.push({ p: pAvailable[i], y: 0 });
  if (at >= 0) pairs.push({ p: pAvailable[at], y: 1 });
  return pairs.filter((x) => Number.isFinite(x.p));
}

/** Another pilot's award in the same pack: which line, and their place in bid order. */
export interface SharedHolder {
  lineIndex: number;
  bidPosition: number;
  id?: string;
}

/**
 * What other pilots' awards say about one forecast. A line is taken at its holder's turn and not before, so it was
 * open for anyone ahead of them and gone for anyone behind. Skips any line the pilot's own award already settles, and
 * the pilot's own place on the list (that award is their own).
 */
export function pairsFromHolders(prediction: StoredPrediction, holders: SharedHolder[], ownAward: ReportedAward | null = null): CalibrationPair[] {
  const { ranking, pAvailable, bidNumber } = prediction;
  if (bidNumber === undefined || (ownAward && ownAward.outcome === "reserve")) return [];
  const at = ownAward?.outcome === "line" && ownAward.lineIndex !== null ? ranking.indexOf(ownAward.lineIndex) : -1;
  const settledThrough = ownAward && ownAward.outcome === "line" ? (at === -1 ? ranking.length : at + 1) : 0;
  const pairs: CalibrationPair[] = [];
  for (const h of holders) {
    if (h.bidPosition === bidNumber) continue;
    const i = ranking.indexOf(h.lineIndex);
    if (i === -1 || i < settledThrough) continue;
    pairs.push({ p: pAvailable[i], y: bidNumber < h.bidPosition ? 1 : 0 });
  }
  return pairs.filter((x) => Number.isFinite(x.p));
}

/** A monotone map from the forecast's number to the real rate, as points to interpolate between. */
export interface Calibration {
  version: string;
  createdAt: string;
  /** Pairs it was fitted on. */
  n: number;
  points: { p: number; q: number }[];
}

/**
 * Pool-adjacent-violators isotonic regression on the forecast's numbers:
 * the best monotone correction (a higher forecast never maps to a lower
 * real chance), fitted in bins so a few lucky outcomes can't pull it
 * around, and shrunk toward "no correction" where pairs are scarce.
 */
export function fitCalibration(pairs: CalibrationPair[], version: string, now: Date, bins = 20): Calibration {
  const sorted = [...pairs].sort((a, b) => a.p - b.p);
  const binSize = Math.max(1, Math.ceil(sorted.length / bins));
  const blocks: { p: number; y: number; w: number }[] = [];
  for (let i = 0; i < sorted.length; i += binSize) {
    const chunk = sorted.slice(i, i + binSize);
    blocks.push({
      p: chunk.reduce((s, x) => s + x.p, 0) / chunk.length,
      y: chunk.reduce((s, x) => s + x.y, 0) / chunk.length,
      w: chunk.length,
    });
  }
  // Pool adjacent violators.
  const stack: { p: number; y: number; w: number }[] = [];
  for (const b of blocks) {
    stack.push({ ...b });
    while (stack.length > 1 && stack[stack.length - 2].y > stack[stack.length - 1].y) {
      const top = stack.pop()!;
      const below = stack.pop()!;
      const w = below.w + top.w;
      stack.push({ p: (below.p * below.w + top.p * top.w) / w, y: (below.y * below.w + top.y * top.w) / w, w });
    }
  }
  // Each point leans toward "the forecast was right" until it has real weight behind it.
  // Each shrinks by its own weight, which can tip a light point below a heavy one before it — so the order is set
  // again after: a higher forecast never maps to a lower real chance.
  let floor = 0;
  const points = stack.map((b) => {
    const trust = b.w / (b.w + 15);
    floor = Math.max(floor, Math.min(0.995, Math.max(0.005, trust * b.y + (1 - trust) * b.p)));
    return { p: b.p, q: floor };
  });
  return { version, createdAt: now.toISOString(), n: pairs.length, points };
}

/** The corrected chance for one forecast number — linear between fitted points, held flat past the ends. */
export function applyCalibration(cal: Calibration | null | undefined, p: number): number {
  if (!cal || cal.points.length === 0 || !Number.isFinite(p)) return p;
  const pts = cal.points;
  // Below the lowest fitted point, scale toward zero: a line the forecast calls nearly gone stays nearly gone.
  if (p <= pts[0].p) return pts[0].p <= 1e-9 ? pts[0].q : pts[0].q * (p / pts[0].p);
  if (p >= pts[pts.length - 1].p) return pts[pts.length - 1].q;
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i].p) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (p - a.p) / Math.max(1e-9, b.p - a.p);
      return a.q + t * (b.q - a.q);
    }
  }
  return p;
}

/** Mean squared error of the forecast against what happened — the score calibration is judged on (lower is better). */
export function brierScore(pairs: CalibrationPair[], cal?: Calibration | null): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((s, x) => s + (applyCalibration(cal, x.p) - x.y) ** 2, 0) / pairs.length;
}

/** One row of "what we said against what happened". */
export interface ReliabilityBin {
  from: number;
  to: number;
  n: number;
  /** The forecast's average number in this bin. */
  said: number;
  /** How often those lines really were still open. */
  happened: number;
}

/** The forecast's numbers against what happened, in fixed bins; empty bins are left out. A well-calibrated forecast has `said` close to `happened` in every row. */
export function reliabilityTable(pairs: CalibrationPair[], cal?: Calibration | null, bins = 10): ReliabilityBin[] {
  const rows = Array.from({ length: bins }, (_, i) => ({ from: i / bins, to: (i + 1) / bins, n: 0, said: 0, happened: 0 }));
  for (const x of pairs) {
    const p = applyCalibration(cal, x.p);
    const row = rows[Math.min(bins - 1, Math.floor(p * bins))];
    row.n++;
    row.said += p;
    row.happened += x.y;
  }
  return rows.filter((r) => r.n > 0).map((r) => ({ ...r, said: r.said / r.n, happened: r.happened / r.n }));
}

/** The Brier score of always saying the overall rate: what a forecast must beat to be telling anyone anything. */
export function baselineBrier(pairs: CalibrationPair[]): number {
  if (pairs.length === 0) return NaN;
  const rate = pairs.reduce((s, x) => s + x.y, 0) / pairs.length;
  return rate * (1 - rate);
}
