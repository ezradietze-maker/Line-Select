import { EXPLICIT_WEIGHT_IDS } from "@/lib/interview-engine";
import { cohortLevels, type Cohort } from "@/lib/learning/cohort";
import { bucketOf, type Bucket, type InterviewOutcome } from "@/lib/learning/interview-outcome";

/**
 * The interview's fleet-wide memory: what pilots in each group actually
 * answer, how well those group answers predict a new pilot, which questions
 * tend to surface something new, and how often pilots correct what the
 * interview concluded. Built fresh from every stored interview each
 * learning run (`computeInterviewModel`), checked against the most recent
 * interviews before it's trusted (`backtestInterviewModel`), and read per
 * pilot (`resolveCohort` → `decideInterviewPolicy`).
 *
 * Three rules keep it honest as it teaches itself:
 * 1. It only ever learns from real answers. A value the interview assumed
 *    (because pilots like this one nearly always answer it the same way)
 *    is never counted as evidence — otherwise a guess would confirm itself.
 * 2. Skipping a question has to be earned with measured accuracy, not just a
 *    lopsided count, and it keeps being re-measured: a share of pilots are
 *    still asked even once it's "known", so the check never stops.
 * 3. Pilots correcting an assumption afterward counts against it directly.
 */

export interface DimCounts {
  n: number;
  zero: number;
  pos: number;
  neg: number;
  /** Sum of |weight| over the non-zero answers, for the typical strength of a lean. */
  absSum: number;
}

export interface ValidationCounts {
  /** Real answers that had a prediction made for them before they were given. */
  predicted: number;
  correct: number;
}

export interface TopicYield {
  asked: number;
  skipped: number;
  /** Answers that produced at least one fact that lasted to the final profile. */
  productive: number;
  facts: number;
  chars: number;
}

export interface LevelStats {
  interviews: number;
  dims: Record<string, DimCounts>;
  validation: Record<string, ValidationCounts>;
  topics: Record<string, TopicYield>;
  /** Target numbers pilots gave, per key and role ("daysOff:ideal"), sorted — for typical values and spread. */
  targets: Record<string, number[]>;
  turns: number[];
  storyRate: { provided: number; total: number };
}

export interface CorrectionCounts {
  /** Interview values of each source later changed by the pilot on Preferences. */
  assumed: number;
  assumedCorrected: number;
  answered: number;
  answeredCorrected: number;
}

export interface InterviewModel {
  version: string;
  createdAt: string;
  interviews: number;
  levels: Record<string, LevelStats>;
  corrections: Record<string, CorrectionCounts>;
}

/** One later change a pilot made to a value the interview set — see `/api/learning/correction`. */
export interface CorrectionEvent {
  dim: string;
  /** Where the corrected value had come from. */
  src: "assumed" | "story" | "asked";
  from: number;
  to: number;
}

/** How many target samples a level keeps — plenty for a median, and bounded for years of data. */
const MAX_TARGET_SAMPLES = 400;

function emptyLevel(): LevelStats {
  return { interviews: 0, dims: {}, validation: {}, topics: {}, targets: {}, turns: [], storyRate: { provided: 0, total: 0 } };
}

function insertSorted(arr: number[], v: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, v);
}

/** Keeps a bounded, still-representative sample: once full, every other value is dropped. */
function addSample(arr: number[], v: number) {
  insertSorted(arr, v);
  if (arr.length > MAX_TARGET_SAMPLES) {
    const thinned = arr.filter((_, i) => i % 2 === 0);
    arr.length = 0;
    arr.push(...thinned);
  }
}

/** A correction counts if it moved the answer to a different bucket — nudging +60 to +70 isn't the interview being wrong. */
export function isRealCorrection(dim: string, from: number, to: number): boolean {
  return bucketOf(dim, from) !== bucketOf(dim, to);
}

/**
 * Builds the model from every stored interview and correction. Pure and
 * deterministic, so a learning run can be repeated, tested, and backtested
 * on a slice of history.
 */
