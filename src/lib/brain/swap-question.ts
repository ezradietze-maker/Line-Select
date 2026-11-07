import type { SwapExplanation } from "@/lib/brain/explain-swap";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import { measure, type PackMetrics } from "@/lib/metrics/compute";
import { homeParams, type V2LineScore } from "@/lib/scoring-v2/score";
import type { ReasonOption, SwapReason } from "@/lib/brain/swap-reason";
import type { BidPack } from "@/types/bidpack";
import { TIER_WEIGHT, type Criterion, type PilotModel } from "@/types/pilot-model";

/**
 * The one question after a swap (plan: docs/plans/reorder-learning.md §4.4): when the brain can't tell why a pilot put
 * one line above another, it asks — rarely, as a choice of the real differences, never leading with a guess.
 *
 * Asking people for reasons can backfire: they misreport why they chose (Nisbett & Wilson 1977; Hall et al. 2010) and
 * accept a plausible suggestion, so the card offers the two or three priorities that could each explain the swap, with
 * both lines' numbers, plus "something else" and "about equal", and nothing pre-chosen. A named reason then counts as
 * evidence worth a few swaps (`LEARNER.answer`), not as an order. Feature questions like this learned faster and made
 * later choices less noisy in Basu, Singhal & Dragan (2018).
 */

export const ASK = {
  /** Swaps between one question and the next (the first unclear swap may be asked about at once). */
  swapsBetween: 5,
  /** Questions in one visit to the results. */
  perVisit: 3,
  /** Choices offered, before "something else" and "about equal". */
  options: 3,
};

export interface FactorOption {
  /** A priority the pilot already has… */
  criterionId?: string;
  /** …or a measure they never named, offered as a new one, better for the higher line in this direction. */
  metric?: string;
  direction?: "more" | "less";
  label: string;
  /** "3 vs 1": the higher line's value, then the lower one's. */
  amounts: string;
}

export type SwapQuestion =
  | { kind: "factors"; dragId: string; higher: string; lower: string; options: FactorOption[] }
  | { kind: "limit"; dragId: string; higher: string; lower: string; criterionId: string; label: string; value: number; limit: number; op: "max" | "min"; amounts: string };

export interface AskState {
  /** Swaps made since the last question (or in all, before the first). */
  swapsSince: number;
  asked: number;
  /** Pairs already asked about, "higher|lower". */
  askedPairs: Set<string>;
  stopped: boolean;
}

/** The question to ask about this swap, if it's unclear and it's time to ask; null otherwise. */
export function pickSwapQuestion(e: SwapExplanation, swap: { dragId: string; higher: string; lower: string }, state: AskState, untracked: FactorOption | null): SwapQuestion | null {
  if (state.stopped || state.asked >= ASK.perVisit) return null;
  if (state.asked > 0 && state.swapsSince < ASK.swapsBetween) return null;
  const key = [swap.higher, swap.lower].sort().join("|");
  if (state.askedPairs.has(key)) return null;
  if (e.verdict === "limit" && e.limitDetail)
    return { kind: "limit", ...swap, criterionId: e.limitDetail.criterionId, label: e.limitDetail.label, value: e.limitDetail.value, limit: e.limitDetail.limit, op: e.limitDetail.op, amounts: e.limitDetail.amounts };
  if (e.verdict !== "ambiguous" && e.verdict !== "unexplained") return null;
  // Ambiguous: the priorities that could each explain it. Unexplained: what pulled the higher line up most, and a
  // measure they never named that clearly favours it — the reason may be something the brain doesn't track yet.
  const tracked = (e.verdict === "ambiguous" ? e.explains : e.factors.filter((f) => f.share > 0)).slice(0, untracked ? ASK.options - 1 : ASK.options);
  const options: FactorOption[] = [...tracked.map((f) => ({ criterionId: f.criterionId, label: f.label, amounts: f.amounts })), ...(untracked ? [untracked] : [])];
  return options.length ? { kind: "factors", ...swap, options } : null;
}

/**
 * Measures worth offering when nothing a pilot named explains a swap — things pilots commonly weigh, needing no
 * settings — each with the way pilots want it, so the card never suggests "more red-eyes" just because the line the
 * pilot put higher happens to have them.
 */
const UNTRACKED: [string, "more" | "less"][] = [
  ["daysOff", "more"], ["longestDaysOffBlock", "more"], ["weekendDaysOff", "more"], ["singleDaysOff", "less"], ["creditHours", "more"],
  ["tafbHours", "less"], ["tripCount", "less"], ["longestTripDays", "less"], ["longDuties", "less"], ["earlyReports", "less"],
  ["redEyeLegs", "less"], ["nightsWorked", "less"], ["dutiesWithManyLegs", "less"], ["landings", "less"], ["avgLayoverHours", "more"],
  ["shortLayovers", "less"], ["frontDeadheadTrips", "more"], ["backDeadheadTrips", "more"], ["hubTurns", "less"],
];
/** Measures that read the pilot's home: offered only to a pilot whose home the brain knows. */
const UNTRACKED_HOME: [string, "more" | "less"][] = [["workDays", "less"], ["baseHotelNights", "less"]];
/** How far apart the two lines must be on a measure, as a share of the pack's middle 80%, to call it a clear difference. */
const CLEAR_GAP = 0.3;

