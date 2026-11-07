import { shareChanges, type WeightChange } from "@/lib/brain/fit-choices";
import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { criterionWeight, scorePackV2 } from "@/lib/scoring-v2/score";
import { rankLinesWithTrips, scoreTripsV2, tripKey, TRIP_LEAN, TRIP_LESSONS } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel } from "@/types/pilot-model";

/**
 * Learning a pilot's weights from every line choice they've made — the interview's, and each swap on their results —
 * as one Bayesian fit (plan and measurements: docs/plans/reorder-learning.md).
 *
 * Why it works on weights at all: a line's score is 100·(1 − √S) with S = Σwᵢdᵢ / Σwᵢ, dᵢ = (1 − uᵢ)², and the square
 * root never changes which of two lines is ahead — so "A over B" is exactly Σ wᵢ(dᵢᴮ − dᵢᴬ) > 0, a statement about the
 * weights alone (the utilities don't depend on them).
 *
 * - The interview's weights are the prior: each log-weight may move with a standard deviation of `priorSd`, and no
 *   further than `maxFactor` either way — the old fit's pull-back (PULL_BACK 2 ≙ 0.5) and cap. Interview choices count
 *   exactly as they did there, so a pilot who only answered the interview gets the same model (checked on all 189 saved
 *   readings of the ex-pilot's interview: identical).
 * - A swap is one piece of evidence, however many lines it passed (Cao et al. 2006 normalise per query; Joachims' pairs
 *   from one action aren't independent votes). Half rides on the two lines the pilot swapped, half on what the swap
 *   says about the lines between. A pilot drags by mistake now and then, so each pair allows a `lapse` chance of meaning
 *   nothing (Christiano et al. 2017).
 * - How much swaps teach depends on how consistent they are. Swaps that follow the pilot's priorities sharpen them; swaps
 *   that are close calls made for reasons no weighting explains would only shuffle weights that were right — on the
 *   ex-pilot's real order, every way of learning harder from his swaps made the lines he hadn't touched come out worse.
 *   So each of a few noise levels is fitted, and the one the swaps themselves make most likely wins (Laplace evidence),
 *   leaning toward taking swaps at face value (`noisePenalty`). On the swap bench (scripts/eval/drag-bench.ts) that does
 *   no harm on the ex-pilot where the old fit did, at a small cost on simulated pilots whose swaps follow their stated
 *   priorities exactly.
 * - Pairs where only one line breaks a dealbreaker are left out: the cap decides those, not the weights.
 * - The fit's uncertainty comes back too: how far each log-weight could still be from where it landed.
 */

export const LEARNER = {
  /** How far a log-weight is expected to stray from the interview's (one standard deviation). */
  priorSd: 0.5,
  maxFactor: 3,
  /** Interview choices: score points over which a choice goes from mostly met to mostly missed. */
  temperature: 3,
  /** Interview choices: the gap each kind asks for, as in `fit-choices.ts`. */
  margin: { strongly: 1, slightly: 0.25 },
  swap: {
    /** How much one swap counts, in pairs' worth, shared across every pair it makes. */
    evidence: 2,
    /** The share of that riding on the two lines the pilot actually swapped. */
    primaryShare: 0.5,
    margin: 0.5,
    lapse: 0.1,
    /**
     * How noisy a pilot's swaps may be, in score points: whichever of these their swaps make most likely. The last means
     * "these swaps teach nothing" — on the ex-pilot's real order, keeping his swaps and learning nothing from them gave
     * his whole bid list its best agreement with how he ranks (91.3%; the old fit 89.8%), so a pilot like him has to be
     * able to land there.
     */
    temperatures: [3, 6, 12, 24, Infinity],
    /** Evidence each step up the noise levels gives up: a pilot is read as noisy only when the swaps say so clearly. */
    noisePenalty: 0.5,
  },
  /** A drag saved before swaps were recorded as such (no `dragId`): counted as the old fit counted it. */
  legacyDirect: 0.35,
};

export interface LearnerSettings {
  priorSd: number;
  maxFactor: number;
  swap: { evidence: number; primaryShare: number; margin: number; lapse: number; temperatures: number[]; noisePenalty: number };
}

/**
 * One line, as the fit sees it: its shortfall² and half-weight flag on each priority, and — once the pilot has graded
 * trips — the part of its score that leans on its worst trip: the line's own score counts `share` of it, and the worst
 * trip adds `offset` (held fixed while the weights move: it's what the pilot saw).
 */
