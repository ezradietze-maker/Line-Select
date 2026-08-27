import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";
import type { HotelSubscores, LineScore } from "@/lib/scoring";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";

/**
 * Real pairwise preference learning, replacing the old heuristic ("find the
 * single biggest gap, nudge it a flat amount"). A drag-and-drop is treated
 * as a Bradley-Terry pairwise judgment — "for this pilot, favored beats
 * overtaken" — and every dimension the model knows about (explicit sliders,
 * hotel sub-aspects, and the whole implicit taxonomy from
 * `implicit-dimensions.ts`) gets a real logistic-regression gradient step
 * toward explaining that judgment, sized by how wrong the model's current
 * prediction was. This is the same math a Bradley-Terry/Elo-style ranking
 * model uses for one comparison: predict P(favored beats overtaken) from
 * the current weights, then move every weight a little in the direction
 * that would have made that prediction more correct.
 */

/** Below this, two lines read as too similar on a dimension for its difference to carry any real signal — pure floating-point/normalization noise, not evidence. */
const MIN_MEANINGFUL_GAP = 0.02;

/** How fast a single pairwise judgment can move a dimension's weight at zero confidence — this shrinks as confidence in that dimension grows (see `effectiveLearningRate`), so the model gets more stable about a variable the more it's seen. */
const BASE_LEARNING_RATE = 0.35;

/** How much a clear, confidence-worthy piece of evidence about one dimension raises confidence in it per event — scaled by how much that dimension actually differed between the two lines, so a comparison that barely touches a dimension doesn't inflate confidence in it. */
const CONFIDENCE_GAIN = 0.06;
/** How much confidence erodes when new evidence flatly contradicts a dimension's current learned direction — faster than confidence grows, so a pilot's drift away from a stale interview answer is picked up quickly (Section 5.5). */
const CONFIDENCE_CONTRADICTION_PENALTY = 0.1;

const EXPLICIT_LEARNABLE_KEYS: (keyof PreferenceWeights)[] = [
  "daysOff",
  "tripLength",
  "international",
  "reportTime",
  "creditHours",
  "deadheadTolerance",
];

const HOTEL_WEIGHT_KEYS: Record<keyof HotelSubscores, keyof PreferenceWeights> = {
  food: "hotelFood",
  gym: "hotelGym",
  grocery: "hotelGrocery",
  quiet: "hotelQuiet",
  quality: "hotelQuality",
};

/** Magnitude-only weights (0 = doesn't matter, 100 = matters a lot) — there's no "opposite" of caring about a quiet room, so these clamp to [0, 100] rather than [-100, 100]. */
const MAGNITUDE_ONLY_KEYS = new Set<keyof PreferenceWeights>(Object.values(HOTEL_WEIGHT_KEYS));