export function computeInterviewModel(outcomes: InterviewOutcome[], corrections: CorrectionEvent[], version: string, now: Date): InterviewModel {
  const levels: Record<string, LevelStats> = {};

  for (const o of outcomes) {
    for (const key of cohortLevels(o.cohort)) {
      const L = (levels[key] ??= emptyLevel());
      L.interviews++;
      L.turns.push(o.turns);
      L.storyRate.total++;
      if (o.story.provided) L.storyRate.provided++;

      for (const [dim, { w, src }] of Object.entries(o.dims)) {
        // Rule 1: only real answers teach it — an assumption is the model's own guess.
        if (src === "assumed" || src === "none") continue;
        const b = bucketOf(dim, w);
        const c = (L.dims[dim] ??= { n: 0, zero: 0, pos: 0, neg: 0, absSum: 0 });
        c.n++;
        c[b]++;
        if (b !== "zero") c.absSum += Math.abs(w);

        const predicted = o.predictions[dim];
        if (predicted) {
          const v = (L.validation[dim] ??= { predicted: 0, correct: 0 });
          v.predicted++;
          if (predicted === b) v.correct++;
        }
      }

      for (const q of o.questions) {
        const t = (L.topics[q.topic] ??= { asked: 0, skipped: 0, productive: 0, facts: 0, chars: 0 });
        t.asked++;
        if (q.skipped) t.skipped++;
        if (q.added > 0) t.productive++;
        t.facts += q.added;
        t.chars += q.chars;
      }

      for (const [key, range] of Object.entries(o.targets)) {
        for (const role of ["min", "ideal", "max"] as const) {
          const v = range?.[role];
          if (typeof v === "number" && Number.isFinite(v)) addSample((L.targets[`${key}:${role}`] ??= []), v);
        }
      }
    }
  }

  const corr: Record<string, CorrectionCounts> = {};
  for (const id of EXPLICIT_WEIGHT_IDS) corr[id] = { assumed: 0, assumedCorrected: 0, answered: 0, answeredCorrected: 0 };
  // How many values of each source the interview produced, to turn correction counts into rates.
  for (const o of outcomes) {
    for (const [dim, { src }] of Object.entries(o.dims)) {
      const c = corr[dim];
      if (!c) continue;
      if (src === "assumed") c.assumed++;
      else if (src === "story" || src === "asked") c.answered++;
    }
  }
  for (const e of corrections) {
    const c = corr[e.dim];
    if (!c || !isRealCorrection(e.dim, e.from, e.to)) continue;
    if (e.src === "assumed") c.assumedCorrected++;
    else c.answeredCorrected++;
  }

  return { version, createdAt: now.toISOString(), interviews: outcomes.length, levels, corrections: corr };
}

// ---------------------------------------------------------------------------
// Reading the model for one pilot
// ---------------------------------------------------------------------------

/** How many pilots of its own a group needs before its data counts as much as everything above it. */
const SHRINK = 15;
/** A group's own answers only drive a decision once it has at least this many. */
const MIN_LEVEL_SUPPORT = 20;

export interface ResolvedDim {
  dim: string;
  shares: Record<Bucket, number>;
  majority: Bucket;
  /** Share of pilots in the majority answer. */
  consensus: number;
  /** Pilots behind the most specific group the decision rests on. */
  support: number;
  /** Typical strength of a lean, 0..100 (0 when most say it doesn't matter). */
  typicalStrength: number;
  /** How often this group answer has matched a real new answer, and on how many. */
  accuracy: number;
  validated: number;
}

