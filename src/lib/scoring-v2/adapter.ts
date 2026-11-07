import { formatValue } from "@/lib/brain/describe";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { METRICS_BY_ID, type MetricCategory } from "@/lib/metrics/catalog";
import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { SATISFACTION_CATEGORY_LABELS, type SatisfactionCategory } from "@/lib/satisfaction-categories";
import type { LineScore } from "@/lib/scoring";
import { type CriterionResult, type V2LineScore } from "@/lib/scoring-v2/score";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Puts the pilot brain in charge of a ranking without rebuilding the
 * results screens: every line keeps the rich score object the screens
 * already read (calendars, body-clock charts, hotel notes), while the brain's
 * scoring sets the score, the order, the reasons and the dealbreakers. Category
 * bars come from the brain's own criteria where it has some; a category it
 * doesn't cover keeps the general reading.
 */

const CATEGORY_OF: Record<MetricCategory, SatisfactionCategory> = {
  pay: "compensation",
  time: "timeAndHomeLife",
  calendar: "timeAndHomeLife",
  duty: "tripCharacter",
  layover: "tripCharacter",
  city: "tripCharacter",
  standby: "tripCharacter",
  commute: "commuteAndDeadhead",
  body: "restAndCircadian",
};

/** Contributions smaller than this (in score points) aren't worth naming as a reason. */
const NOTABLE = 0.3;

/** What a line has on one priority, said so it reads on its own ("18 days off", "4 long duty days"); its name when unmeasured. */
function valueText(r: CriterionResult): string {
  const def = METRICS_BY_ID.get(r.metric);
  return r.value === null || !def ? r.label : formatValue(r.value, def);
}

function explanationFor(s: V2LineScore): string {
  const ups = s.results.filter((r) => r.contribution >= NOTABLE).sort((a, b) => b.contribution - a.contribution).slice(0, 2);
  const downs = s.results.filter((r) => r.contribution <= -NOTABLE).sort((a, b) => a.contribution - b.contribution).slice(0, 1);
  const parts: string[] = [];
  if (ups.length) parts.push(`Strong for you: ${ups.map(valueText).join(" and ")}.`);
  if (downs.length) parts.push(`Weaker: ${valueText(downs[0])}.`);
  return parts.join(" ") || "About average for you on everything you care about.";
}

function categoriesFor(s: V2LineScore, fallback: LineScore["categoryScores"]): LineScore["categoryScores"] {
  const sums = new Map<SatisfactionCategory, { w: number; u: number }>();
  for (const r of s.results) {
    const def = METRICS_BY_ID.get(r.metric);
    if (!def || r.value === null) continue;
    const cat = CATEGORY_OF[def.category];
    const acc = sums.get(cat) ?? { w: 0, u: 0 };
    acc.w += r.weight;
    acc.u += r.weight * r.utility;
    sums.set(cat, acc);
  }
  const out = { ...fallback };
  for (const [cat, { w, u }] of sums) if (w > 0) out[cat] = { score: Math.min(100, Math.max(0, (u / w) * 100)), label: SATISFACTION_CATEGORY_LABELS[cat] };
  return out;
}

/**
 * One measured pack per bid pack for ranking: a re-rank after a refit then re-scores without re-measuring every line
 * (see `measureAll`) — on the biggest pack, 80 ms down to about 1 ms on a laptop, four times that on a slowed phone.
 */
const rankingPacks = new WeakMap<BidPack, PackMetrics>();

export function applyPilotModel(scores: LineScore[], bidPack: BidPack, model: PilotModel, flights?: FlightAnswers): LineScore[] {
  // With every priority dropped there's nothing to rank by here; the older scores still come back best first,
  // as `scoreBidPack` hands them over in pack order.
  if (model.criteria.length === 0) return [...scores].sort((a, b) => b.score - a.score || a.line.lineNumber.localeCompare(b.line.lineNumber));
  let pack = rankingPacks.get(bidPack);
  if (!pack) rankingPacks.set(bidPack, (pack = prepareMetrics(bidPack)));
  // Set every time, flights or none, so a ranking never reads the flights of an earlier one.
  pack.ctx.flights = flights;
  // Once the pilot has graded trips, each line leans on its worst trip's score (see `TRIP_LEAN`).
  const v2 = new Map(rankLinesWithTrips(bidPack, model, { flights, pack }).map((s) => [s.lineId, s]));
  return scores
    .map((ls) => {
      const s = v2.get(ls.line.id);
      if (!s) return ls;
      const named = (sign: 1 | -1) =>
        s.results
          .filter((r) => sign * r.contribution >= NOTABLE)
          .sort((a, b) => sign * (b.contribution - a.contribution))
          .map((r) => ({ label: valueText(r), matchPercent: Math.round(Math.max(0, r.utility) * 100) }));
      return {
        ...ls,
        // Shown 0–100. Past the bad end of a scale a line's raw score goes below 0; the order (by the raw score) keeps it.
        score: Math.max(0, s.score),
        rawScore: s.score,
        explanation: explanationFor(s),
        contributors: named(1),
        criterionResults: s.results,
        detractors: named(-1),
        categoryScores: categoriesFor(s, ls.categoryScores),
        violatedDealbreakers: [
          ...ls.violatedDealbreakers,
          ...s.violations.map((v) => {
            const def = METRICS_BY_ID.get(s.results.find((r) => r.criterionId === v.criterionId)?.metric ?? "");
            const fmt = (n: number) => (def ? formatValue(n, def) : String(n));
            return { statement: v.label, label: v.label, detail: `${fmt(v.value)} — your limit is ${v.op === "max" ? "at most" : "at least"} ${fmt(v.limit)}` };
          }),
        ],
        // "The smallest change that would make this the top pick" is worked out by the older scoring, so it would contradict this order.
        counterfactual: null,
      };
    })
    .sort((a, b) => b.score - a.score || (b.rawScore ?? b.score) - (a.rawScore ?? a.score) || a.line.lineNumber.localeCompare(b.line.lineNumber));
}
