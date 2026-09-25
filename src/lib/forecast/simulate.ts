import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";
import { estimatePopulation, type PopulationModel } from "@/lib/forecast/population";
import { makeNormal, mulberry32 } from "@/lib/forecast/random";

/**
 * Plays the bid out many times. Pilots pick in seniority order and each takes
 * the best line still free on their own list, so a pilot's award depends only
 * on what the pilots ahead of them took. Pilots who've told Line Select their
 * real ranking pick from it exactly; every other pilot ahead is drawn from
 * what's known about the population, with fresh tastes each time. Over many
 * plays, the share of times a line is still there when it's your turn is your
 * chance at it. Nobody behind you can affect you, so nobody behind is played.
 */

export interface KnownRanking {
  /** Position in bid order. */
  bidNumber: number;
  /** Line indices (into the pack's line list), best first. */
  ranking: number[];
}

export interface ForecastParams {
  features: LineFeatures;
  /** Every pilot bidding this seat. */
  totalPilots: number;
  myBidNumber: number;
  /** Line indices, best first — what this pilot would bid. */
  myRanking: number[];
  known: KnownRanking[];
  simulations?: number;
  seed?: number;
  /** Chance a pilot ahead doesn't take a regular line this month (vacation, training, leave, choosing reserve). */
  dropoutRate?: number;
}

export interface ForecastCore {
  /** Per line: how often it was still free at your turn. */
  pAvailable: Float64Array;
  /** Per line: how often it was the line you'd actually be awarded from your ranking. */
  pAward: Float64Array;
  /** How often nothing on your ranking was left — no regular line. */
  pNoLine: number;
  /** Position within your own ranking of the line you'd be awarded, across plays where you got one. */
  awardedRank: { p10: number; p50: number; p90: number } | null;
  /** Chance of being awarded something within your top N choices. */
  pTop: Record<number, number>;
  pilotsAhead: number;
  knownAhead: number;
  simulations: number;
}

export const DEFAULT_SIMULATIONS = 400;
export const DEFAULT_DROPOUT_RATE = 0.08;
const TOP_MARKS = [1, 3, 5, 10, 25, 50];

export function simulateBid(params: ForecastParams): ForecastCore {
  const { features, totalPilots, myBidNumber, myRanking } = params;
  const S = params.simulations ?? DEFAULT_SIMULATIONS;
  const dropout = params.dropoutRate ?? DEFAULT_DROPOUT_RATE;
  const L = features.lineCount;
  const K = FEATURE_COUNT;
  const F = features.values;
  const pilotsAhead = Math.max(0, Math.min(myBidNumber - 1, totalPilots));

  const knownByBid = new Map<number, number[]>();
  for (const k of params.known) if (k.bidNumber < myBidNumber) knownByBid.set(k.bidNumber, k.ranking);
  const population: PopulationModel = estimatePopulation(features, params.known.map((k) => k.ranking));

  const rand = mulberry32(params.seed ?? 1);
  const normal = makeNormal(rand);

  const availableCount = new Float64Array(L);
  const awardCount = new Float64Array(L);
  const rankHistogram = new Float64Array(myRanking.length);
  let noLine = 0;

  const free = new Uint8Array(L);
  const shared = new Float64Array(L);
  const w = new Float64Array(K);

  for (let sim = 0; sim < S; sim++) {
    free.fill(1);
    for (let i = 0; i < L; i++) shared[i] = population.popularity[i] + population.popularitySd * normal();

    for (let bid = 1; bid <= pilotsAhead; bid++) {
      const known = knownByBid.get(bid);
      if (known) {
        for (const line of known) {
          if (line >= 0 && line < L && free[line]) {
            free[line] = 0;
            break;
          }
        }
        continue;
      }
      if (rand() < dropout) continue;

      for (let k = 0; k < K; k++) w[k] = population.mean[k] + population.sd[k] * normal();
      let best = -1;
      let bestUtility = -Infinity;
      for (let i = 0; i < L; i++) {
        if (!free[i]) continue;
        let u = shared[i] + population.noiseSd * normal();
        const base = i * K;
        for (let k = 0; k < K; k++) u += w[k] * F[base + k];
        if (u > bestUtility) {
          bestUtility = u;
          best = i;
        }
      }
      if (best >= 0) free[best] = 0;
    }

    for (let i = 0; i < L; i++) availableCount[i] += free[i];
    let awarded = -1;
    for (let r = 0; r < myRanking.length; r++) {
      if (free[myRanking[r]]) {
        awarded = r;
        break;
      }
    }
    if (awarded >= 0) {
      awardCount[myRanking[awarded]]++;
      rankHistogram[awarded]++;
    } else {
      noLine++;
    }
  }

  const pAvailable = availableCount.map((c) => c / S);
  const pAward = awardCount.map((c) => c / S);

  const gotOne = S - noLine;
  const percentile = (q: number): number => {
    if (gotOne === 0) return 0;
    const target = q * gotOne;
    let cumulative = 0;
    for (let r = 0; r < rankHistogram.length; r++) {
      cumulative += rankHistogram[r];
      if (cumulative >= target) return r + 1;
    }
    return rankHistogram.length;
  };

  const pTop: Record<number, number> = {};
  for (const mark of TOP_MARKS) {
    if (mark > myRanking.length) continue;
    let within = 0;
    for (let r = 0; r < mark; r++) within += rankHistogram[r];
    pTop[mark] = within / S;
  }

  return {
    pAvailable,
    pAward,
    pNoLine: noLine / S,
    awardedRank: gotOne > 0 ? { p10: percentile(0.1), p50: percentile(0.5), p90: percentile(0.9) } : null,
    pTop,
    pilotsAhead,
    knownAhead: knownByBid.size,
    simulations: S,
  };
}
