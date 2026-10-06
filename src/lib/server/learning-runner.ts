import {
  brierScore,
  fitCalibration,
  learnForecastPriors,
  pairsFromAward,
  type Calibration,
  type CalibrationPair,
  type ForecastPriorModel,
} from "@/lib/learning/forecast-learning";
import { backtestInterviewModel, computeInterviewModel, type InterviewModel } from "@/lib/learning/interview-learning";
import {
  finishRun,
  loadActiveModel,
  loadCalibrationCases,
  loadCorrections,
  loadOutcomes,
  loadPackHistories,
  newDataSinceLastRun,
  saveModel,
  startRun,
} from "@/lib/server/learning-store";

/**
 * One turn of the learning loop. Every model is rebuilt from all the data
 * collected so far, then has to earn its place:
 *
 * - The newest slice of data is held back. A challenger is trained on
 *   everything older and scored on that slice; the model in use (the
 *   champion) is scored on the same slice. The challenger is promoted only
 *   if it does at least as well — so the app never swaps in a model that got
 *   worse on the pilots it's about to serve, however much more data it saw.
 * - A promoted model is then retrained on everything, including the
 *   held-back slice, before it's stored.
 * - Every run is recorded with what it learned from, each model's scores,
 *   and why it was or wasn't promoted, so improvement over months is visible.
 *
 * Runs daily on a schedule (`/api/cron/learn`) and early whenever a burst of
 * new interviews or awards comes in (`maybeLearn`).
 */

/** Below this much data a held-back slice is too small to judge anything — the model is just learned from all of it. */
const MIN_INTERVIEWS_FOR_BACKTEST = 60;
const MIN_PAIRS_FOR_CALIBRATION = 200;
/** A challenger may be this much worse on log loss and still promote — noise between two near-identical models shouldn't block fresher data. */
const LOGLOSS_TOLERANCE = 0.005;

function versionStamp(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().replace(/[-:]/g, "").slice(0, 13)}`;
}

function splitByTime<T>(items: T[], holdShare: number): { train: T[]; holdout: T[] } {
  const cut = Math.floor(items.length * (1 - holdShare));
  return { train: items.slice(0, cut), holdout: items.slice(cut) };
}

async function learnInterviewModel(now: Date) {
  const dated = await loadOutcomes();
  const corrections = await loadCorrections();
  const outcomes = dated.map((d) => d.outcome);
  const version = versionStamp("i", now);
  const champion = await loadActiveModel<InterviewModel>("interview", { fresh: true });

  if (outcomes.length === 0) return { kind: "interview", skipped: "no interviews yet" };

  let promote = true;
  let metrics: Record<string, unknown> = { interviews: outcomes.length, corrections: corrections.length };
  if (outcomes.length >= MIN_INTERVIEWS_FOR_BACKTEST) {
    const { train, holdout } = splitByTime(outcomes, 0.2);
    const challenger = computeInterviewModel(train, corrections, version, now);
    const challengerScore = backtestInterviewModel(challenger, holdout);
    const championScore = champion ? backtestInterviewModel(champion.payload, holdout) : null;
    promote = !championScore || challengerScore.logLoss <= championScore.logLoss + LOGLOSS_TOLERANCE;
    metrics = { ...metrics, holdout: holdout.length, challenger: challengerScore, champion: championScore };
  } else {
    metrics.note = `fewer than ${MIN_INTERVIEWS_FOR_BACKTEST} interviews — learned from all of them without a held-back check`;
  }

  const model = computeInterviewModel(outcomes, corrections, version, now);
  await saveModel({ kind: "interview", version, payload: model, metrics, sampleSize: outcomes.length, active: promote });
  return { kind: "interview", version, promoted: promote, replaced: champion?.version ?? null, metrics };
}

async function learnForecastPrior(now: Date) {
  const history = await loadPackHistories();
  const rankings = history.reduce((s, h) => s + h.rankings.length, 0);
  if (rankings === 0) return { kind: "forecast-prior", skipped: "no shared rankings yet" };
  const version = versionStamp("fp", now);
  const model: ForecastPriorModel = learnForecastPriors(history, version, now);
  // A prior only ever moves the forecast's starting point, blended with each month's own data, so more history is promoted directly.
  const metrics = { packs: history.length, rankings, seats: Object.keys(model.levels).length };
  await saveModel({ kind: "forecast-prior", version, payload: model, metrics, sampleSize: rankings, active: true });
  return { kind: "forecast-prior", version, promoted: true, metrics };
}

async function learnCalibration(now: Date) {
  const cases = await loadCalibrationCases();
  const pairs: CalibrationPair[] = cases.flatMap((c) => pairsFromAward(c.prediction, c.award));
  if (pairs.length < MIN_PAIRS_FOR_CALIBRATION) {
    return { kind: "forecast-calibration", skipped: `${pairs.length} checked forecasts so far — needs ${MIN_PAIRS_FOR_CALIBRATION}` };
  }
  const version = versionStamp("fc", now);
  const champion = await loadActiveModel<Calibration>("forecast-calibration", { fresh: true });
  const { train, holdout } = splitByTime(pairs, 0.25);
  const challenger = fitCalibration(train, version, now);
  const raw = brierScore(holdout);
  const challengerScore = brierScore(holdout, challenger);
  const championScore = champion ? brierScore(holdout, champion.payload) : null;
  // Must beat leaving the forecast alone, and must not be worse than what's in use.
  const promote = challengerScore < raw && (championScore === null || challengerScore <= championScore + 0.001);
  const model = fitCalibration(pairs, version, now);
  const metrics = { awardsChecked: cases.length, pairs: pairs.length, holdout: holdout.length, brierUncalibrated: raw, brierChallenger: challengerScore, brierChampion: championScore };
  await saveModel({ kind: "forecast-calibration", version, payload: model, metrics, sampleSize: pairs.length, active: promote });
  return { kind: "forecast-calibration", version, promoted: promote, replaced: champion?.version ?? null, metrics };
}

export async function runLearningCycle(trigger: string): Promise<Record<string, unknown> | null> {
  const runId = await startRun(trigger);
  if (!runId) return null;
  const now = new Date();
  const results: Record<string, unknown>[] = [];
  for (const step of [learnInterviewModel, learnForecastPrior, learnCalibration]) {
    try {
      results.push(await step(now));
    } catch (e) {
      // One model failing to learn never stops the others.
      console.error("[learning] step failed", step.name, e);
      results.push({ step: step.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const summary = { trigger, results };
  await finishRun(runId, summary);
  console.log("[learning] run finished", JSON.stringify(summary));
  return summary;
}

/** New interviews that make an early run worthwhile, before the daily one. */
const BURST_INTERVIEWS = 25;
const BURST_AWARDS = 10;

/** Called after new data arrives: learns right away when enough has piled up since the last run, so a busy bid week improves the model the same week. */
export async function maybeLearn(trigger: string): Promise<void> {
  try {
    const fresh = await newDataSinceLastRun();
    if (fresh.interviews >= BURST_INTERVIEWS || fresh.awards >= BURST_AWARDS) await runLearningCycle(trigger);
  } catch (e) {
    console.error("[learning] maybeLearn failed", e);
  }
}