export interface ResolvedCohort {
  version: string;
  /** Interviews in the most specific group that has real data. */
  groupSize: number;
  dims: Record<string, ResolvedDim>;
  /** Topic id -> share of times asking it produced something new. */
  topicYield: Record<string, { rate: number; asked: number }>;
  /** Typical numbers pilots in this group give ("daysOff:ideal" -> median and middle half). */
  targets: Record<string, { median: number; low: number; high: number; n: number }>;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Everything the model knows that applies to one pilot, blended from the
 * whole fleet down to their exact base/aircraft/seat/commute group: each
 * group starts from the answer of the group above it and moves toward its
 * own pilots' answers as they accumulate (empirical-Bayes shrinkage), so a
 * brand-new base borrows the fleet's answer and an established one speaks
 * for itself.
 */
export function resolveCohort(model: InterviewModel, cohort: Pick<Cohort, "base" | "aircraft" | "seat" | "commute">): ResolvedCohort {
  const levels = cohortLevels(cohort).map((k) => model.levels[k]).filter((l): l is LevelStats => !!l);
  const dims: Record<string, ResolvedDim> = {};

  for (const dim of EXPLICIT_WEIGHT_IDS) {
    let shares: Record<Bucket, number> = { zero: 1 / 3, pos: 1 / 3, neg: 1 / 3 };
    let accuracy = 0.5;
    let support = 0;
    let validated = 0;
    let absSum = 0;
    let nonZero = 0;
    for (const L of levels) {
      const c = L.dims[dim];
      if (c && c.n > 0) {
        const w = c.n / (c.n + SHRINK);
        shares = {
          zero: w * (c.zero / c.n) + (1 - w) * shares.zero,
          pos: w * (c.pos / c.n) + (1 - w) * shares.pos,
          neg: w * (c.neg / c.n) + (1 - w) * shares.neg,
        };
        if (c.n >= MIN_LEVEL_SUPPORT || support === 0) support = c.n;
        absSum += c.absSum;
        nonZero += c.pos + c.neg;
      }
      const v = L.validation[dim];
      if (v && v.predicted > 0) {
        const w = v.predicted / (v.predicted + SHRINK);
        accuracy = w * (v.correct / v.predicted) + (1 - w) * accuracy;
        if (v.predicted >= MIN_LEVEL_SUPPORT || validated === 0) validated = v.predicted;
      }
    }
    const majority = (Object.entries(shares) as [Bucket, number][]).sort((a, b) => b[1] - a[1])[0][0];
    dims[dim] = {
      dim,
      shares,
      majority,
      consensus: shares[majority],
      support,
      typicalStrength: majority === "zero" || nonZero === 0 ? 0 : Math.round(absSum / nonZero),
      accuracy,
      validated,
    };
  }

  const specific = [...levels].reverse().find((l) => l.interviews > 0);
  const topicYield: ResolvedCohort["topicYield"] = {};
  const targets: ResolvedCohort["targets"] = {};
  // Topic yield and typical numbers come from the most specific group with enough of them.
  for (const L of [...levels].reverse()) {
    for (const [topic, t] of Object.entries(L.topics)) {
      if (topicYield[topic] || t.asked < 10) continue;
      topicYield[topic] = { rate: t.productive / Math.max(1, t.asked - t.skipped), asked: t.asked };
    }
    for (const [key, sorted] of Object.entries(L.targets)) {
      if (targets[key] || sorted.length < 10) continue;
      targets[key] = { median: quantile(sorted, 0.5), low: quantile(sorted, 0.25), high: quantile(sorted, 0.75), n: sorted.length };
    }
  }

  return { version: model.version, groupSize: specific?.interviews ?? 0, dims, topicYield, targets };
}

// ---------------------------------------------------------------------------
// Deciding what to ask
// ---------------------------------------------------------------------------

/** The bar a group answer has to clear before the interview skips asking it. */
export const ASSUME_RULES = {
  /** At least this share of the group answers it the same way… */
  minConsensus: 0.8,
  /** …across at least this many real answers… */
  minSupport: 40,
  /** …and it has predicted at least this many new answers before they were given… */
  minValidated: 20,
  /** …correctly at least this often… */
  minAccuracy: 0.85,
  /** …and pilots haven't been correcting the assumption afterward more than this. */
  maxCorrectionRate: 0.15,
} as const;

/** Never skipped, however predictable — the dimension a pilot's whole ranking leans on most. */
const ALWAYS_ASK = new Set(["daysOff"]);

export interface DimDecision {
  dim: string;
  action: "ask" | "assume";
  /** Asked even though it could have been assumed — how the model keeps measuring its own accuracy. */
  exploring: boolean;
  prediction: Bucket;
  why: string;
}

export interface InterviewPolicy {
  version: string;
  groupSize: number;
  decisions: Record<string, DimDecision>;
  /** Dimensions where pilots in this group disagree most — the ones most worth asking well. */
  focus: { dim: string; shares: Record<Bucket, number>; support: number }[];
  /** Topics that usually surface something new for pilots like this, and ones that rarely do. */
  productiveTopics: string[];
  quietTopics: string[];
  targets: ResolvedCohort["targets"];
}

/** Chance of asking a question the model could skip — high while its accuracy is still thinly measured, settling to a floor that keeps checking forever. */
export function explorationRate(validated: number): number {
  return Math.max(0.05, 0.3 * (20 / (20 + validated)));
}

function entropy(shares: Record<Bucket, number>): number {
  return -Object.values(shares).reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
}

export function decideInterviewPolicy(
  resolved: ResolvedCohort,
  corrections: Record<string, CorrectionCounts>,
  random: () => number
): InterviewPolicy {
  const decisions: Record<string, DimDecision> = {};
  for (const d of Object.values(resolved.dims)) {
    const c = corrections[d.dim];
    const correctionRate = c && c.assumed >= 10 ? c.assumedCorrected / c.assumed : 0;
    const blockers: string[] = [];
    if (ALWAYS_ASK.has(d.dim)) blockers.push("always asked");
    if (d.consensus < ASSUME_RULES.minConsensus) blockers.push(`only ${Math.round(d.consensus * 100)}% agree`);
    if (d.support < ASSUME_RULES.minSupport) blockers.push(`${d.support} answers so far`);
    if (d.validated < ASSUME_RULES.minValidated) blockers.push(`checked on ${d.validated} new pilots`);
    if (d.accuracy < ASSUME_RULES.minAccuracy) blockers.push(`${Math.round(d.accuracy * 100)}% accurate`);
    if (correctionRate > ASSUME_RULES.maxCorrectionRate) blockers.push(`${Math.round(correctionRate * 100)}% corrected later`);

    if (blockers.length > 0) {
      decisions[d.dim] = { dim: d.dim, action: "ask", exploring: false, prediction: d.majority, why: blockers.join(", ") };
      continue;
    }
    const exploring = random() < explorationRate(d.validated);
    decisions[d.dim] = {
      dim: d.dim,
      action: exploring ? "ask" : "assume",
      exploring,
      prediction: d.majority,
      why: `${Math.round(d.consensus * 100)}% of ${d.support} agree, ${Math.round(d.accuracy * 100)}% accurate on ${d.validated} new pilots${exploring ? " — asked anyway to keep checking" : ""}`,
    };
  }

  const focus = Object.values(resolved.dims)
    .filter((d) => d.support >= 10 && decisions[d.dim].action === "ask")
    .sort((a, b) => entropy(b.shares) - entropy(a.shares))
    .slice(0, 6)
    .map((d) => ({ dim: d.dim, shares: roundShares(d.shares), support: d.support }));

  const yields = Object.entries(resolved.topicYield).sort((a, b) => b[1].rate - a[1].rate);
  return {
    version: resolved.version,
    groupSize: resolved.groupSize,
    decisions,
    focus,
    productiveTopics: yields.filter(([, y]) => y.rate >= 0.6).slice(0, 5).map(([t]) => t),
    quietTopics: yields.filter(([, y]) => y.rate <= 0.25).slice(0, 5).map(([t]) => t),
    targets: resolved.targets,
  };
}

function roundShares(s: Record<Bucket, number>): Record<Bucket, number> {
  return { zero: Math.round(s.zero * 100) / 100, pos: Math.round(s.pos * 100) / 100, neg: Math.round(s.neg * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Checking a model before trusting it
// ---------------------------------------------------------------------------

export interface InterviewBacktest {
  /** Real answers in the held-out interviews the model was scored on. */
  answers: number;
  /** Share it predicted the right bucket for. */
  accuracy: number;
  /** Average log loss of its predicted shares — lower is better, and it punishes confident misses. */
  logLoss: number;
}

/**
 * Scores a model on interviews it never saw: for each real answer, how
 * likely the model said that answer was. Used to decide whether a freshly
 * learned model replaces the one in use (champion/challenger) — a model
 * that got worse on the newest pilots is never promoted, however much more
 * data it was trained on.
 */
export function backtestInterviewModel(model: InterviewModel, heldOut: InterviewOutcome[]): InterviewBacktest {
  let answers = 0;
  let correct = 0;
  let loss = 0;
  for (const o of heldOut) {
    const r = resolveCohort(model, o.cohort);
    for (const [dim, { w, src }] of Object.entries(o.dims)) {
      if (src !== "story" && src !== "asked" && src !== "edited") continue;
      const d = r.dims[dim];
      if (!d) continue;
      const b = bucketOf(dim, w);
      answers++;
      if (d.majority === b) correct++;
      loss += -Math.log(Math.max(0.02, d.shares[b]));
    }
  }
  return { answers, accuracy: answers ? correct / answers : 0, logLoss: answers ? loss / answers : Infinity };
}
