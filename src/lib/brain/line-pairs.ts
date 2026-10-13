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
 * current ranking that each win big on a different thing they care about,
 * and are otherwise as alike as the pack allows — so the choice is about
 * that one trade, and clear enough to answer without a shrug. Their choice
 * between the two says how they trade those things, which the interview's
 * words alone rarely pin down (and which `fit-choices.ts` turns into weights).
 */

const TOP = 18;
/**
 * Two lines may be this many score points apart. Not closer by design: a pair the model already calls a coin-flip is
 * one the pilot usually shrugs at too ("just"), and a shrug teaches little. A clear-cut trade inside this band, where
 * the model isn't yet sure which way they lean, gets a decisive answer that settles how their priorities rank.
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
 * How clearly each line has to win its side of the trade (utility difference × the criterion's weight). Below it the
 * two lines are near-identical on what they're meant to be traded on, and the pilot can only shrug — "just".
 */
const MIN_SIDE_ADVANTAGE = 0.2;
/** How much everything else the two lines differ on counts against a pair, relative to the trade it's meant to show. */
const CONFOUND_PENALTY = 0.5;

/**
 * A trade, named by what's measured rather than by the criteria's ids — the brain re-reads the interview every few
 * answers and the same priority can come back under a new id, which used to let one trade be asked over and over.
 */
export function tradeKey(metricA: string, metricB: string): string {
  return [metricA, metricB].sort().join("|");
}

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
      if (!forA || !forB || forA.d <= MIN_SIDE_ADVANTAGE || forB.d >= -MIN_SIDE_ADVANTAGE || forA.ra.metric === forB.ra.metric) continue;
      // Everything else the two lines differ on, by how much it matters to this pilot. A pair that also differs on a
      // pile of other things is a muddy question — the pilot answers for a reason the headline trade doesn't name (one
      // commute, but on a 14-day trip), and the choice then teaches the wrong lesson.
      const confound = diffs.filter((x) => x !== forA && x !== forB).reduce((sum, x) => sum + Math.abs(x.d), 0);
      // Best when each side wins its half of the trade by a lot and the rest is nearly a wash — an easy question to
      // answer that still says which priority comes first.
      pairs.push({ score: Math.min(forA.d, -forB.d) - CONFOUND_PENALTY * confound, a, b, winA: forA.ra, winB: forB.rb, loseA: forB.ra, loseB: forA.rb });
    }
  const used = new Set<string>();
  const trades = new Set<string>();
  const out: LinePairCandidate[] = [];
  // Lines the pilot has already compared come last, and none past its limit: a fresh line each time teaches more and
  // doesn't feel repetitive. Trades never put to them come before ones already asked.
  const showings = new Map<string, number>();
  for (const k of alreadyCompared) for (const l of k.split("|")) showings.set(l, (showings.get(l) ?? 0) + 1);
  const seen = (l: string) => showings.get(l) ?? 0;
  const tradeOf = (p: (typeof pairs)[number]) => tradeKey(p.winA.metric, p.winB.metric);
  const asked = (p: (typeof pairs)[number]) => pastTrades.filter((t) => t === tradeOf(p)).length;
  const fresh = (p: (typeof pairs)[number]) => (seen(p.a.lineNumber) ? 1 : 0) + (seen(p.b.lineNumber) ? 1 : 0);
  for (const p of pairs.sort((x, y) => asked(x) - asked(y) || fresh(x) - fresh(y) || y.score - x.score)) {
    // Each line at most once per offer, and each trade (this measure against that one) at most once, so every pair teaches something new.
    const trade = tradeOf(p);
    if (used.has(p.a.lineNumber) || used.has(p.b.lineNumber) || trades.has(trade)) continue;
    if (seen(p.a.lineNumber) >= MAX_SHOWINGS_PER_LINE || seen(p.b.lineNumber) >= MAX_SHOWINGS_PER_LINE) continue;
    if (asked(p) >= MAX_PER_TRADE) continue;
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
