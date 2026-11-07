import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";
import { decodeRanking } from "@/lib/forecast/ranking-codec";
import type { CorrectionEvent } from "@/lib/learning/interview-learning";
import type { InterviewOutcome } from "@/lib/learning/interview-outcome";
import type { BrainOutcome } from "@/lib/learning/brain-learning";
import type { HoldRecord } from "@/lib/learning/hold-history";
import { getJson, setJson } from "@/lib/server/kv";
import type { PackHistory, ReportedAward, StoredPrediction } from "@/lib/learning/forecast-learning";
import { bidPercentile } from "@/lib/learning/cohort";
import { db } from "@/lib/server/postgres";
import {
  awardHistoryRecords,
  forecastPredictions,
  forecastRankings,
  interviewOutcomes,
  learnedModels,
  learningRuns,
  packFeatures,
  preferenceCorrections,
} from "@/lib/server/schema";

/**
 * Everything the fleet learning reads and writes. The learning itself
 * (`lib/learning/`) is pure and never touches the database; this file is
 * the only bridge, so the models can be tested on simulated fleets and the
 * storage can change without touching the math.
 *
 * Retention is by size, not age: the learning is meant to draw on years of
 * bids, so rows stay until a table passes its cap, and only then are the
 * oldest dropped.
 */

/** Newest rows the learning reads per run — years of a busy fleet, bounded so a run stays fast. */
const MAX_OUTCOMES = 60_000;
const MAX_CORRECTIONS = 60_000;
const MAX_PACKS = 600;
const MAX_PREDICTIONS = 60_000;

// ---------------------------------------------------------------------------
// Writes from the app
// ---------------------------------------------------------------------------

export async function saveInterviewOutcome(outcome: InterviewOutcome, pilotHash: string | null): Promise<void> {
  await db.insert(interviewOutcomes).values({
    pilotHash,
    base: outcome.cohort.base,
    aircraft: outcome.cohort.aircraft,
    seat: outcome.cohort.seat,
    month: outcome.month,
    commute: outcome.cohort.commute,
    seniorityBand: outcome.cohort.seniority,
    modelVersion: outcome.modelVersion,
    payload: outcome,
  });
}

/** The story-driven interview's anonymous outcome (see `BrainOutcome`), kept in the same table, marked by its model version. */
export const BRAIN_OUTCOME_VERSION = "brain";

export async function saveBrainOutcome(outcome: BrainOutcome, pilotHash: string | null): Promise<void> {
  await db.insert(interviewOutcomes).values({
    pilotHash,
    base: outcome.cohort.base,
    aircraft: outcome.cohort.aircraft,
    seat: outcome.cohort.seat,
    month: outcome.month,
    commute: outcome.cohort.commute,
    seniorityBand: outcome.cohort.seniority,
    modelVersion: BRAIN_OUTCOME_VERSION,
    payload: outcome as unknown as InterviewOutcome,
  });
}

export async function saveCorrections(
  events: CorrectionEvent[],
  pack: { base: string; aircraft: string; seat: string },
  pilotHash: string | null
): Promise<void> {
  if (events.length === 0) return;
  await db.insert(preferenceCorrections).values(
    events.map((e) => ({ pilotHash, base: pack.base, aircraft: pack.aircraft, seat: pack.seat, dim: e.dim, src: e.src, fromValue: Math.round(e.from), toValue: Math.round(e.to) }))
  );
}

/** "oct26|mem|b767|fo" -> its parts. */
export function parsePackKey(packKey: string): { month: string; base: string; aircraft: string; seat: string } | null {
  const [month, base, aircraft, seat] = packKey.split("|");
  if (!month || !base || !aircraft || !seat) return null;
  return { month: month.toUpperCase(), base: base.toUpperCase(), aircraft: aircraft.toUpperCase(), seat: seat.toUpperCase() };
}

/** Keeps a month's line features (numbers only) so rankings shared that month can still be learned from years later. */
export async function savePackFeatures(blobKey: string, packKey: string, features: LineFeatures): Promise<void> {
  const parts = parsePackKey(packKey);
  if (!parts) return;
  await db
    .insert(packFeatures)
    .values({ blobKey, packKey, ...parts, lineNumbers: features.lineNumbers, features: Array.from(features.values, (v) => Math.round(v * 1000) / 1000) })
    .onConflictDoNothing();
}

