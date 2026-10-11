import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel } from "@/types/pilot-model";

/**
 * Tuning a pilot's weights to the lines they actually chose. Words say what a
 * pilot cares about; a choice between two real lines says how they trade one
 * thing for another — the part words get wrong most often (a pilot can call
 * commuting "important" and still not weigh it heavily enough).
 *
 * For every choice the model gets wrong (or calls too close), each criterion
 * moves in proportion to how much better the chosen line did on it than the
 * other — up when the chosen line won it, down when it lost it. A few passes
 * settle it. No criterion moves more than `MAX_FACTOR` either way from where
 * the interview put it, so a handful of choices sharpen the model rather than
 * overturn everything the pilot said.
 */

const MAX_FACTOR = 3;
const PASSES = 6;
const RATE = 0.9;
/** How clearly the model must prefer the chosen line before a choice counts as matched, in score points. */
const MARGIN = { slightly: 0.5, strongly: 4 } as const;

export interface WeightChange {
  criterionId: string;
  label: string;
  from: number;
  to: number;
}

export function fitWeightsToChoices(
  bidPack: BidPack,
  model: PilotModel,
  choices: LineChoice[],
  pack: PackMetrics = prepareMetrics(bidPack)
): { model: PilotModel; changes: WeightChange[]; agreedBefore: number; agreedAfter: number } {
  const usable = choices.filter((c) => c.preferred !== c.other);
  const agreement = (m: PilotModel) => {
    const byLine = new Map(scorePackV2(bidPack, m, { pack }).map((s) => [s.lineNumber, s]));
    return usable.filter((c) => (byLine.get(c.preferred)?.score ?? 0) > (byLine.get(c.other)?.score ?? 0)).length;
  };
  const agreedBefore = agreement(model);
  if (usable.length === 0 || model.criteria.length === 0) return { model, changes: [], agreedBefore, agreedAfter: agreedBefore };

  const original = new Map(model.criteria.map((c) => [c.id, c.weight]));
  let current = model;
  for (let pass = 0; pass < PASSES; pass++) {
    const byLine = new Map(scorePackV2(bidPack, current, { pack }).map((s) => [s.lineNumber, s]));
    const factor = new Map<string, number>();
    let missed = 0;
    for (const c of usable) {
      const a = byLine.get(c.preferred);
      const b = byLine.get(c.other);
      if (!a || !b) continue;
      if (a.score - b.score >= MARGIN[c.strength]) continue;
      missed++;
      const push = c.strength === "strongly" ? 1 : 0.5;
      for (const ra of a.results) {
        const rb = b.results.find((r) => r.criterionId === ra.criterionId);
        if (!rb || ra.value === null || rb.value === null) continue;
        factor.set(ra.criterionId, (factor.get(ra.criterionId) ?? 0) + push * (ra.utility - rb.utility));
      }
    }
    if (missed === 0) break;
    const criteria = current.criteria.map((c) => {
      const f = Math.exp(RATE * (factor.get(c.id) ?? 0));
      const base = original.get(c.id) ?? c.weight;
      const next = Math.min(base * MAX_FACTOR, Math.max(base / MAX_FACTOR, c.weight * f));
      return { ...c, weight: next };
    });
    // Weights stay relative to the strongest priority, as everywhere else.
    const top = Math.max(...criteria.map((c) => c.weight)) || 1;
    current = { ...current, criteria: criteria.map((c) => ({ ...c, weight: c.weight / top })) };
  }

  const agreedAfter = agreement(current);
  // Only keep the fit if it actually explains the choices better.
  if (agreedAfter < agreedBefore) return { model, changes: [], agreedBefore, agreedAfter: agreedBefore };
  const changes = current.criteria
    .map((c) => ({ criterionId: c.id, label: c.label, from: model.criteria.find((x) => x.id === c.id)!.weight, to: c.weight }))
    .filter((x) => Math.abs(x.to - x.from) >= 0.02);
  return { model: current, changes, agreedBefore, agreedAfter };
}
