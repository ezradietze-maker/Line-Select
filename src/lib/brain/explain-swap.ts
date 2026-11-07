import { formatValue } from "@/lib/brain/describe";
import { LEARNER } from "@/lib/brain/reorder-learner";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { CriterionResult, V2LineScore } from "@/lib/scoring-v2/score";

/**
 * Why a pilot put one line above another — worked out from the model they were looking at (plan:
 * docs/plans/reorder-learning.md §4.3).
 *
 * A line's score is 100·(1 − √S), S = Σwᵢdᵢ / Σwᵢ with dᵢ = (1 − uᵢ)², so the gap between two lines splits exactly into
 * one share per priority: shareᵢ = 100·(wᵢᴮdᵢᴮ/Σwᴮ − wᵢᴬdᵢᴬ/Σwᴬ) / (√Sᴬ + √Sᴮ). The shares add up to the gap (before
 * any dealbreaker cap) — it's the Shapley split of a white-box score, no sampling needed (ShaRP, Pliatsika et al. 2024).
 * A share is influence, not weight: a priority that counts heavily but is the same on both lines explains nothing, and
 * isn't mentioned (Lipton's difference condition, via Miller 2019).
 *
 * Then, for each priority that favours the line the pilot put higher: by how much would it have to count for, on its
 * own, to put that line ahead? Only a change the brain would ever make (within `maxFactor`) can explain the swap.
 */

export interface SwapFactor {
  criterionId: string;
  label: string;
  /** Points of the score gap this priority accounts for: positive favours the line the pilot put higher. */
  share: number;
  higherValue: string;
  lowerValue: string;
  /** The two values as bare numbers, for a sentence that names the priority once: "3 vs 1". */
  amounts: string;
  /** How many times as much this priority would have to count, alone, to put the higher line ahead; null if no amount would. */
  flipAlone: number | null;
}

export type SwapVerdict =
  /** The brain already had them this way round. */
  | "agreed"
  /** One priority explains it. */
  | "clear"
  /** More than one priority could explain it on its own: the brain can't tell which. */
  | "ambiguous"
  /** Nothing the pilot has told us explains it — a reason the brain doesn't track. */
  | "unexplained"
  /** A dealbreaker decided the pair. */
  | "limit";

export interface SwapExplanation {
  verdict: SwapVerdict;
  /** Score gap before the swap, higher line minus lower (negative: the brain had the lower one ahead). */
  gap: number;
  /** Every priority the two lines differ on, the higher line's strongest reasons first. */
  factors: SwapFactor[];
  /** The priorities that could explain the swap on their own, likeliest first (the smallest change first). */
  explains: SwapFactor[];
  /** The lower line's biggest advantage: what the brain had it ahead for. */
  against: SwapFactor | null;
  /** For "limit": the dealbreaker the pilot overrode. */
  limit: string | null;
  /** For "limit": which priority it is, the higher line's value against the limit, said as "6 vs limit 4". */
  limitDetail: { criterionId: string; label: string; value: number; limit: number; op: "max" | "min"; amounts: string } | null;
}

/** Shares this small (score points) are left out: a difference the score barely notices isn't a reason. */
const MIN_SHARE = 0.05;

function valueOf(r: CriterionResult): string {
  const def = METRICS_BY_ID.get(r.metric);
  return r.value === null || !def ? "not measured" : formatValue(r.value, def);
}

/** A value as a bare number: a share as a percentage, whole numbers as they are, anything else to one decimal. */
function amountOf(r: CriterionResult): string {
  if (r.value === null) return "?";
  if (r.unit === "share") return `${Math.round(r.value * 100)}%`;
  return Number.isInteger(r.value) || Math.abs(r.value) >= 10 ? String(Math.round(r.value)) : String(Math.round(r.value * 10) / 10);
}