const EXPLICIT_LABELS: Partial<Record<keyof PreferenceWeights, string>> = {
  daysOff: "Days off",
  tripLength: "Trip length",
  international: "International mix",
  reportTime: "Report time",
  creditHours: "Credit hours",
  deadheadTolerance: "Deadheading",
  hotelFood: "Food near the hotel",
  hotelGym: "Hotel gym",
  hotelGrocery: "Grocery near the hotel",
  hotelQuiet: "Room quietness",
  hotelQuality: "Overall hotel quality",
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Confidence in [0,1] dampens the effective learning rate — a dimension the model has already seen a lot of consistent evidence about should move less per new data point than one it knows nothing about yet. */
function effectiveLearningRate(confidence: number): number {
  return BASE_LEARNING_RATE / (1 + confidence * 3);
}

export interface PairwiseJudgment {
  favored: LineScore;
  overtaken: LineScore;
}

export interface DimensionUpdate {
  id: string;
  label: string;
  isImplicit: boolean;
  gap: number;
  weightBefore: number;
  weightAfter: number;
  confidenceBefore: number;
  confidenceAfter: number;
}

export interface ReorderLearnResult {
  weights: PreferenceWeights;
  implicitWeights: Record<string, number>;
  implicitConfidence: Record<string, number>;
  /** Every dimension nudged across every judgment implied by this drag, largest-effect first. */
  updates: DimensionUpdate[];
  /** 0-1, how wrong the model's prediction was for the single most-surprising judgment in this drag — this is what gates the clarifying micro-prompt. */
  maxSurprise: number;
  mostSurprising: PairwiseJudgment | null;
}

/** A dimension's current signed "feature weight" in the unified linear model — on roughly the same -1..1 scale regardless of whether it's an explicit slider (-100..100 -> /100) or an already-comparably-scaled implicit weight. `cityPreference` has no single scalar weight to read (it's a set of flagged cities, not a slider), layoverQuality's own blended weight isn't gradient-updated directly (its five sub-aspects are, individually), and circadianHealth is opt-in with no slider of its own at all — all three are still included in the *prediction* via their real importance, just excluded from `EXPLICIT_LEARNABLE_KEYS` so nothing tries to write back a delta to a key that doesn't represent one weight. */
function explicitFeatureWeight(key: keyof PreferenceWeights, weights: PreferenceWeights): number {
  return weights[key] / 100;
}

function nonLearnedFeatureWeight(dimKey: "cityPreference" | "layoverQuality" | "circadianHealth", importance: number): number {
  // Both are one-directional (target is always "more of this is better"), so their contribution to the score is just how much the pilot has indicated this matters at all.
  return importance;
}

/** Predicted linear score for a line under the current model — higher means the model currently believes the pilot prefers this line. Not the same formula as the displayed 0-100 score (that one models per-dimension target-distance); this is the simpler linear-in-features form a pairwise logistic model is built on, and the two only need to agree on sign/direction, not on formula. */
function predictScore(
  line: LineScore,
  weights: PreferenceWeights,
  implicitValues: Record<string, number> | undefined,
  implicitWeights: Record<string, number>
): number {
  let score = 0;
  for (const dim of line.dimensions) {
    if (!dim.verified) continue;
    if (dim.key === "cityPreference" || dim.key === "layoverQuality" || dim.key === "circadianHealth") {
      score += nonLearnedFeatureWeight(dim.key, dim.importance) * dim.value;
      continue;
    }
    score += explicitFeatureWeight(dim.key, weights) * dim.value;
  }
  if (implicitValues) {
    for (const variable of IMPLICIT_VARIABLES) {
      score += (implicitWeights[variable.id] ?? 0) * implicitValues[variable.id];
    }
  }
  return score;
}

interface Candidate {
  id: string;
  label: string;
  isImplicit: boolean;
  gap: number;
  /** favoredValue - overtakenValue, signed — the direction the gradient pushes this dimension's weight. */
  signedDiff: number;
  currentWeight: number;
  currentConfidence: number;
  floor: number;
  ceiling: number;
  /** Divisor to convert an internal -1..1-ish weight delta back into this dimension's own storage scale (100 for a -100..100 slider, 1 for an implicit weight already on that scale). */
  toStorageScale: number;
}

export interface JudgmentFactor {
  id: string;
  label: string;
  isImplicit: boolean;
  gap: number;
  /** +1 if the favored trip has more of this variable's raw value than the overtaken one, -1 if less — what `reinforceVariable` needs to know which way to move the weight. */
  direction: 1 | -1;
}

/** The real, measured differences between two specific trips, largest first — what the clarifying micro-prompt's quick-select chips are built from (Section 5.3: chips should reflect the *visible* differences, not a generic fixed list). */
export function topJudgmentFactors(
  judgment: PairwiseJudgment,
  profile: PreferenceProfile,
  implicitValuesByLine: Record<string, Record<string, number>>,
  limit: number
): JudgmentFactor[] {
  const candidates = collectCandidates(
    judgment,
    profile.weights,
    implicitValuesByLine,
    profile.implicitWeights,
    profile.implicitConfidence
  );
  return candidates
    .sort((a, b) => b.gap - a.gap)
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      label: c.label,
      isImplicit: c.isImplicit,
      gap: c.gap,
      direction: c.signedDiff >= 0 ? 1 : -1,
    }));
}

