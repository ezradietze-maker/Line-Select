import { fitCalibration, learnForecastPriors, type ForecastPriorModel } from "@/lib/learning/forecast-learning";
import { computeBrainModel } from "@/lib/learning/brain-learning";
import { cohortLevels } from "@/lib/learning/cohort";
import { awardsBehind, pairsOfCase, testCalibration } from "@/lib/learning/fair-test";
import { reportProblem } from "@/lib/server/alerts";
import {
  finishRun,
  loadActiveModel,
  loadBrainOutcomes,
  loadCalibrationCases,
  loadFlownMonths,
  loadPackHistories,
  newDataSinceLastRun,
  saveModel,
  startRun,
} from "@/lib/server/learning-store";

/**
 * One turn of the learning loop. Every model is rebuilt from all the data collected so far, then has to earn its
 * place:
 *
 * - The forecast calibration must pass a fair test on awards it never learned from (`testCalibration`).
 * - Fleet notes are built only from what pilots said, line by line only where a group agrees firmly, and switch on
 *   for a group only when notes built from its earlier pilots held for its newest — and off again if pilots
 *   interviewed with them come out worse (`decideNotes`, `guardNotes`).
 * - Every run is recorded with what it learned from and why each model was or wasn't put to use, so improvement
 *   over months is visible (and summarized weekly by email). Any learner can be switched off or rolled back from
 *   `/api/admin/learning`.
 *
 * Runs daily on a schedule (`/api/cron/learn`) and early whenever a burst of new interviews or awards comes in
 * (`maybeLearn`). The question-skipping learner was retired with the classic interview it learned from.
 */

function versionStamp(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().replace(/[-:]/g, "").slice(0, 13)}`;
}

async function learnForecastPrior(now: Date) {
  const history = await loadPackHistories();
  const rankings = history.reduce((s, h) => s + h.rankings.length, 0);
  if (rankings === 0) return { kind: "forecast-prior", skipped: "no shared rankings yet" };
  const version = versionStamp("fp", now);
  const model: ForecastPriorModel = learnForecastPriors(history, version, now);
  // A prior only ever moves the forecast's starting point, blended with each month's own data, so more history is
  // promoted directly. Each pilot shares at most one ranking per pack (a database rule), so no one weighs more.
  const metrics = { packs: history.length, rankings, seats: Object.keys(model.levels).length };
  await saveModel({ kind: "forecast-prior", version, payload: model, metrics, sampleSize: rankings, active: true });
  return { kind: "forecast-prior", version, promoted: true, metrics };
}

async function learnCalibration(now: Date) {
  const cases = await loadCalibrationCases();
  const version = versionStamp("fc", now);
  const test = testCalibration(cases, version, now);
  if (!test.ready) return { kind: "forecast-calibration", skipped: test.reason };
  const champion = await loadActiveModel("forecast-calibration", { fresh: true });
  const { heldBack, brierUncalibrated, brierChallenger, winShare } = test;
  const awards = awardsBehind(cases);
  const metrics = { awardsChecked: awards, forecastsChecked: cases.length, heldBack, brierUncalibrated, brierChallenger, winShare };
  // Passed: learn from every award, the held-back ones included, and use that. Failed: stored, but what's in use stays.
  const model = fitCalibration(cases.flatMap(pairsOfCase), version, now);
  await saveModel({ kind: "forecast-calibration", version, payload: model, metrics, sampleSize: awards, active: test.promote });
  return { kind: "forecast-calibration", version, promoted: test.promote, replaced: champion?.version ?? null, metrics };
}

/**
 * What pilots in each group care about and how they correct the brain, from their own answers — and, per group,
 * whether those notes are trustworthy enough to reach the brain (`decideNotes`). The model is always stored; the
 * decision on each group's notes travels inside it.
 */
async function learnBrainModel(now: Date) {
  const outcomes = await loadBrainOutcomes(now);
  if (outcomes.length === 0) return { kind: "brain", skipped: "no story-driven interviews yet" };
  const flownByLevel: Record<string, { notesUsed: boolean; worse: boolean }[]> = {};
  for (const m of await loadFlownMonths()) {
    if (m.notesUsed === null) continue;
    const levels = cohortLevels({ base: m.base, aircraft: m.aircraft, seat: m.seat, commute: "unknown" }).filter((l) => !l.endsWith("|unknown"));
    for (const level of levels) (flownByLevel[level] ??= []).push({ notesUsed: m.notesUsed, worse: m.feel === "worse" });
  }
  const version = versionStamp("b", now);
  const model = computeBrainModel(outcomes, version, now, flownByLevel);
  const notes = Object.fromEntries(Object.entries(model.levels).map(([level, s]) => [level, { pilots: s.pilots, on: !!s.notes?.on, reason: s.notes?.reason ?? "" }]));
  const metrics = { interviews: outcomes.length, groups: Object.keys(model.levels).length, notesOn: Object.values(notes).filter((n) => n.on).length, notes };
  await saveModel({ kind: "brain", version, payload: model, metrics, sampleSize: outcomes.length, active: true });
  return { kind: "brain", version, promoted: true, metrics };
}

export async function runLearningCycle(trigger: string): Promise<Record<string, unknown> | null> {
  const runId = await startRun(trigger);
  if (!runId) return null;
  const now = new Date();
  const results: Record<string, unknown>[] = [];
  for (const step of [learnBrainModel, learnForecastPrior, learnCalibration]) {
    try {
      results.push(await step(now));
    } catch (e) {
      // One model failing to learn never stops the others.
      await reportProblem("learning", e, { step: step.name });
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
    await reportProblem("learning", e, { step: "maybeLearn" });
  }
}
