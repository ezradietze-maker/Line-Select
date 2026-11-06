import { brierScore, fitCalibration, pairsFromAward, type Calibration, type CalibrationPair } from "@/lib/learning/forecast-learning";

/**
 * The fair test a new forecast calibration must pass before it's used. Awards, not pairs, are what count: one award
 * yields dozens of correlated pairs, so a test "with 200 pairs" can rest on a handful of pilot-months.
 *
 * - The newest quarter of awards is held back; the challenger learns only from the older ones, so it's judged on
 *   months it has never seen. (The model in use learned from everything, the held-back months included, so scoring
 *   it on them would flatter it — it isn't used as the yardstick.)
 * - It must beat leaving the forecast alone on those months by more than chance: the held-back awards are resampled
 *   many times, and it has to come out ahead in at least 95% of the resamples.
 */

/** Different pilot-months needed before calibration is attempted at all. */
export const MIN_AWARDS = 30;
const HOLD_SHARE = 0.25;
const RESAMPLES = 400;

export interface CalibrationCase {
  prediction: Parameters<typeof pairsFromAward>[0];
  award: Parameters<typeof pairsFromAward>[1];
}

export type FairTest =
  | { ready: false; reason: string }
  | { ready: true; promote: boolean; heldBack: number; brierUncalibrated: number; brierChallenger: number; winShare: number; challenger: Calibration };

/** A small seeded random generator, so the same data always gives the same verdict. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** `cases` oldest first. */
export function testCalibration(cases: CalibrationCase[], version: string, now: Date): FairTest {
  if (cases.length < MIN_AWARDS) return { ready: false, reason: `${cases.length} checked awards so far — needs ${MIN_AWARDS}` };
  const cut = Math.floor(cases.length * (1 - HOLD_SHARE));
  const train = cases.slice(0, cut);
  const heldBack = cases.slice(cut);
  const challenger = fitCalibration(train.flatMap((c) => pairsFromAward(c.prediction, c.award)), version, now);
  const perAward: CalibrationPair[][] = heldBack.map((c) => pairsFromAward(c.prediction, c.award)).filter((p) => p.length > 0);
  if (perAward.length < 5) return { ready: false, reason: "too few held-back awards with a forecast to judge" };
  const all = perAward.flat();
  const brierUncalibrated = brierScore(all);
  const brierChallenger = brierScore(all, challenger);
  const random = seeded(cases.length * 7919 + perAward.length);
  let wins = 0;
  for (let r = 0; r < RESAMPLES; r++) {
    const sample = Array.from({ length: perAward.length }, () => perAward[Math.floor(random() * perAward.length)]).flat();
    if (brierScore(sample, challenger) < brierScore(sample)) wins++;
  }
  const winShare = wins / RESAMPLES;
  return { ready: true, promote: winShare >= 0.95, heldBack: perAward.length, brierUncalibrated, brierChallenger, winShare, challenger };
}
