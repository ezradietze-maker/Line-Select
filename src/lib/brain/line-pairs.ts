import { formatValue } from "@/lib/brain/describe";
import { lineSummary } from "@/lib/brain/line-text";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2, type CriterionResult } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import type { LinePairCandidate, LinePairDifference } from "./interviewer";

/**
 * Line pairs worth putting to a pilot: two lines near the top of their
 * current ranking that differ on several things they care about at once —
 * each line winning some — so one choice says how a handful of their
 * priorities weigh against each other, not just two. The pilot sees every
 * difference spelled out, so the choice is an informed one rather than a
 * reaction to something the question didn't name (one commute, but on a
 * 14-day trip); `fit-choices.ts` then moves every criterion the two lines
 * differ on, in proportion to how much they differ.
 */

const TOP = 24;
/**
 * Two lines may be this many score points apart. Not much closer by design: a pair the model already calls a
 * coin-flip is one the pilot usually shrugs at too ("just"), and a shrug teaches little.
 */
const MAX_GAP = 15;

const v = (r: CriterionResult) => {
  const def = METRICS_BY_ID.get(r.metric);
  return r.value === null || !def ? "—" : formatValue(r.value, def);
};

/** A trade the pilot has already settled with this many line choices isn't put to them again. */
const MAX_PER_TRADE = 2;
/** No line is shown in more than this many choices over a whole interview — seeing 2029 a fifth time reads as a script. */
const MAX_SHOWINGS_PER_LINE = 2;
/**
 * How clearly each line has to win its strongest point (utility difference × the criterion's weight). Below it the two
 * lines are near-identical on what they're meant to be traded on, and the pilot can only shrug — "just".
 */
const MIN_SIDE_ADVANTAGE = 0.2;
/** A difference this small (utility × weight) is noise to the pilot — not shown, not counted. */
const MIN_DIFFERENCE = 0.06;
/** A pair worth asking about differs on at least this many of the pilot's priorities… */
const MIN_VARIABLES = 3;
/** …and shows at most this many — past five a table stops being readable. */
const MAX_VARIABLES = 5;

/**
 * A trade, named by what's measured rather than by the criteria's ids — the brain re-reads the interview every few
 * answers and the same priority can come back under a new id, which used to let one trade be asked over and over.
 */
export function tradeKey(metricA: string, metricB: string): string {
  return [metricA, metricB].sort().join("|");
}

interface Diff {
  ra: CriterionResult;
  rb: CriterionResult;
  /** Positive when line A is better on it, weighted by how much it matters to the pilot. */
  d: number;
}