/** How many of a pilot's top choices are kept with their forecast — enough to check almost any award against. */
const PREDICTION_DEPTH = 80;

export async function saveForecastPrediction(params: {
  pilotHash: string;
  blobKey: string;
  packKey: string;
  bidNumber: number;
  totalPilots: number;
  ranking: number[];
  pAvailableByLine: Float64Array | number[];
  modelVersion: string | null;
}): Promise<void> {
  const ranking = params.ranking.slice(0, PREDICTION_DEPTH);
  const pAvailable = ranking.map((i) => Math.round((params.pAvailableByLine[i] ?? 0) * 1000) / 1000);
  await db
    .insert(forecastPredictions)
    .values({ pilotHash: params.pilotHash, blobKey: params.blobKey, packKey: params.packKey, bidNumber: params.bidNumber, totalPilots: params.totalPilots, ranking, pAvailable, modelVersion: params.modelVersion })
    .onConflictDoUpdate({
      target: [forecastPredictions.pilotHash, forecastPredictions.blobKey],
      set: { ranking, pAvailable, bidNumber: params.bidNumber, totalPilots: params.totalPilots, modelVersion: params.modelVersion, createdAt: new Date() },
    });
}

/** Forgets the forecast a pilot was shown for one pack — when they stop sharing. */
export async function deleteForecastPrediction(pilotHash: string, packKey: string): Promise<void> {
  await db.delete(forecastPredictions).where(and(eq(forecastPredictions.pilotHash, pilotHash), eq(forecastPredictions.packKey, packKey)));
}

/** Which of the pilot's own choices a reported award was, from the forecast they were shown that month (1 = their first choice). */
export async function awardedChoiceFromPrediction(pilotHash: string, packKey: string, lineNumber: string | null): Promise<number | null> {
  if (!lineNumber) return null;
  const [p] = await db
    .select({ ranking: forecastPredictions.ranking, blobKey: forecastPredictions.blobKey })
    .from(forecastPredictions)
    .where(and(eq(forecastPredictions.pilotHash, pilotHash), eq(forecastPredictions.packKey, packKey)))
    .orderBy(desc(forecastPredictions.createdAt))
    .limit(1);
  if (!p) return null;
  const [pack] = await db.select({ lineNumbers: packFeatures.lineNumbers }).from(packFeatures).where(eq(packFeatures.blobKey, p.blobKey)).limit(1);
  const index = pack?.lineNumbers.indexOf(lineNumber) ?? -1;
  const at = index >= 0 ? p.ranking.indexOf(index) : -1;
  return at >= 0 ? at + 1 : null;
}

// ---------------------------------------------------------------------------
// A pilot's own history
// ---------------------------------------------------------------------------

