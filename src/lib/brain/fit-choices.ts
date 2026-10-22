import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { criterionWeight, scorePackV2 } from "@/lib/scoring-v2/score";
import { scoreTripsV2, type TripScore } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel, TripChoice } from "@/types/pilot-model";

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
/**
 * How hard weights are pulled back to the interview's: the penalty per criterion on (log of how far it moved)². Set on
 * the ex-pilot's own sort (Oct 22 2026): handing the fit a few of its comparisons and checking the rest, 0.5 made the
 * held-out ones slightly worse (−0.2 points) — it kept widening gaps the model already had right — while 2 helps
 * (+0.1 to +0.3 with four or eight choices) and roughly halved the worst loss on the simulated interviews.
 */
const PULL_BACK = 2;
/**
 * The same for trip choices, set by how much the grades surprised the model: it learns in proportion to how wrong it
 * was. Grades it mostly foresaw hold the trip weights near the line weights — fitting them anyway only chases wider
 * score gaps, and on a simulated commuter whose grades the model foresaw 40 times in 44 that tripled one priority
 * against what graders reading his words saw (trip agreement 0.80 → 0.73). Grades that keep surprising it are learned
 * from freely (0.5: on the trip bench, Oct 2026, the best for two screens of eight graded trips).
 */
const TRIP_PULL_BACK = { surprised: 0.5, foreseen: 4 } as const;
/** The share of the grades foreseen at or below which the fit learns freely, and at or above which it holds. */
const FORESEEN_RANGE = [0.6, 0.9] as const;

export function tripPullBack(shareForeseen: number): number {
  const [lo, hi] = FORESEEN_RANGE;
  const t = Math.min(1, Math.max(0, (shareForeseen - lo) / (hi - lo)));
  return TRIP_PULL_BACK.surprised * (TRIP_PULL_BACK.foreseen / TRIP_PULL_BACK.surprised) ** t;
}
/** Score points over which a choice's constraint goes from mostly met to mostly missed. */
const TEMPERATURE = 3;
/** A close call the pilot made directly (dragging a line past another) pulls like an easy call, at this share. */
const DIRECT_CLOSE_CALL = 0.35;
/**
 * The score gap each kind of choice asks for — small, so a choice the model already has the right way round pulls
 * little: the fit is there to fix what it gets wrong, not to widen what it gets right (same tests as `PULL_BACK`).
 */
const MARGIN = { strongly: 1, slightly: 0.25 } as const;
const MAX_STEPS = 300;

export interface WeightChange {
  criterionId: string;
  label: string;
  from: number;
  to: number;
}

const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)));

export interface LineFitOptions {
  /** How hard weights are pulled back to the interview's (default `PULL_BACK`). */
  pullBack?: number;
}