/**
 * A pilot's direct answer (a tapped chip, or free text the classifier
 * mapped to a real variable) is stronger evidence than an implicit gradient
 * step ever gets on its own — Section 5.4 asks for "higher confidence than
 * a silent implicit update would have gotten." `direction` is which way the
 * evidence points (+1 = the favored trip having *more* of this variable is
 * why the pilot preferred it, -1 = less), decided by the caller from the
 * real value gap (chip) or the classifier's own read (free text).
 */
export function reinforceVariable(
  profile: PreferenceProfile,
  variableId: string,
  direction: 1 | -1
): PreferenceProfile {
  const REINFORCE_STEP = 0.5;
  const REINFORCE_CONFIDENCE = 0.8;
  const isImplicit = IMPLICIT_VARIABLES.some((v) => v.id === variableId);

  if (isImplicit) {
    const current = profile.implicitWeights[variableId] ?? 0;
    const next = Math.min(1.5, Math.max(-1.5, current + direction * REINFORCE_STEP));
    return {
      ...profile,
      implicitWeights: { ...profile.implicitWeights, [variableId]: next },
      implicitConfidence: {
        ...profile.implicitConfidence,
        [variableId]: Math.max(profile.implicitConfidence[variableId] ?? 0, REINFORCE_CONFIDENCE),
      },
    };
  }

  const key = variableId as keyof PreferenceWeights;
  const floor = MAGNITUDE_ONLY_KEYS.has(key) ? 0 : -100;
  const current = profile.weights[key];
  const next = Math.min(100, Math.max(floor, current + direction * REINFORCE_STEP * 100));
  return {
    ...profile,
    weights: { ...profile.weights, [key]: next },
    implicitConfidence: {
      ...profile.implicitConfidence,
      [key]: Math.max(profile.implicitConfidence[key] ?? 0, REINFORCE_CONFIDENCE),
    },
  };
}

function collectCandidates(
  judgment: PairwiseJudgment,
  weights: PreferenceWeights,
  implicitValuesByLine: Record<string, Record<string, number>>,
  implicitWeights: Record<string, number>,
  confidence: Record<string, number>
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const key of EXPLICIT_LEARNABLE_KEYS) {
    const favoredDim = judgment.favored.dimensions.find((d) => d.key === key);
    const overtakenDim = judgment.overtaken.dimensions.find((d) => d.key === key);
    if (!favoredDim || !overtakenDim || !favoredDim.verified || !overtakenDim.verified) continue;
    const signedDiff = favoredDim.value - overtakenDim.value;
    const gap = Math.abs(signedDiff);
    if (gap <= MIN_MEANINGFUL_GAP) continue;
    candidates.push({
      id: key,
      label: EXPLICIT_LABELS[key] ?? key,
      isImplicit: false,
      gap,
      signedDiff,
      currentWeight: weights[key],
      // Explicit answers start out trusted (a deliberate interview answer), decaying only when contradicted repeatedly — Section 5.5.
      currentConfidence: confidence[key] ?? (weights[key] !== 0 ? 0.7 : 0.3),
      floor: MAGNITUDE_ONLY_KEYS.has(key) ? 0 : -100,
      ceiling: 100,
      toStorageScale: 100,
    });
  }

  // Layover quality's five sub-aspects: only worth attributing to if the
  // two lines' *blended* layoverQuality actually differed enough to look
  // at, same reasoning as the direct dimensions above.
  const favoredLQ = judgment.favored.dimensions.find((d) => d.key === "layoverQuality");
  const overtakenLQ = judgment.overtaken.dimensions.find((d) => d.key === "layoverQuality");
  if (
    favoredLQ &&
    overtakenLQ &&
    favoredLQ.verified &&
    overtakenLQ.verified &&
    Math.abs(favoredLQ.value - overtakenLQ.value) > MIN_MEANINGFUL_GAP &&
    favoredLQ.hotelBreakdown &&
    overtakenLQ.hotelBreakdown
  ) {
    for (const sub of Object.keys(HOTEL_WEIGHT_KEYS) as (keyof HotelSubscores)[]) {
      const a = favoredLQ.hotelBreakdown[sub];
      const b = overtakenLQ.hotelBreakdown[sub];
      if (a === null || b === null) continue;
      const signedDiff = a - b;
      const gap = Math.abs(signedDiff);
      if (gap <= MIN_MEANINGFUL_GAP) continue;
      const key = HOTEL_WEIGHT_KEYS[sub];
      candidates.push({
        id: key,
        label: EXPLICIT_LABELS[key] ?? key,
        isImplicit: false,
        gap,
        signedDiff,
        currentWeight: weights[key],
        currentConfidence: confidence[key] ?? (weights[key] !== 0 ? 0.7 : 0.3),
        floor: 0,
        ceiling: 100,
        toStorageScale: 100,
      });
    }
  }

  const favoredImplicit = implicitValuesByLine[judgment.favored.line.id];
  const overtakenImplicit = implicitValuesByLine[judgment.overtaken.line.id];
  if (favoredImplicit && overtakenImplicit) {
    for (const variable of IMPLICIT_VARIABLES) {
      const signedDiff = favoredImplicit[variable.id] - overtakenImplicit[variable.id];
      const gap = Math.abs(signedDiff);
      if (gap <= MIN_MEANINGFUL_GAP) continue;
      candidates.push({
        id: variable.id,
        label: variable.label,
        isImplicit: true,
        gap,
        signedDiff,
        currentWeight: implicitWeights[variable.id] ?? 0,
        currentConfidence: confidence[variable.id] ?? 0,
        floor: -1.5,
        ceiling: 1.5,
        toStorageScale: 1,
      });
    }
  }

  return candidates;
}

