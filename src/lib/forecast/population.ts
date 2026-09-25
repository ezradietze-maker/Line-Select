import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";

/**
 * What the forecast believes about a pilot it has never heard from, before
 * any real pilot has told it anything: how much a typical pilot cares about
 * each thing on a line (`FEATURE_NAMES`, in that order), and how much pilots
 * differ from one another. These are reasoned starting points, not measured
 * facts — most pilots want days off and dislike night flying and extra duty
 * periods, but credit, international flying and standby split the crowd, so
 * those get a wide spread. Every real ranking that comes in pulls this
 * toward what the pilots at this base and seat actually want.
 */
export const PRIOR_MEAN = [0.9, 0.35, -0.45, -0.15, 0.0, 0.1, -0.35, -0.1, -0.25, 0.0];
export const PRIOR_SD = [0.65, 0.8, 0.55, 0.45, 0.8, 0.6, 0.55, 0.65, 0.45, 0.65];

/** Per-pilot, per-line taste the features can't explain (a favorite city, a weekend that matters). */
export const NOISE_SD = 1.0;
/** Appeal a line has for everyone at once that the features can't explain — a line that's simply popular, or unloved, for reasons the pack doesn't state. */
export const PRIOR_POPULARITY_SD = 0.5;
/** How many imaginary pilots the starting beliefs are worth when blending with real ones. */
const PRIOR_STRENGTH = 6;
/** How far a fitted ranking's utility spread is scaled to, so fitted weights are in the same units as the prior. */
const UTILITY_SPREAD = 1.3;
const RIDGE = 5;

export interface PopulationModel {
  mean: number[];
  sd: number[];
  /** Shared appeal per line, learned from real rankings (all zero before any). */
  popularity: Float64Array;
  popularitySd: number;
  noiseSd: number;
  knownCount: number;
}

export function priorPopulation(lineCount: number): PopulationModel {
  return {
    mean: [...PRIOR_MEAN],
    sd: [...PRIOR_SD],
    popularity: new Float64Array(lineCount),
    popularitySd: PRIOR_POPULARITY_SD,
    noiseSd: NOISE_SD,
    knownCount: 0,
  };
}

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const d = m[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / d;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Each line's place in a ranking as a standardized "how much did they want it" score. Lines the ranking doesn't mention share the average of the remaining places. */
function rankingToUtility(ranking: number[], lineCount: number): Float64Array {
  const score = new Float64Array(lineCount);
  const restPosition = ranking.length + (lineCount - ranking.length - 1) / 2;
  const position = new Float64Array(lineCount).fill(restPosition);
  ranking.forEach((line, i) => {
    if (line >= 0 && line < lineCount) position[line] = i;
  });
  let mean = 0;
  for (let i = 0; i < lineCount; i++) mean += -position[i];
  mean /= lineCount;
  let variance = 0;
  for (let i = 0; i < lineCount; i++) variance += (-position[i] - mean) ** 2;
  const sd = Math.sqrt(variance / lineCount) || 1;
  for (let i = 0; i < lineCount; i++) score[i] = ((-position[i] - mean) / sd) * UTILITY_SPREAD;
  return score;
}

/** Fits the weights on each feature that best explain one pilot's own ranking (ridge regression). */
export function fitWeightsFromRanking(features: LineFeatures, ranking: number[]): { weights: number[]; residual: Float64Array } {
  const L = features.lineCount;
  const K = FEATURE_COUNT;
  const y = rankingToUtility(ranking, L);
  const xtx: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  const xty = new Array(K).fill(0);
  for (let i = 0; i < L; i++) {
    for (let a = 0; a < K; a++) {
      const fa = features.values[i * K + a];
      xty[a] += fa * y[i];
      for (let b = 0; b < K; b++) xtx[a][b] += fa * features.values[i * K + b];
    }
  }
  for (let a = 0; a < K; a++) xtx[a][a] += RIDGE;
  const weights = solve(xtx, xty);
  const residual = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    let predicted = 0;
    for (let k = 0; k < K; k++) predicted += weights[k] * features.values[i * K + k];
    residual[i] = y[i] - predicted;
  }
  return { weights, residual };
}

/**
 * The population belief after hearing from real pilots: their fitted weights
 * blended with the starting beliefs (more pilots, more weight on what they
 * said), and the shared appeal of each line averaged from what the features
 * couldn't explain in their rankings.
 */
export function estimatePopulation(features: LineFeatures, knownRankings: number[][]): PopulationModel {
  const prior = priorPopulation(features.lineCount);
  const n = knownRankings.length;
  if (n === 0) return prior;

  const fits = knownRankings.map((r) => fitWeightsFromRanking(features, r));
  const K = FEATURE_COUNT;
  const mean = new Array(K).fill(0);
  for (const f of fits) for (let k = 0; k < K; k++) mean[k] += f.weights[k] / n;
  const sd = new Array(K).fill(0);
  for (const f of fits) for (let k = 0; k < K; k++) sd[k] += (f.weights[k] - mean[k]) ** 2 / n;

  const blend = n / (n + PRIOR_STRENGTH);
  const popularity = new Float64Array(features.lineCount);
  for (const f of fits) for (let i = 0; i < features.lineCount; i++) popularity[i] += (f.residual[i] / n) * (n / (n + 4));

  return {
    mean: mean.map((m, k) => blend * m + (1 - blend) * PRIOR_MEAN[k]),
    sd: sd.map((v, k) => Math.sqrt(blend * v + (1 - blend) * PRIOR_SD[k] ** 2)),
    popularity,
    popularitySd: PRIOR_POPULARITY_SD / Math.sqrt(1 + n / 6),
    noiseSd: NOISE_SD,
    knownCount: n,
  };
}