export function fitWeightsToChoices(
  bidPack: BidPack,
  model: PilotModel,
  choices: LineChoice[],
  pack: PackMetrics = prepareMetrics(bidPack),
  options: LineFitOptions = {}
): { model: PilotModel; changes: WeightChange[]; agreedBefore: number; agreedAfter: number } {
  // One verdict per two lines: a line pair and a bid check can land on the same two, and counting both doubled whatever
  // that one answer said (a simulated commuter's one off answer, counted twice, cut his line agreement 0.84 → 0.75).
  const seenPair = new Set<string>();
  const usable = choices.filter((c) => {
    if (c.preferred === c.other) return false;
    const k = [c.preferred, c.other].sort().join("|");
    if (seenPair.has(k)) return false;
    seenPair.add(k);
    return true;
  });
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
  const theta = fitLogWeights(base, pairs.map((c) => ({ strength: c.strength, direct: c.direct, a: shortfalls(c.preferred), b: shortfalls(c.other) })), options.pullBack ?? PULL_BACK);

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

interface Shortfall {
  sf: number;
  half: boolean;
}

/**
 * The fit itself, for lines and trips alike: each choice is a soft constraint on the two scores' gap, every log-weight
 * is pulled back toward zero (where the interview put it), and none moves more than `MAX_FACTOR` either way. Returns
 * the log-weight change for each criterion.
 */
function fitLogWeights(base: number[], data: { strength: LineChoice["strength"]; direct?: boolean; a: Shortfall[]; b: Shortfall[] }[], pullBack = PULL_BACK, maxFactor = MAX_FACTOR): number[] {
  const scoreOf = (d: Shortfall[], w: number[]) => {
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
    for (const c of data) {
      const miss = -(scoreOf(c.a, w) - scoreOf(c.b, w) - MARGIN[c.strength]) / TEMPERATURE;
      total += c.strength === "strongly" ? softplus(miss) : c.direct ? DIRECT_CLOSE_CALL * softplus(miss) : 1 / (1 + Math.exp(-miss));
    }
    return total + pullBack * theta.reduce((s, t) => s + t * t, 0);
  };

  // Gradient descent on the log-weights, with a step that grows while it helps and shrinks when it doesn't.
  const cap = Math.log(maxFactor);
  let theta = base.map(() => 0);
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
  return theta;
}

/**
 * The pilot's trip choices, turned into how much each priority counts on a single trip relative to a line
 * (`PilotModel.tripWeights`). What matters across a month of lines isn't always what decides between two trips — a
 * commuter's commute count dominates their lines, yet between two trips a long layover in a city they love can win —
 * and only their own trip choices can say by how much. Same fit as line choices, on trip scores; the line weights are
 * untouched. A fit that explains fewer of the choices than none at all is dropped.
 */
export interface TripFitOptions {
  /** How hard trip factors are pulled back to 1 (default: from how surprised the model was — see `tripPullBack`). */
  pullBack?: number;
  /** No factor moves further than this either way (default `MAX_FACTOR`). */
  maxFactor?: number;
}

export function fitTripWeights(
  bidPack: BidPack,
  model: PilotModel,
  choices: TripChoice[],
  pack: PackMetrics = prepareMetrics(bidPack),
  options: TripFitOptions = {}
): { tripWeights: Record<string, number> | undefined; agreedBefore: number; agreedAfter: number } {
  const plain: PilotModel = { ...model, tripWeights: undefined };
  const scored = scoreTripsV2(bidPack, plain, { pack });
  const usable = choices.filter((c) => c.preferred !== c.other && scored.has(c.preferred) && scored.has(c.other));
  const agreed = (scores: Map<string, TripScore>) => usable.filter((c) => scores.get(c.preferred)!.score > scores.get(c.other)!.score).length;
  const agreedBefore = agreed(scored);
  if (!usable.length) return { tripWeights: undefined, agreedBefore, agreedAfter: agreedBefore };
  // Only the criteria a trip can show take part; the rest keep a factor of 1.
  const ids = scored.values().next().value!.results.map((r) => r.criterionId);
  const base = ids.map((id) => criterionWeight(model.criteria.find((c) => c.id === id)!));
  const shortfalls = (key: string) =>
    ids.map((id) => {
      const r = scored.get(key)!.results.find((x) => x.criterionId === id)!;
      return { sf: (1 - r.utility) ** 2, half: r.value === null };
    });
  const pullBack = options.pullBack ?? tripPullBack(agreedBefore / usable.length);
  const theta = fitLogWeights(base, usable.map((c) => ({ strength: c.strength, a: shortfalls(c.preferred), b: shortfalls(c.other) })), pullBack, options.maxFactor ?? MAX_FACTOR);
  const tripWeights = Object.fromEntries(ids.map((id, i) => [id, Math.exp(theta[i])]));
  const agreedAfter = agreed(scoreTripsV2(bidPack, { ...model, tripWeights }, { pack }));
  if (agreedAfter < agreedBefore) return { tripWeights: undefined, agreedBefore, agreedAfter: agreedBefore };
  return { tripWeights, agreedBefore, agreedAfter };
}