export async function listPilotHoldRecords(pilotHash: string): Promise<HoldRecord[]> {
  const rows = await db.select().from(awardHistoryRecords).where(eq(awardHistoryRecords.pilotHash, pilotHash)).orderBy(desc(awardHistoryRecords.submittedAt)).limit(120);
  return rows.map((r) => ({
    month: r.month,
    base: r.base,
    aircraft: r.aircraft,
    seat: r.seat,
    percentile: r.seniorityRank > 0 && r.seniorityTotalPilots > 1 ? bidPercentile(r.seniorityRank, r.seniorityTotalPilots) : null,
    outcome: r.outcome as HoldRecord["outcome"],
    awardedChoice: r.awardedChoice,
    daysOff: r.daysOff,
    creditHours: r.totalCreditHours,
    submittedAt: r.submittedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// What a learning run reads
// ---------------------------------------------------------------------------

export interface DatedOutcome {
  at: Date;
  outcome: InterviewOutcome;
}

export async function loadOutcomes(): Promise<DatedOutcome[]> {
  const rows = await db
    .select({ at: interviewOutcomes.createdAt, payload: interviewOutcomes.payload, pilotHash: interviewOutcomes.pilotHash })
    .from(interviewOutcomes)
    .orderBy(desc(interviewOutcomes.createdAt))
    .limit(MAX_OUTCOMES);
  // A signed-in pilot who redoes the interview in the same month counts once
  // (their latest), so nobody's answers outweigh everyone else's by retaking it.
  // Guests' rows (stored before only pilots could teach the fleet) are left out.
  const seen = new Set<string>();
  const latest = rows.filter((r) => {
    // The story-driven interview's outcomes have a different shape; they're learned from separately (`loadBrainOutcomes`).
    if ((r.payload as { v?: number }).v === 2) return false;
    if (!r.pilotHash) return false;
    const key = `${r.pilotHash}|${r.payload.month}|${r.payload.cohort.base}|${r.payload.cohort.aircraft}|${r.payload.cohort.seat}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return latest.reverse().map((r) => ({ at: r.at, outcome: r.payload }));
}

/** Fleet learning reads the last year of interviews: what pilots cared about two seasons of packs ago is a weak guide. */
const BRAIN_OUTCOME_WINDOW_DAYS = 365;

export async function loadBrainOutcomes(now = new Date()): Promise<BrainOutcome[]> {
  const since = new Date(now.getTime() - BRAIN_OUTCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ payload: interviewOutcomes.payload, pilotHash: interviewOutcomes.pilotHash, at: interviewOutcomes.createdAt })
    .from(interviewOutcomes)
    .where(and(eq(interviewOutcomes.modelVersion, BRAIN_OUTCOME_VERSION), gt(interviewOutcomes.createdAt, since)))
    .orderBy(desc(interviewOutcomes.createdAt))
    .limit(MAX_OUTCOMES);
  // Signed-in pilots only, and each pilot's latest per base, aircraft and seat: the groups count pilots, so one
  // pilot interviewing every month still counts once (`MIN_PILOTS`), and no pilot weighs more than any other.
  const seen = new Set<string>();
  return rows
    .map((r) => ({ o: r.payload as unknown as BrainOutcome, pilotHash: r.pilotHash, at: r.at }))
    .filter(({ o, pilotHash }) => {
      if (o.v !== 2) return false;
      if (!pilotHash) return false;
      const key = `${pilotHash}|${o.cohort.base}|${o.cohort.aircraft}|${o.cohort.seat}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ o, pilotHash, at }) => ({ ...o, pilot: pilotHash!, at: at.toISOString() }))
    .reverse();
}

/** Flown months pilots checked in on, with which brain and whether notes ranked them — the real-outcome signal. */
export interface FlownMonth {
  base: string;
  aircraft: string;
  seat: string;
  month: string;
  feel: "better" | "asExpected" | "worse";
  brainVersion: number | null;
  notesUsed: boolean | null;
  awardedChoice: number | null;
}

export async function loadFlownMonths(): Promise<FlownMonth[]> {
  const rows = await db
    .select({
      base: awardHistoryRecords.base,
      aircraft: awardHistoryRecords.aircraft,
      seat: awardHistoryRecords.seat,
      month: awardHistoryRecords.month,
      feel: awardHistoryRecords.monthFeel,
      brainVersion: awardHistoryRecords.brainVersion,
      notesUsed: awardHistoryRecords.notesUsed,
      awardedChoice: awardHistoryRecords.awardedChoice,
    })
    .from(awardHistoryRecords)
    .where(and(isNotNull(awardHistoryRecords.pilotHash), isNotNull(awardHistoryRecords.monthFeel)))
    .limit(MAX_OUTCOMES);
  return rows.filter((r): r is FlownMonth => r.feel === "better" || r.feel === "asExpected" || r.feel === "worse");
}

export async function loadCorrections(): Promise<CorrectionEvent[]> {
  const rows = await db.select().from(preferenceCorrections).where(isNotNull(preferenceCorrections.pilotHash)).orderBy(desc(preferenceCorrections.createdAt)).limit(MAX_CORRECTIONS);
  return rows.map((r) => ({ dim: r.dim, src: r.src, from: r.fromValue, to: r.toValue }));
}

/** Every stored month of line features with the rankings pilots shared that month. */
export async function loadPackHistories(): Promise<PackHistory[]> {
  const packs = await db.select().from(packFeatures).orderBy(desc(packFeatures.updatedAt)).limit(MAX_PACKS);
  if (packs.length === 0) return [];
  const rankings = await db
    .select({ blobKey: forecastRankings.blobKey, ranking: forecastRankings.ranking })
    .from(forecastRankings)
    .where(inArray(forecastRankings.blobKey, packs.map((p) => p.blobKey)));
  const byBlob = new Map<string, string[]>();
  for (const r of rankings) byBlob.set(r.blobKey, [...(byBlob.get(r.blobKey) ?? []), r.ranking]);
  return packs
    .filter((p) => (byBlob.get(p.blobKey)?.length ?? 0) > 0 && p.features.length === p.lineNumbers.length * FEATURE_COUNT)
    .map((p) => ({
      base: p.base,
      aircraft: p.aircraft,
      seat: p.seat,
      features: { lineIds: p.lineNumbers, lineNumbers: p.lineNumbers, values: Float64Array.from(p.features), lineCount: p.lineNumbers.length },
      rankings: byBlob.get(p.blobKey)!.map((r) => decodeRanking(r, p.lineNumbers.length)),
    }));
}

export interface DatedCalibrationCase {
  at: Date;
  seat: string;
  prediction: StoredPrediction;
  award: ReportedAward;
}

/** Every forecast that has a reported award to check it against: same pilot, same pack. */
export async function loadCalibrationCases(): Promise<DatedCalibrationCase[]> {
  const awards = await db
    .select()
    .from(awardHistoryRecords)
    .where(and(isNotNull(awardHistoryRecords.pilotHash), isNotNull(awardHistoryRecords.packKey)))
    .orderBy(desc(awardHistoryRecords.submittedAt))
    .limit(MAX_PREDICTIONS);
  if (awards.length === 0) return [];
  const predictions = await db
    .select()
    .from(forecastPredictions)
    .where(inArray(forecastPredictions.pilotHash, [...new Set(awards.map((a) => a.pilotHash!))]));
  const blobs = await db
    .select({ blobKey: packFeatures.blobKey, lineNumbers: packFeatures.lineNumbers })
    .from(packFeatures)
    .where(inArray(packFeatures.blobKey, [...new Set(predictions.map((p) => p.blobKey))]));
  const linesByBlob = new Map(blobs.map((b) => [b.blobKey, b.lineNumbers] as const));
  const predictionFor = new Map(predictions.map((p) => [`${p.pilotHash}|${p.packKey}`, p] as const));

  const cases: DatedCalibrationCase[] = [];
  for (const a of awards) {
    const p = predictionFor.get(`${a.pilotHash}|${a.packKey}`);
    if (!p) continue;
    const lines = linesByBlob.get(p.blobKey);
    const lineIndex = a.lineNumber && lines ? lines.indexOf(a.lineNumber) : -1;
    cases.push({
      at: a.submittedAt,
      seat: a.seat,
      prediction: { ranking: p.ranking, pAvailable: p.pAvailable },
      award: { outcome: a.outcome as ReportedAward["outcome"], lineIndex: lineIndex >= 0 ? lineIndex : null },
    });
  }
  return cases.reverse();
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export type ModelKind = "interview" | "forecast-prior" | "forecast-calibration" | "brain";

export interface StoredModel<T> {
  version: string;
  payload: T;
  metrics: Record<string, unknown>;
  sampleSize: number;
  createdAt: Date;
}

/** Active models change at most a few times a day; a warm server keeps them a few minutes rather than querying every request. */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<ModelKind, { at: number; model: StoredModel<unknown> | null }>();

const switchKey = (kind: ModelKind) => `line-select:learner-off:${kind}`;

/** Whether the owner has switched a learner off (`/api/admin/learning`): its model is then never used, whatever it learned. */
export async function isLearnerOff(kind: ModelKind): Promise<boolean> {
  try {
    return (await getJson<boolean>(switchKey(kind))) === true;
  } catch {
    return false;
  }
}

export async function setLearnerOff(kind: ModelKind, off: boolean): Promise<void> {
  await setJson(switchKey(kind), off);
  cache.delete(kind);
}

/**
 * Undo: the version in use is retired and the one before it brought back. Returns the two versions, or null when
 * there's no earlier version to go back to. Every version is kept, so this can be repeated.
 */
export async function rollBackModel(kind: ModelKind): Promise<{ from: string; to: string } | null> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(learnedModels).where(and(eq(learnedModels.kind, kind), eq(learnedModels.active, true))).orderBy(desc(learnedModels.createdAt)).limit(1);
    if (!current) return null;
    const [previous] = await tx
      .select()
      .from(learnedModels)
      // Only a version that was once in use: a challenger that failed its fair test is stored inactive too, and undo
      // must never switch it on. Rows from before this was stamped count as used — except calibrations, which could
      // be either, so they're passed over.
      .where(
        and(
          eq(learnedModels.kind, kind),
          eq(learnedModels.active, false),
          lt(learnedModels.createdAt, current.createdAt),
          sql`coalesce((${learnedModels.metrics}->>'promoted')::boolean, ${learnedModels.kind} <> 'forecast-calibration')`
        )
      )
      .orderBy(desc(learnedModels.createdAt))
      .limit(1);
    if (!previous) return null;
    await tx.update(learnedModels).set({ active: false }).where(eq(learnedModels.id, current.id));
    await tx.update(learnedModels).set({ active: true }).where(eq(learnedModels.id, previous.id));
    return { from: current.version, to: previous.version };
  });
  cache.delete(kind);
  return result;
}

export async function loadActiveModel<T>(kind: ModelKind, { fresh = false } = {}): Promise<StoredModel<T> | null> {
  if (await isLearnerOff(kind)) return null;
  const hit = cache.get(kind);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.model as StoredModel<T> | null;
  const [row] = await db
    .select()
    .from(learnedModels)
    .where(and(eq(learnedModels.kind, kind), eq(learnedModels.active, true)))
    .orderBy(desc(learnedModels.createdAt))
    .limit(1);
  const model = row ? { version: row.version, payload: row.payload as T, metrics: row.metrics, sampleSize: row.sampleSize, createdAt: row.createdAt } : null;
  cache.set(kind, { at: Date.now(), model });
  return model;
}

/** Stores a model in the version history; when `active`, it becomes the one in use and the previous champion is retired (kept, not deleted). */
export async function saveModel(params: { kind: ModelKind; version: string; payload: unknown; metrics: Record<string, unknown>; sampleSize: number; active: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    // Retire the champion only once this model is really in: a second run in the same minute has the same version,
    // its insert is skipped, and retiring first left that kind with no active model at all.
    const [inserted] = await tx
      .insert(learnedModels)
      .values({ ...params, metrics: { ...params.metrics, promoted: params.active } })
      .onConflictDoNothing()
      .returning({ id: learnedModels.id });
    if (params.active && inserted) {
      await tx
        .update(learnedModels)
        .set({ active: false })
        .where(and(eq(learnedModels.kind, params.kind), eq(learnedModels.active, true), ne(learnedModels.id, inserted.id)));
    }
  });
  cache.delete(params.kind);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** A run that started within this long and hasn't finished is assumed still going. */
const RUN_LEASE_MS = 10 * 60 * 1000;
/** Any fixed number, unique among this app's advisory locks (it has no others). */
const RUN_LOCK_KEY = 7_301_946;

/** Starts a run unless one is already going — two triggers landing at once (the daily schedule and a burst of interviews) never learn twice in parallel. */
export async function startRun(trigger: string): Promise<string | null> {
  const since = new Date(Date.now() - RUN_LEASE_MS);
  return db.transaction(async (tx) => {
    // Held to the end of this transaction, so two triggers can't both see "nothing running" and both start.
    await tx.execute(sql`select pg_advisory_xact_lock(${RUN_LOCK_KEY})`);
    const [running] = await tx
      .select({ id: learningRuns.id })
      .from(learningRuns)
      .where(and(isNull(learningRuns.finishedAt), gt(learningRuns.startedAt, since)))
      .limit(1);
    if (running) return null;
    const [row] = await tx.insert(learningRuns).values({ trigger, summary: {} }).returning({ id: learningRuns.id });
    return row.id;
  });
}

export async function finishRun(id: string, summary: Record<string, unknown>): Promise<void> {
  await db.update(learningRuns).set({ finishedAt: new Date(), summary }).where(eq(learningRuns.id, id));
}

/** New interviews and awards since the last finished run — what decides whether a burst of activity is worth learning from right away. */
export async function newDataSinceLastRun(): Promise<{ interviews: number; awards: number; lastRunAt: Date | null }> {
  const [last] = await db
    .select({ at: learningRuns.finishedAt })
    .from(learningRuns)
    .where(isNotNull(learningRuns.finishedAt))
    .orderBy(desc(learningRuns.finishedAt))
    .limit(1);
  const since = last?.at ?? new Date(0);
  const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(interviewOutcomes).where(gt(interviewOutcomes.createdAt, since));
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(awardHistoryRecords).where(gt(awardHistoryRecords.submittedAt, since));
  return { interviews: i?.n ?? 0, awards: a?.n ?? 0, lastRunAt: last?.at ?? null };
}

/** The recent run history, newest first — for the admin view of whether the learning is improving. */
export async function listRecentRuns(limit = 30) {
  return db.select().from(learningRuns).orderBy(desc(learningRuns.startedAt)).limit(limit);
}