export function pickLinePairs(bidPack: BidPack, model: PilotModel, pack: PackMetrics, alreadyCompared: Set<string>, count = 3, pastTrades: string[] = []): LinePairCandidate[] {
  if (model.criteria.length < 2) return [];
  const ranked = scorePackV2(bidPack, model, { pack }).sort((a, b) => b.score - a.score).slice(0, TOP);
  // Measures the pilot has already been asked to trade, so a pair that brings in something untested is preferred.
  const tested = new Set(pastTrades.flatMap((t) => t.split("|")));
  const pairs: { score: number; a: (typeof ranked)[number]; b: (typeof ranked)[number]; shown: Diff[]; trade: string }[] = [];
  for (let i = 0; i < ranked.length; i++)
    for (let j = i + 1; j < ranked.length; j++) {
      const a = ranked[i];
      const b = ranked[j];
      if (a.score - b.score > MAX_GAP) continue;
      if (alreadyCompared.has(`${a.lineNumber}|${b.lineNumber}`) || alreadyCompared.has(`${b.lineNumber}|${a.lineNumber}`)) continue;
      // Where the two lines differ, weighted by how much each thing matters to this pilot.
      const diffs: Diff[] = a.results
        .map((ra) => {
          const rb = b.results.find((r) => r.criterionId === ra.criterionId)!;
          return { ra, rb, d: (ra.utility - rb.utility) * ra.weight };
        })
        .filter((x) => Math.abs(x.d) >= MIN_DIFFERENCE && x.ra.value !== null && x.rb.value !== null);
      const forA = diffs.filter((x) => x.d > 0).sort((x, y) => y.d - x.d);
      const forB = diffs.filter((x) => x.d < 0).sort((x, y) => x.d - y.d);
      if (!forA.length || !forB.length || forA[0].d <= MIN_SIDE_ADVANTAGE || -forB[0].d <= MIN_SIDE_ADVANTAGE || forA[0].ra.metric === forB[0].ra.metric) continue;
      // A pilot with only two priorities can only be asked about two.
      if (diffs.length < Math.min(MIN_VARIABLES, model.criteria.length)) continue;
      // What the pilot will see: the biggest differences, both sides represented.
      const shown = [...diffs].sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, MAX_VARIABLES);
      if (!shown.some((x) => x.d > 0) || !shown.some((x) => x.d < 0)) continue;
      // How much one answer can teach: the total weight of what differs, as long as neither side runs away with it —
      // a lopsided pair is one the pilot (and the model) already knows the answer to.
      const sumA = shown.filter((x) => x.d > 0).reduce((s, x) => s + x.d, 0);
      const sumB = shown.filter((x) => x.d < 0).reduce((s, x) => s - x.d, 0);
      const balance = Math.min(sumA, sumB) / Math.max(sumA, sumB);
      const untested = new Set(shown.map((x) => x.ra.metric).filter((m) => !tested.has(m))).size;
      const score = (sumA + sumB) * (0.4 + 0.6 * balance) + 0.15 * untested;
      pairs.push({ score, a, b, shown, trade: tradeKey(forA[0].ra.metric, forB[0].ra.metric) });
    }
  const used = new Set<string>();
  const trades = new Set<string>();
  const out: LinePairCandidate[] = [];
  // Lines the pilot has already compared come last, and none past its limit: a fresh line each time teaches more and
  // doesn't feel repetitive. Trades never put to them come before ones already asked.
  const showings = new Map<string, number>();
  for (const k of alreadyCompared) for (const l of k.split("|")) showings.set(l, (showings.get(l) ?? 0) + 1);
  const seen = (l: string) => showings.get(l) ?? 0;
  const asked = (p: (typeof pairs)[number]) => pastTrades.filter((t) => t === p.trade).length;
  const fresh = (p: (typeof pairs)[number]) => (seen(p.a.lineNumber) ? 1 : 0) + (seen(p.b.lineNumber) ? 1 : 0);
  for (const p of pairs.sort((x, y) => asked(x) - asked(y) || fresh(x) - fresh(y) || y.score - x.score)) {
    // Each line at most once per offer, and each headline trade at most once, so every pair teaches something new.
    if (used.has(p.a.lineNumber) || used.has(p.b.lineNumber) || trades.has(p.trade)) continue;
    if (seen(p.a.lineNumber) >= MAX_SHOWINGS_PER_LINE || seen(p.b.lineNumber) >= MAX_SHOWINGS_PER_LINE) continue;
    if (asked(p) >= MAX_PER_TRADE) continue;
    used.add(p.a.lineNumber);
    used.add(p.b.lineNumber);
    trades.add(p.trade);
    const lineA = bidPack.lines.find((l) => l.id === p.a.lineId)!;
    const lineB = bidPack.lines.find((l) => l.id === p.b.lineId)!;
    const differences: LinePairDifference[] = p.shown.map((x) => ({ label: x.ra.label, metric: x.ra.metric, a: v(x.ra), b: v(x.rb), better: x.d > 0 ? "a" : "b" }));
    const side = (s: "a" | "b") =>
      differences
        .filter((x) => x.better === s)
        .map((x) => `${x.label} (${x[s]} vs ${x[s === "a" ? "b" : "a"]})`)
        .join(", ");
    out.push({
      index: out.length,
      a: p.a.lineNumber,
      b: p.b.lineNumber,
      trade: p.trade,
      tension: `${p.a.lineNumber} is better on ${side("a")}; ${p.b.lineNumber} is better on ${side("b")}`,
      differences,
      summaryA: lineSummary(bidPack, lineA),
      summaryB: lineSummary(bidPack, lineB),
    });
    if (out.length >= count) break;
  }
  return out;
}