interface Row {
  sf: number[];
  half: boolean[];
  share: number;
  offset: number;
}

type Term = { kind: "strongly" | "slightly" | "legacy"; a: Row; b: Row } | { kind: "swap"; a: Row; b: Row; weight: number };

/** Each swap's pairs, weighted: `evidence` in all, `primaryShare` of it on the pair of lines the pilot swapped. */
export function swapPairWeights(pairs: LineChoice[], evidence: number, primaryShare: number): number[] {
  if (pairs.length === 1) return [evidence];
  // The two lines the pilot swapped are the two that appear in the most pairs (see `choicesFromSwap`; with one line
  // between, all three tie, and the swapped pair is the one listed first).
  const count = new Map<string, number>();
  for (const p of pairs) for (const l of [p.preferred, p.other]) count.set(l, (count.get(l) ?? 0) + 1);
  const [x, y] = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const isPrimary = (p: LineChoice) => (p.preferred === x && p.other === y) || (p.preferred === y && p.other === x);
  const primaries = pairs.filter(isPrimary).length || 1;
  const rest = pairs.length - primaries;
  return pairs.map((p) => (isPrimary(p) ? (evidence * primaryShare) / primaries : (evidence * (1 - primaryShare)) / Math.max(1, rest)));
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)));

/** A line's score under weights `w`, adding its gradient with respect to each log-weight (× `scale`) into `grad`. */
function scoreAndGrad(row: Row, w: number[], grad: number[] | null, scale: number): number {
  let num = 0;
  let den = 0;
  const a = new Array<number>(w.length);
  for (let i = 0; i < w.length; i++) {
    a[i] = row.half[i] ? w[i] / 2 : w[i];
    num += a[i] * row.sf[i];
    den += a[i];
  }
  if (den <= 0) return row.share * 100 + row.offset;
  const q = num / den;
  const root = Math.sqrt(Math.max(q, 1e-9));
  if (grad) for (let i = 0; i < w.length; i++) grad[i] += (scale * row.share * -100 * a[i] * (row.sf[i] - q)) / (2 * root * den);
  return row.share * 100 * (1 - root) + row.offset;
}

/** The loss for log-weights `theta` with swaps read at noise level `swapT`, adding its gradient into `grad`. */
function objective(theta: number[], base: number[], terms: Term[], s: LearnerSettings, swapT: number, grad: number[] | null): number {
  const w = base.map((b, i) => b * Math.exp(theta[i]));
  const T = LEARNER.temperature;
  let loss = 0;
  for (const t of terms) {
    const local = grad ? new Array<number>(w.length).fill(0) : null;
    const gap = scoreAndGrad(t.a, w, local, 1) - scoreAndGrad(t.b, w, local, -1);
    let dLossDGap: number;
    if (t.kind === "swap") {
      const p = sigmoid((gap - s.swap.margin) / swapT);
      const likelihood = s.swap.lapse / 2 + (1 - s.swap.lapse) * p;
      loss -= t.weight * Math.log(likelihood);
      dLossDGap = (-t.weight * (1 - s.swap.lapse) * p * (1 - p)) / (swapT * likelihood);
    } else if (t.kind === "legacy") {
      const miss = -(gap - LEARNER.margin.slightly) / T;
      loss += LEARNER.legacyDirect * softplus(miss);
      dLossDGap = (-LEARNER.legacyDirect * sigmoid(miss)) / T;
    } else if (t.kind === "strongly") {
      const miss = -(gap - LEARNER.margin.strongly) / T;
      loss += softplus(miss);
      dLossDGap = -sigmoid(miss) / T;
    } else {
      const p = sigmoid(-(gap - LEARNER.margin.slightly) / T);
      loss += p;
      dLossDGap = (-p * (1 - p)) / T;
    }
    if (grad && local) for (let i = 0; i < w.length; i++) grad[i] += dLossDGap * local[i];
  }
  const v = s.priorSd ** 2;
  for (let i = 0; i < theta.length; i++) {
    loss += (theta[i] * theta[i]) / (2 * v);
    if (grad) grad[i] += theta[i] / v;
  }
  return loss;
}

