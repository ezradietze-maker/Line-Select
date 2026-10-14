import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { criterionWeight, scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel } from "@/types/pilot-model";

/**
 * Tuning a pilot's weights to the lines they actually chose. Words say what a
 * pilot cares about; a choice between two real lines says how they trade one
 * thing for another — the part words get wrong most often (a pilot can call
 * commuting "important" and still not weigh it heavily enough).
 *
 * Each choice is a soft constraint on the two lines' score gap: the line they
 * picked should come out ahead — clearly for "easily", only just for "just".
 * An "easily" pulls harder the further the model is from agreeing with it; a
 * "just" pulls at most a fixed amount, so a close call far from everything
 * else the pilot said barely moves anything — it's most likely a reason the
 * two lines' differences don't show.
 * Every weight is pulled back toward where the interview put it, so moving one
 * far takes several choices pointing the same way. A single close call can be
 * made for reasons the lines' headline differences don't show, and on its own
 * it mustn't cut a priority the pilot stated over and over — on a replayed
 * interview (Oct 13 2026) one "just" between two lines that differed on five
 * things cut a priority the pilot had stated repeatedly to a third, the most
 * it could move. No weight moves more than `MAX_FACTOR` either way.
 *
 * A line's score is 100·(1 − √S), S = Σ wᵢ(1 − uᵢ)² / Σ wᵢ, and the utilities
 * don't depend on the weights, so they're measured once and the fit searches
 * over (log) weights directly.
 *
 * Tuned on a real pilot's verdicts (held out) and every simulated
 * interview: it learns from real choices almost as fast as the old
 * fit-until-it-agrees approach, and loses much less to noisy ones.
 */

const MAX_FACTOR = 3;
/** How hard weights are pulled back to the interview's: the penalty per criterion on (log of how far it moved)². */
const PULL_BACK = 0.5;
/** Score points over which a choice's constraint goes from mostly met to mostly missed. */
const TEMPERATURE = 3;
/** A close call the pilot made directly (dragging a line past another) pulls like an easy call, at this share. */
const DIRECT_CLOSE_CALL = 0.35;
/** The score gap each kind of choice asks for. */
const MARGIN = { strongly: 4, slightly: 0.5 } as const;
const MAX_STEPS = 300;

export interface WeightChange {
  criterionId: string;
  label: string;
  from: number;
  to: number;
}

const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)));

export function fitWeightsToChoices(
  bidPack: BidPack,
  model: PilotModel,
  choices: LineChoice[],
  pack: PackMetrics = prepareMetrics(bidPack)
): { model: PilotModel; changes: WeightChange[]; agreedBefore: number; agreedAfter: number } {
  const usable = choices.filter((c) => c.preferred !== c.other);
  const scored = new Map(scorePackV2(bidPack, model, { pack }).map((s) => [s.lineNumber, s]));
  const agreement = (m: PilotModel) => {
    const byLine = new Map(scorePackV2(bidPack, m, { pack }).map((s) => [s.lineNumber, s.score]));
    return usable.filter((c) => (byLine.get(c.preferred) ?? 0) > (byLine.get(c.other) ?? 0)).length;
  };
  const agreedBefore = usable.filter((c) => (scored.get(c.preferred)?.score ?? 0) > (scored.get(c.other)?.score ?? 0)).length;
  const pairs = usable.filter((c) => scored.has(c.preferred) && scored.has(c.other));
  if (pairs.length === 0 || model.criteria.length === 0) return { model, changes: [], agreedBefore, agreedAfter: agreedBefore };

  // Each line's shortfall² on every criterion, and whether it was measured (unmeasured counts half, as in scoring).
  const ids = model.criteria.map((c) => c.id);
  const base = model.criteria.map(criterionWeight);
  const shortfalls = (line: string) => {
    const s = scored.get(line)!;
    return ids.map((id) => {
      const r = s.results.find((x) => x.criterionId === id);
      return r ? { sf: (1 - r.utility) ** 2, half: r.value === null } : { sf: 0, half: true };
    });
  };
  const data = pairs.map((c) => ({ c, a: shortfalls(c.preferred), b: shortfalls(c.other) }));
  const scoreOf = (d: { sf: number; half: boolean }[], w: number[]) => {
    let num = 0;
    let den = 0;
    for (let i = 0; i < d.length; i++) {
      const wi = d[i].half ? w[i] / 2 : w[i];
      num += wi * d[i].sf;
      den += wi;
    }
    return 100 * (1 - Math.sqrt(num / (den || 1)));
  };
  const loss = (theta: number[]) => {
    const w = base.map((b, i) => b * Math.exp(theta[i]));
    let total = 0;
    for (const { c, a, b } of data) {
      const miss = -(scoreOf(a, w) - scoreOf(b, w) - MARGIN[c.strength]) / TEMPERATURE;
      total += c.strength === "strongly" ? softplus(miss) : c.direct ? DIRECT_CLOSE_CALL * softplus(miss) : 1 / (1 + Math.exp(-miss));
    }
    return total + PULL_BACK * theta.reduce((s, t) => s + t * t, 0);
  };

  // Gradient descent on the log-weights, with a step that grows while it helps and shrinks when it doesn't.
  const cap = Math.log(MAX_FACTOR);
  let theta = ids.map(() => 0);
  let current = loss(theta);
  let step = 0.2;
  for (let i = 0; i < MAX_STEPS && step > 1e-4; i++) {
    const grad = theta.map((_, k) => {
      const nudged = [...theta];
      nudged[k] += 1e-4;
      return (loss(nudged) - current) / 1e-4;
    });
    const next = theta.map((t, k) => Math.max(-cap, Math.min(cap, t - step * grad[k])));
    const value = loss(next);
    if (value < current) {
      theta = next;
      current = value;
      step *= 1.2;
    } else step *= 0.5;
  }

  // Weights stay relative to the strongest priority, as everywhere else.
  const raw = model.criteria.map((c, i) => c.weight * Math.exp(theta[i]));
  const top = Math.max(...raw) || 1;
  const fitted: PilotModel = { ...model, criteria: model.criteria.map((c, i) => ({ ...c, weight: raw[i] / top })) };
  const agreedAfter = agreement(fitted);
  // Only keep the fit if it explains the choices at least as well.
  if (agreedAfter < agreedBefore) return { model, changes: [], agreedBefore, agreedAfter: agreedBefore };
  const changes = fitted.criteria
    .map((c, i) => ({ criterionId: c.id, label: c.label, from: model.criteria[i].weight, to: c.weight }))
    .filter((x) => Math.abs(x.to - x.from) >= 0.02);
  return { model: fitted, changes, agreedBefore, agreedAfter };
}