export function explainSwap(higher: V2LineScore, lower: V2LineScore): SwapExplanation {
  const gap = higher.score - lower.score;
  const cappedHigher = higher.violations.length > 0;
  const cappedLower = lower.violations.length > 0;
  const limit = cappedHigher && !cappedLower ? higher.violations[0].label : null;

  const lowerById = new Map(lower.results.map((r) => [r.criterionId, r]));
  const totalA = higher.results.reduce((a, r) => a + r.weight, 0) || 1;
  const totalB = lower.results.reduce((a, r) => a + r.weight, 0) || 1;
  const parts = higher.results.flatMap((a) => {
    const b = lowerById.get(a.criterionId);
    if (!b) return [];
    return [{ a, b, termA: (a.weight * (1 - a.utility) ** 2) / totalA, termB: (b.weight * (1 - b.utility) ** 2) / totalB }];
  });
  const SA = parts.reduce((s, p) => s + p.termA, 0);
  const SB = parts.reduce((s, p) => s + p.termB, 0);
  const scale = 100 / (Math.sqrt(SA) + Math.sqrt(SB) || 1);
  // The uncapped gap's numerator: Σ (termB − termA); the higher line is ahead when it's positive.
  const net = SB - SA;

  const factors: SwapFactor[] = parts
    .map(({ a, b, termA, termB }) => {
      const d = termB - termA;
      // Counting k times as much changes this term by (k − 1)·d (ignoring the small shift in Σw): ties at k = 1 − net/d.
      const k = d !== 0 ? 1 - net / d : Infinity;
      return {
        criterionId: a.criterionId,
        label: a.label,
        share: scale * d,
        higherValue: valueOf(a),
        lowerValue: valueOf(b),
        amounts: `${amountOf(a)} vs ${amountOf(b)}`,
        flipAlone: net >= 0 ? 1 : d > 0 && Number.isFinite(k) ? k : null,
      };
    })
    .filter((f) => Math.abs(f.share) >= MIN_SHARE)
    .sort((x, y) => y.share - x.share);

  const explains = net >= 0 ? [] : factors.filter((f) => f.share > 0 && f.flipAlone !== null && f.flipAlone <= LEARNER.maxFactor).sort((x, y) => x.flipAlone! - y.flipAlone!);
  const againstOnes = factors.filter((f) => f.share < 0);
  const against = againstOnes.length ? againstOnes[againstOnes.length - 1] : null;

  const verdict: SwapVerdict = limit ? "limit" : gap >= 0 ? "agreed" : explains.length === 1 ? "clear" : explains.length > 1 ? "ambiguous" : "unexplained";
  const v = limit ? higher.violations[0] : null;
  const round = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
  const limitDetail = v ? { criterionId: v.criterionId, label: v.label, value: v.value, limit: v.limit, op: v.op, amounts: `${round(v.value)} vs your limit of ${round(v.limit)}` } : null;
  return { verdict, gap, factors, explains, against, limit, limitDetail };
}

/** The swap's reason in a sentence or two, contrasted with what the brain had the other line ahead for. */
export function describeSwap(e: SwapExplanation, higherLine: string, lowerLine: string): string {
  const name = (f: SwapFactor) => f.label.charAt(0).toLowerCase() + f.label.slice(1);
  // The lower line's advantage, its own number first ("I had 1003 higher on layovers (145 vs 111)").
  const had = e.against ? `I had ${lowerLine} higher on ${name(e.against)} (${e.against.amounts.split(" vs ").reverse().join(" vs ")}).` : "";
  switch (e.verdict) {
    case "limit":
      return `${higherLine} breaks your limit on ${e.limit!.toLowerCase()}, so your priorities stay as they were — if that limit isn't a real dealbreaker, change it under Your priorities.`;
    case "agreed":
      return "That's the order I'd have expected.";
    case "clear": {
      const f = e.explains[0];
      return `${had} ${higherLine} wins on ${name(f)} (${f.amounts}) — looks like that counts for more than I had.`.trim();
    }
    case "ambiguous": {
      const [f, g] = e.explains;
      return `${had} ${higherLine} wins on ${name(f)} (${f.amounts}) and ${name(g)} (${g.amounts}) — either could be why.`.trim();
    }
    case "unexplained":
      return `${had} Nothing you've told us puts ${higherLine} ahead by that much — tell us why under Your priorities, and it'll count.`.trim();
  }
}