/** Diagonal of the inverse of a small symmetric matrix and its log-determinant (Gauss–Jordan), or null if it's singular. */
function invert(m: number[][]): { diagonal: number[]; logDet: number } | null {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  let logDet = 0;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-12) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const p = a[c][c];
    logDet += Math.log(Math.abs(p));
    for (let j = 0; j < 2 * n; j++) a[c][j] /= p;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return { diagonal: a.map((row, i) => row[n + i]), logDet };
}

/**
 * The fit at one noise level: projected gradient descent on the log-weights inside the ±maxFactor box (the step grows
 * while it helps), then the curvature there (Laplace) — each weight's spread, and how likely the pilot's choices are at
 * this level (higher is better; only comparable between levels fitted to the same choices).
 */
function fitAt(base: number[], terms: Term[], s: LearnerSettings, swapT: number): { theta: number[]; variances: number[] | null; evidence: number } {
  const n = base.length;
  const cap = Math.log(s.maxFactor);
  let theta = new Array<number>(n).fill(0);
  let grad = new Array<number>(n).fill(0);
  let current = objective(theta, base, terms, s, swapT, grad);
  let step = 0.1;
  for (let it = 0; it < 500 && step > 1e-6; it++) {
    const next = theta.map((t, k) => Math.max(-cap, Math.min(cap, t - step * grad[k])));
    const g = new Array<number>(n).fill(0);
    const value = objective(next, base, terms, s, swapT, g);
    if (value < current - 1e-12) {
      theta = next;
      current = value;
      grad = g;
      step *= 1.25;
    } else step *= 0.5;
  }
  // The curvature, by differences of the exact gradient.
  const h = 1e-4;
  const hessian = theta.map((_, i) => {
    const up = new Array<number>(n).fill(0);
    const down = new Array<number>(n).fill(0);
    objective(theta.map((t, k) => (k === i ? t + h : t)), base, terms, s, swapT, up);
    objective(theta.map((t, k) => (k === i ? t - h : t)), base, terms, s, swapT, down);
    return up.map((u, k) => (u - down[k]) / (2 * h));
  });
  const inv = invert(hessian.map((row, i) => row.map((x, j) => (x + hessian[j][i]) / 2)));
  // log p(choices | level) ≈ −loss at the fit − ½·log|H| (+ terms the same at every level).
  return { theta, variances: inv?.diagonal ?? null, evidence: inv ? -current - inv.logDet / 2 : -Infinity };
}

export interface LearnResult {
  model: PilotModel;
  changes: WeightChange[];
  agreedBefore: number;
  agreedAfter: number;
  /** Choices left out because a dealbreaker decides the pair (see `fit-choices.ts`). */
  heldByLimit: LineChoice[];
  /** By criterion id: how far its log-weight could still be from where it landed (one standard deviation). */
  uncertainty: Record<string, number>;
  /** How noisy the pilot's swaps read, in score points (null with no swaps). */
  swapNoise: number | null;
}

