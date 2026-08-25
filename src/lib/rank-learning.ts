import type { LineScore } from "@/lib/scoring";
import type { PreferenceWeights } from "@/types/preferences";

/** How far one manual correction can nudge a weight — same order of magnitude as a trade-off answer's nudge in preference-logic.ts. */
const REORDER_NUDGE_MAGNITUDE = 15;

/** Below this, two lines read as too similar on a dimension to justify pinning the correction to it — a coincidence, not a real signal. */
const MIN_MEANINGFUL_GAP = 0.08;

/**
 * Dimensions with a direct 1:1 weight to nudge — valid both as a
 * DimensionScore.key and a PreferenceWeights key. `cityPreference` and
 * `layoverQuality` are driven by several weights (or a flat constant) at
 * once rather than one, so there's no single, honest weight to attribute a
 * correction to — a manual reorder best explained by one of those is simply
 * not learned from, rather than guessing which of several inputs to blame.
 */
type DirectDimensionKey =
  | "daysOff"
  | "tripLength"
  | "tripCount"
  | "international"
  | "region"
  | "reportTime"
  | "creditHours"
  | "deadheadTolerance";

const DIRECT_DIMENSIONS: DirectDimensionKey[] = [
  "daysOff",
  "tripLength",
  "tripCount",
  "international",
  "region",
  "reportTime",
  "creditHours",
  "deadheadTolerance",
];

export interface ReorderLearnResult {
  weights: PreferenceWeights;
  /** Which dimension the correction was attributed to, or null if nothing stood out clearly enough to learn from. */
  adjustedDimension: DirectDimensionKey | null;
}

/**
 * A pilot moving `favored` above `overtaken` (or `overtaken` below
 * `favored`) is a live correction: the current weights scored this pair in
 * the wrong order. Rather than trying to attribute the correction across
 * every dimension at once, this looks for whichever single verified
 * dimension the two lines differ on most — the most legible explanation for
 * why a pilot would make that call — and nudges that one weight toward
 * favoring `favored`'s side of it. Small, repeatable nudges rather than one
 * big jump, so a pilot who keeps correcting keeps refining the same
 * direction rather than overshooting from a single click.
 */
export function learnFromReorder(
  weights: PreferenceWeights,
  favored: LineScore,
  overtaken: LineScore
): ReorderLearnResult {
  let bestDimension: DirectDimensionKey | null = null;
  let bestGap = MIN_MEANINGFUL_GAP;

  for (const key of DIRECT_DIMENSIONS) {
    const favoredDim = favored.dimensions.find((d) => d.key === key);
    const overtakenDim = overtaken.dimensions.find((d) => d.key === key);
    if (!favoredDim || !overtakenDim || !favoredDim.verified || !overtakenDim.verified) continue;

    const gap = Math.abs(favoredDim.value - overtakenDim.value);
    if (gap > bestGap) {
      bestGap = gap;
      bestDimension = key;
    }
  }

  if (!bestDimension) {
    return { weights, adjustedDimension: null };
  }

  const favoredDim = favored.dimensions.find((d) => d.key === bestDimension)!;
  const overtakenDim = overtaken.dimensions.find((d) => d.key === bestDimension)!;
  // Nudging the weight toward whichever side `favored` sits on raises its
  // match on this dimension relative to `overtaken`'s, the same mechanism
  // weightToTarget already uses everywhere else in scoring.ts.
  const direction = favoredDim.value > overtakenDim.value ? 1 : -1;

  const current = weights[bestDimension];
  const nudged = Math.min(100, Math.max(-100, current + direction * REORDER_NUDGE_MAGNITUDE));

  return {
    weights: { ...weights, [bestDimension]: nudged },
    adjustedDimension: bestDimension,
  };
}
