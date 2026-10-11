import type { PilotModel } from "@/types/pilot-model";

/** A pilot's verdict on one priority as the interview read it back. */
export type PriorityVerdict = "right" | "more" | "less" | "drop";

const MORE = 1.6;
const LESS = 0.55;

/**
 * Applies the pilot's own review of their priorities: "count more" and
 * "count less" rescale a criterion decisively, "doesn't matter" removes it,
 * and "right" marks it confirmed. Weights stay relative to the strongest
 * priority afterwards, so raising one is felt against all the others.
 */
export function applyPriorityReview(model: PilotModel, verdicts: Record<string, PriorityVerdict | undefined>): PilotModel {
  const criteria = model.criteria
    .filter((c) => verdicts[c.id] !== "drop")
    .map((c) => {
      const v = verdicts[c.id];
      if (v === "more") return { ...c, weight: c.weight * MORE, confidence: Math.max(c.confidence, 0.9) };
      if (v === "less") return { ...c, weight: c.weight * LESS, confidence: Math.max(c.confidence, 0.9) };
      if (v === "right") return { ...c, confidence: Math.max(c.confidence, 0.95) };
      return c;
    });
  const top = Math.max(0, ...criteria.map((c) => c.weight)) || 1;
  return { ...model, criteria: criteria.map((c) => ({ ...c, weight: Math.min(1, c.weight / top) })) };
}