/**
 * Applies one pairwise judgment's logistic gradient step to every dimension
 * with a meaningful gap, mutating `weights`/`implicitWeights`/`confidence`
 * in place and returning what changed plus this judgment's surprise score.
 */
function applyJudgment(
  judgment: PairwiseJudgment,
  weights: PreferenceWeights,
  implicitValuesByLine: Record<string, Record<string, number>>,
  implicitWeights: Record<string, number>,
  confidence: Record<string, number>
): { updates: DimensionUpdate[]; surprise: number } {
  const predictedFavored = predictScore(
    judgment.favored,
    weights,
    implicitValuesByLine[judgment.favored.line.id],
    implicitWeights
  );
  const predictedOvertaken = predictScore(
    judgment.overtaken,
    weights,
    implicitValuesByLine[judgment.overtaken.line.id],
    implicitWeights
  );
  // Bradley-Terry: P(favored beats overtaken) under the current model.
  const predictedProbFavoredWins = sigmoid(predictedFavored - predictedOvertaken);
  // The pilot's action IS the observed outcome (favored won), so the
  // logistic error is exactly 1 - predictedProb — small when the model
  // already expected this, large when it didn't. This number doubles as
  // the surprise score used to gate the clarifying micro-prompt.
  const error = 1 - predictedProbFavoredWins;

  const candidates = collectCandidates(judgment, weights, implicitValuesByLine, implicitWeights, confidence);
  const updates: DimensionUpdate[] = [];

  for (const c of candidates) {
    const lr = effectiveLearningRate(c.currentConfidence);
    // Standard single-example logistic-regression gradient ascent step for
    // a Bradley-Terry pair: move the weight toward whatever would have
    // made favored's predicted score higher relative to overtaken's.
    const delta = lr * error * c.signedDiff;
    const newWeightInternal = c.currentWeight / c.toStorageScale + delta;
    const clampedInternal = Math.min(c.ceiling / c.toStorageScale, Math.max(c.floor / c.toStorageScale, newWeightInternal));
    const newWeight = clampedInternal * c.toStorageScale;

    // Confidence grows when this evidence agrees with the dimension's
    // existing direction, and erodes faster when it flatly contradicts it
    // — a stale interview answer under sustained contradictory behavior
    // loses authority instead of staying pinned forever (Section 5.5).
    const agreesWithExisting = Math.sign(c.signedDiff) === Math.sign(c.currentWeight) || c.currentWeight === 0;
    const confidenceDelta = agreesWithExisting
      ? CONFIDENCE_GAIN * c.gap
      : -CONFIDENCE_CONTRADICTION_PENALTY * c.gap;
    const newConfidence = Math.min(1, Math.max(0, c.currentConfidence + confidenceDelta));

    if (c.isImplicit) {
      implicitWeights[c.id] = newWeight;
    } else {
      weights[c.id as keyof PreferenceWeights] = newWeight;
    }
    confidence[c.id] = newConfidence;

    updates.push({
      id: c.id,
      label: c.label,
      isImplicit: c.isImplicit,
      gap: c.gap,
      weightBefore: c.currentWeight,
      weightAfter: newWeight,
      confidenceBefore: c.currentConfidence,
      confidenceAfter: newConfidence,
    });
  }

  return { updates, surprise: error };
}

