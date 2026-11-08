import { brierScore, fitCalibration, pairsFromAward, pairsFromHolders, type Calibration, type CalibrationPair, type ReportedAward, type SharedHolder, type StoredPrediction } from "@/lib/learning/forecast-learning";

/**
 * The fair test a new forecast calibration must pass before it's used. Awards, not pairs, are what count: one award
 * yields dozens of correlated pairs, so a test "with 200 pairs" can rest on a handful of pilot-months.
 *
 * - The newest quarter of forecasts is held back, whole packs at a time; the challenger learns only from the older ones,
 *   so it's judged on months it has never seen. (The model in use learned from everything, the held-back months included, so scoring
 *   it on them would flatter it — it isn't used as the yardstick.)
 * - It must beat leaving the forecast alone on those months by more than chance: the held-back awards are resampled
 *   many times, and it has to come out ahead in at least 95% of the resamples.
 */

/** Different pilot-months needed before calibration is attempted at all. */
export const MIN_AWARDS = 30;
const HOLD_SHARE = 0.25;
const RESAMPLES = 400;

/** One forecast and what's known about how it turned out. */
export interface CalibrationCase {
  prediction: StoredPrediction;
  /** What this pilot reported they got, when they did. */
  award: ReportedAward | null;
  /** Lines other pilots shared holding in the same pack. */
  holders?: SharedHolder[];
  /** The pack, so a pack's forecasts all land on one side of the fair test. */
  packKey?: string;
  /** The award row's id: one award shows up in many cases. */
  awardId?: string;
}

/** Every checkable pair in one forecast: its own award first, then what other pilots' awards say about the lines it didn't settle. */
export function pairsOfCase(c: CalibrationCase): CalibrationPair[] {
  return [...(c.award ? pairsFromAward(c.prediction, c.award) : []), ...pairsFromHolders(c.prediction, c.holders ?? [], c.award)];
}

/** Different real awards behind these forecasts. */
export function awardsBehind(cases: CalibrationCase[]): number {
  const ids = new Set<string>();
  cases.forEach((c, i) => {
    if (c.award) ids.add(c.awardId ?? `case-${i}`);
    for (const h of c.holders ?? []) ids.add(h.id ?? `case-${i}-${h.lineIndex}`);
  });
  return ids.size;
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
  const awards = awardsBehind(cases);
  if (awards < MIN_AWARDS) return { ready: false, reason: `${awards} checked awards so far — needs ${MIN_AWARDS}` };
  let cut = Math.floor(cases.length * (1 - HOLD_SHARE));
  // A pack's forecasts share the same awards, so one on each side of the line would let the challenger see its own test.
  while (cut > 0 && cases[cut].packKey !== undefined && cases[cut].packKey === cases[cut - 1].packKey) cut--;
  if (cut === 0) return { ready: false, reason: "every checked forecast is from one pack — needs an older one to learn from" };
  const train = cases.slice(0, cut);
  const heldBack = cases.slice(cut);
  const challenger = fitCalibration(train.flatMap(pairsOfCase), version, now);
  const perAward: CalibrationPair[][] = heldBack.map(pairsOfCase).filter((p) => p.length > 0);
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