const measured = new WeakMap<PackMetrics, Map<string, Map<string, number | null>>>();

function valuesOf(bidPack: BidPack, pack: PackMetrics, metric: string, params: object): Map<string, number | null> {
  let byMetric = measured.get(pack);
  if (!byMetric) measured.set(pack, (byMetric = new Map()));
  const key = `${metric}|${JSON.stringify(params)}`;
  let values = byMetric.get(key);
  if (!values) byMetric.set(key, (values = new Map(bidPack.lines.map((l) => [l.lineNumber, measure(metric, l, pack, params)]))));
  return values;
}

function amount(v: number): string {
  return Number.isInteger(v) || Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

/** The measure the pilot never named that most clearly favours the higher line, if one does. */
export function untrackedFactor(bidPack: BidPack, pack: PackMetrics, model: PilotModel, higher: string, lower: string): FactorOption | null {
  const used = new Set(model.criteria.map((c) => c.metric));
  const home = model.home ? homeParams(model) : null;
  let best: (FactorOption & { gap: number }) | null = null;
  for (const [metric, direction] of [...UNTRACKED, ...(home ? UNTRACKED_HOME : [])]) {
    const def = METRICS_BY_ID.get(metric);
    if (!def || used.has(metric)) continue;
    const values = valuesOf(bidPack, pack, metric, { ...def.defaults, ...(home ?? {}) });
    const a = values.get(higher);
    const b = values.get(lower);
    // Only where the higher line is the better one, the way pilots want it.
    if (a == null || b == null || a === b || (direction === "more") !== a > b) continue;
    const sorted = [...values.values()].filter((v): v is number => v !== null).sort((x, y) => x - y);
    const spread = sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)];
    const gap = Math.abs(a - b) / (spread || 1);
    if (gap < CLEAR_GAP || (best && gap <= best.gap)) continue;
    best = { metric, direction, label: def.label, amounts: `${amount(a)} vs ${amount(b)}`, gap };
  }
  if (!best) return null;
  return { metric: best.metric, direction: best.direction, label: best.label, amounts: best.amounts };
}

/**
 * What a typed reason can be matched to (see `swap-reason.ts`): the pilot's priorities, and the measures they never
 * named, each with both lines' values. `scores` are the lines as scored when the pilot swapped.
 */
export function reasonOptions(bidPack: BidPack, pack: PackMetrics, model: PilotModel, scores: Map<string, V2LineScore>, higher: string, lower: string): { priorities: ReasonOption[]; measures: ReasonOption[] } {
  const a = scores.get(higher);
  const b = scores.get(lower);
  const show = (v: number | null | undefined) => (v == null ? "not measured" : amount(v));
  const priorities = (a?.results ?? []).map((r) => ({ id: r.criterionId, label: r.label, higher: show(r.value), lower: show(b?.results.find((x) => x.criterionId === r.criterionId)?.value) }));
  const used = new Set(model.criteria.map((c) => c.metric));
  const home = model.home ? homeParams(model) : null;
  const measures = [...UNTRACKED, ...(home ? UNTRACKED_HOME : [])].flatMap(([metric]) => {
    const def = METRICS_BY_ID.get(metric);
    if (!def || used.has(metric)) return [];
    const values = valuesOf(bidPack, pack, metric, { ...def.defaults, ...(home ?? {}) });
    return [{ id: metric, label: def.label, higher: show(values.get(higher)), lower: show(values.get(lower)) }];
  });
  return { priorities, measures };
}

/** The option a matched reason stands for, as the question card offers it; null when the two lines are the same on it. */
export function optionFromReason(reason: SwapReason, options: { priorities: ReasonOption[]; measures: ReasonOption[] }): { option: FactorOption | null; same: ReasonOption | null } {
  const list = reason.kind === "priority" ? options.priorities : reason.kind === "measure" ? options.measures : [];
  const o = list.find((x) => x.id === reason.id);
  if (!o) return { option: null, same: null };
  if (o.higher === o.lower) return { option: null, same: o };
  const amounts = `${o.higher} vs ${o.lower}`;
  return { option: reason.kind === "priority" ? { criterionId: o.id, label: o.label, amounts } : { metric: o.id, direction: reason.direction ?? "more", label: o.label, amounts }, same: null };
}

/** A priority the pilot agreed to add after naming it as the reason for a swap: low to start, so their swaps can raise it. */
export function criterionFromAnswer(option: FactorOption, quote: string): Criterion {
  const metric = option.metric!;
  return {
    id: `swap-${metric}`,
    metric,
    shape: { kind: option.direction ?? "more" },
    tier: "low",
    // Set, not left to the tier: the fit scales the weight it's given, and can't raise a zero. Starting at "medium"
    // made no difference on the swap bench (74.6% vs 74.5%), so it starts small and the pilot's swaps raise it.
    weight: TIER_WEIGHT.low,
    confidence: 0.6,
    label: option.label,
    evidence: [{ quote, turn: -1 }],
    status: "settled",
  };
}