/**
 * Every pairwise judgment implied by one drag gesture (see `buildJudgments`
 * in ResultsView — dragging a line past several others is several
 * judgments, not one) gets its own gradient step. Returns the combined set
 * of dimension updates (sorted by effect size) and the single most
 * surprising judgment, which the caller uses to decide whether to fire the
 * clarifying micro-prompt.
 */
export function learnFromReorder(
  profile: PreferenceProfile,
  implicitValuesByLine: Record<string, Record<string, number>>,
  judgments: PairwiseJudgment[]
): ReorderLearnResult {
  const weights = { ...profile.weights };
  const implicitWeights = { ...profile.implicitWeights };
  const confidence = { ...profile.implicitConfidence };

  const allUpdates: DimensionUpdate[] = [];
  let maxSurprise = 0;
  let mostSurprising: PairwiseJudgment | null = null;

  for (const judgment of judgments) {
    const { updates, surprise } = applyJudgment(judgment, weights, implicitValuesByLine, implicitWeights, confidence);
    allUpdates.push(...updates);
    if (surprise > maxSurprise) {
      maxSurprise = surprise;
      mostSurprising = judgment;
    }
  }

  // Merge updates for the same dimension across multiple judgments in one
  // drag into a single before/after entry, so the UI shows one clean line
  // per dimension instead of duplicates.
  const merged = new Map<string, DimensionUpdate>();
  for (const u of allUpdates) {
    const existing = merged.get(u.id);
    if (!existing) {
      merged.set(u.id, u);
    } else {
      merged.set(u.id, { ...u, weightBefore: existing.weightBefore, confidenceBefore: existing.confidenceBefore });
    }
  }

  return {
    weights,
    implicitWeights,
    implicitConfidence: confidence,
    updates: Array.from(merged.values()).sort(
      (a, b) => Math.abs(b.weightAfter - b.weightBefore) - Math.abs(a.weightAfter - a.weightBefore)
    ),
    maxSurprise,
    mostSurprising,
  };
}

export interface ImplicitContribution {
  id: string;
  label: string;
  weight: number;
  confidence: number;
  /** weight * this line's normalized value — how much this specific line's score is actually being pushed by this variable, not just how important the variable is in the abstract. */
  contribution: number;
}

/** Below this, there isn't enough real evidence yet to call a learned implicit weight worth showing a pilot as "why" — a couple of noisy data points shouldn't be presented as a confident finding (Section 6). */
const MIN_CONFIDENCE_TO_EXPLAIN = 0.15;

/** The implicit-taxonomy factors actually driving one line's score for this pilot, largest contribution first — the "also learned from your drags" half of Section 6's explainability surface. */
export function topImplicitContributions(
  lineId: string,
  implicitValuesByLine: Record<string, Record<string, number>>,
  profile: PreferenceProfile,
  limit: number
): ImplicitContribution[] {
  const values = implicitValuesByLine[lineId];
  if (!values) return [];

  return IMPLICIT_VARIABLES.map((v) => {
    const weight = profile.implicitWeights[v.id] ?? 0;
    const confidence = profile.implicitConfidence[v.id] ?? 0;
    return { id: v.id, label: v.label, weight, confidence, contribution: weight * values[v.id] };
  })
    .filter((c) => c.confidence >= MIN_CONFIDENCE_TO_EXPLAIN && Math.abs(c.weight) > 0.01)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, limit);
}
