import { formatValue } from "@/lib/brain/describe";
import { lineSummary } from "@/lib/brain/line-text";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2, type CriterionResult } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import type { LinePairCandidate } from "./interviewer";

/**
 * Line pairs worth putting to a pilot: two lines near the top of their
 * current ranking that score about the same, but for opposite reasons —
 * each wins clearly on a different thing they care about. Their choice
 * between the two says how they trade those things, which the interview's
 * words alone rarely pin down (and which `fit-choices.ts` turns into weights).
 */

const TOP = 18;
const MAX_GAP = 8;

const v = (r: CriterionResult) => {
  const def = METRICS_BY_ID.get(r.metric);
  return r.value === null || !def ? "—" : formatValue(r.value, def);
};

/** A trade the pilot has already settled with this many line choices isn't put to them again. */
const MAX_PER_TRADE = 2;

export function pickLinePairs(bidPack: BidPack, model: PilotModel, pack: PackMetrics, alreadyCompared: Set<string>, count = 3, pastTrades: string[] = []): LinePairCandidate[] {
  if (model.criteria.length < 2) return [];
  const ranked = scorePackV2(bidPack, model, { pack }).sort((a, b) => b.score - a.score).slice(0, TOP);
  const pairs: { score: number; a: (typeof ranked)[number]; b: (typeof ranked)[number]; winA: CriterionResult; winB: CriterionResult; loseA: CriterionResult; loseB: CriterionResult }[] = [];
  for (let i = 0; i < ranked.length; i++)
    for (let j = i + 1; j < ranked.length; j++) {
      const a = ranked[i];
      const b = ranked[j];
      if (a.score - b.score > MAX_GAP) continue;
      if (alreadyCompared.has(`${a.lineNumber}|${b.lineNumber}`) || alreadyCompared.has(`${b.lineNumber}|${a.lineNumber}`)) continue;
      // Where each line beats the other, weighted by how much that criterion matters.
      const diffs = a.results.map((ra) => {
        const rb = b.results.find((r) => r.criterionId === ra.criterionId)!;
        return { ra, rb, d: (ra.utility - rb.utility) * ra.weight };
      });
      const forA = diffs.reduce((m, x) => (x.d > m.d ? x : m), diffs[0]);
      const forB = diffs.reduce((m, x) => (x.d < m.d ? x : m), diffs[0]);
      if (!forA || !forB || forA.d <= 0.05 || forB.d >= -0.05 || forA.ra.criterionId === forB.ra.criterionId) continue;
      // Best when both sides have a real advantage and the lines are close overall.
      pairs.push({ score: Math.min(forA.d, -forB.d) - (a.score - b.score) / 100, a, b, winA: forA.ra, winB: forB.rb, loseA: forB.ra, loseB: forA.rb });
    }
  const used = new Set<string>();
  const trades = new Set<string>();
  const out: LinePairCandidate[] = [];
  // Lines the pilot has already compared come last: a fresh line each time teaches more and doesn't feel repetitive.
  const shown = new Set([...alreadyCompared].flatMap((k) => k.split("|")));
  const fresh = (p: (typeof pairs)[number]) => (shown.has(p.a.lineNumber) ? 1 : 0) + (shown.has(p.b.lineNumber) ? 1 : 0);
  for (const p of pairs.sort((x, y) => fresh(x) - fresh(y) || y.score - x.score)) {
    // Each line at most once, and each trade (this criterion against that one) at most once, so every pair teaches something new.
    const trade = [p.winA.criterionId, p.winB.criterionId].sort().join("|");
    if (used.has(p.a.lineNumber) || used.has(p.b.lineNumber) || trades.has(trade)) continue;
    if (pastTrades.filter((t) => t === trade).length >= MAX_PER_TRADE) continue;
    used.add(p.a.lineNumber);
    used.add(p.b.lineNumber);
    trades.add(trade);
    const lineA = bidPack.lines.find((l) => l.id === p.a.lineId)!;
    const lineB = bidPack.lines.find((l) => l.id === p.b.lineId)!;
    out.push({
      index: out.length,
      a: p.a.lineNumber,
      b: p.b.lineNumber,
      trade,
      tension: `${p.a.lineNumber} wins on ${p.winA.label} (${v(p.winA)} vs ${v(p.loseB)}); ${p.b.lineNumber} wins on ${p.winB.label} (${v(p.winB)} vs ${v(p.loseA)})`,
      summaryA: lineSummary(bidPack, lineA),
      summaryB: lineSummary(bidPack, lineB),
    });
    if (out.length >= count) break;
  }
  return out;
}