export function learnFromChoices(
  bidPack: BidPack,
  model: PilotModel,
  choices: LineChoice[],
  pack: PackMetrics = prepareMetrics(bidPack),
  settings: Partial<LearnerSettings> = {}
): LearnResult {
  const s: LearnerSettings = { ...LEARNER, ...settings, swap: { ...LEARNER.swap, ...settings.swap } };
  // Fitted on the score the pilot actually sees: once they've graded trips, each line's weights carry what the grades
  // taught, and its score leans on its worst trip (`rankLinesWithTrips`). The worst trip is held where it was — it's what
  // they were looking at when they swapped — and the weights fitted are the untaught ones, so the lessons apply on top.
  const tw = model.tripWeights && Object.keys(model.tripWeights).length ? model.tripWeights : null;
  const taught: PilotModel = tw ? { ...model, tripWeights: undefined, criteria: model.criteria.map((c) => ({ ...c, weight: c.weight * (tw[c.id] ?? 1) ** TRIP_LESSONS })) } : model;
  const scored = new Map(scorePackV2(bidPack, taught, { pack }).map((x) => [x.lineNumber, x]));
  const worstTrip = new Map<string, number>();
  if (tw) {
    const trips = scoreTripsV2(bidPack, model, { pack, onLineScale: false });
    for (const line of bidPack.lines) {
      const ts = line.trips.flatMap((t) => (trips.has(tripKey(t)) ? [trips.get(tripKey(t))!.score] : []));
      if (ts.length) worstTrip.set(line.lineNumber, Math.min(...ts));
    }
  }
  const seenScore = (m: PilotModel) => new Map((tw ? rankLinesWithTrips(bidPack, m, { pack }) : scorePackV2(bidPack, m, { pack })).map((x) => [x.lineNumber, x.score]));
  const shown = seenScore(model);
  // One verdict per two lines from the interview (a line pair and a bid check can land on the same two); swaps each count.
  const seen = new Set<string>();
  const known = choices.filter((c) => {
    // A swap a later one reversed is kept only so undoing the later one brings it back (`addDragChoices`).
    if (c.preferred === c.other || c.supersededBy || !scored.has(c.preferred) || !scored.has(c.other)) return false;
    if (c.direct) return true;
    const k = [c.preferred, c.other].sort().join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const capped = (line: string) => scored.get(line)!.violations.length > 0;
  const heldByLimit = known.filter((c) => capped(c.preferred) !== capped(c.other));
  const usable = known.filter((c) => !heldByLimit.includes(c));

  const agreedBefore = usable.filter((c) => shown.get(c.preferred)! > shown.get(c.other)!).length;
  const unchanged: LearnResult = { model, changes: [], agreedBefore, agreedAfter: agreedBefore, heldByLimit, uncertainty: Object.fromEntries(model.criteria.map((c) => [c.id, s.priorSd])), swapNoise: null };
  if (usable.length === 0 || model.criteria.length === 0) return unchanged;

  const ids = model.criteria.map((c) => c.id);
  const base = taught.criteria.map(criterionWeight);
  const rowOf = (line: string): Row => {
    const byId = new Map(scored.get(line)!.results.map((x) => [x.criterionId, x]));
    const worst = worstTrip.get(line);
    return {
      sf: ids.map((id) => (byId.has(id) ? (1 - byId.get(id)!.utility) ** 2 : 0)),
      half: ids.map((id) => !byId.has(id) || byId.get(id)!.value === null),
      share: worst === undefined ? 1 : 1 - TRIP_LEAN,
      offset: worst === undefined ? 0 : TRIP_LEAN * worst,
    };
  };
  const terms: Term[] = [];
  const swaps = new Map<string, LineChoice[]>();
  for (const c of usable) {
    if (c.direct && c.dragId) swaps.set(c.dragId, [...(swaps.get(c.dragId) ?? []), c]);
    else terms.push({ kind: c.direct ? "legacy" : c.strength, a: rowOf(c.preferred), b: rowOf(c.other) });
  }
  for (const pairs of swaps.values()) {
    const weights = swapPairWeights(pairs, s.swap.evidence, s.swap.primaryShare);
    pairs.forEach((c, k) => terms.push({ kind: "swap", a: rowOf(c.preferred), b: rowOf(c.other), weight: weights[k] }));
  }

  // Each noise level fitted; the one the swaps make most likely wins, leaning toward the quietest.
  const levels = swaps.size ? [...s.swap.temperatures].sort((a, b) => a - b) : [s.swap.temperatures[0]];
  const best = levels
    .map((swapT, k) => {
      const fit = fitAt(base, terms, s, swapT);
      return { swapT, ...fit, score: fit.evidence - s.swap.noisePenalty * k };
    })
    .reduce((a, b) => (b.score > a.score ? b : a));
  const uncertainty = Object.fromEntries(ids.map((id, i) => [id, best.variances && best.variances[i] > 0 ? Math.sqrt(best.variances[i]) : s.priorSd]));

  // Weights stay relative to the strongest priority, as everywhere else.
  const raw = model.criteria.map((c, i) => c.weight * Math.exp(best.theta[i]));
  const top = Math.max(...raw) || 1;
  const fitted: PilotModel = { ...model, criteria: model.criteria.map((c, i) => ({ ...c, weight: raw[i] / top })) };
  const byLine = seenScore(fitted);
  const agreedAfter = usable.filter((c) => byLine.get(c.preferred)! > byLine.get(c.other)!).length;
  const swapNoise = swaps.size ? best.swapT : null;
  // Only keep the fit if it explains the choices at least as well.
  if (agreedAfter < agreedBefore) return { ...unchanged, uncertainty, swapNoise };
  return { model: fitted, changes: shareChanges(model, fitted), agreedBefore, agreedAfter, heldByLimit, uncertainty, swapNoise };
}
