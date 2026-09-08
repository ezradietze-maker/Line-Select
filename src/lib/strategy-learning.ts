import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";
import type { StrategyId } from "@/types/strategy";

/**
 * How a pilot reacts to a specific Strategies-board suggestion is real
 * signal about their risk tolerance and admin-effort appetite — the same
 * "behavior teaches the profile" principle `rank-learning.ts`'s drag-to-
 * reorder already uses for line rankings, just without that module's full
 * Bradley-Terry line-scoring model (there's no "predicted probability this
 * pilot dismisses Ghost Line" to compute an error against — a reaction is a
 * standalone signal, not a pairwise comparison).
 */

/**
 * Which trait a strategy's use/dismissal actually reflects, and which
 * direction "using" it points toward. Strategies absent here (Reserve
 * Ladder, Vacation Vault) teach nothing either way — same reasoning
 * `strategy-engine.ts`'s own `FIT_FACTORS` already uses to exclude Reserve
 * Ladder from preference-fit ranking ("whether it applies to you depends on
 * circumstance, not a stated preference").
 */
const STRATEGY_TRAIT_HINTS: Partial<Record<StrategyId, { key: "riskTolerance" | "adminEffortAppetite"; favorsHigh: boolean }[]>> = {
  "ghost-line": [{ key: "riskTolerance", favorsHigh: true }],
  "mega-trip": [{ key: "riskTolerance", favorsHigh: true }],
  "recurring-turn": [{ key: "riskTolerance", favorsHigh: false }],
  "safety-net": [{ key: "riskTolerance", favorsHigh: false }],
  "re-bid-chain": [{ key: "adminEffortAppetite", favorsHigh: true }],
  "reserve-avoidance": [{ key: "adminEffortAppetite", favorsHigh: true }],
  "trip-trading": [
    { key: "adminEffortAppetite", favorsHigh: true },
    { key: "riskTolerance", favorsHigh: true },
  ],
  "grievance-slide": [{ key: "adminEffortAppetite", favorsHigh: true }],
};

/** Out of -100..100 — a single reaction moves a trait a real but modest amount, shrinking as confidence in that trait builds (see `effectiveStep`), never a full override. */
const BASE_STEP = 10;

function effectiveStep(confidence: number): number {
  return BASE_STEP / (1 + confidence * 3);
}

export interface StrategyTraitUpdate {
  key: "riskTolerance" | "adminEffortAppetite";
  before: number;
  after: number;
}

export interface StrategyReactionResult {
  weights: PreferenceWeights;
  implicitConfidence: Record<string, number>;
  /** Empty for a strategy with no trait mapping (Reserve Ladder, Vacation Vault) — a real, valid outcome, not an error. */
  updates: StrategyTraitUpdate[];
}

/**
 * Folds one reaction into the profile's `riskTolerance`/`adminEffortAppetite`
 * weights — pure, so the caller (a UI event handler) decides when to persist
 * the result via the ordinary `saveProfile` path, the same pattern
 * `learnFromReorder` already establishes for drag-to-reorder judgments.
 */
export function learnFromStrategyReaction(
  profile: PreferenceProfile,
  strategyId: StrategyId,
  reaction: "used" | "dismissed"
): StrategyReactionResult {
  const hints = STRATEGY_TRAIT_HINTS[strategyId] ?? [];
  const weights = { ...profile.weights };
  const confidence = { ...profile.implicitConfidence };
  const updates: StrategyTraitUpdate[] = [];

  for (const hint of hints) {
    const currentConfidence = confidence[hint.key] ?? 0;
    const step = effectiveStep(currentConfidence);
    // "used" moves toward whatever direction this strategy favors;
    // "dismissed" moves away from it — an XNOR of the two booleans.
    const direction = (reaction === "used") === hint.favorsHigh ? 1 : -1;
    const before = weights[hint.key];
    const after = Math.min(100, Math.max(-100, before + direction * step));
    weights[hint.key] = after;
    confidence[hint.key] = Math.min(1, currentConfidence + 0.15);
    updates.push({ key: hint.key, before, after });
  }

  return { weights, implicitConfidence: confidence, updates };
}
