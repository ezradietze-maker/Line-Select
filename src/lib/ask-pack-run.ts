import type { AskQuery } from "@/lib/brain/ask-pack";
import { measure, type PackMetrics } from "@/lib/metrics/compute";
import type { MetricParams } from "@/lib/metrics/catalog";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * A query from "Ask your pack" run over the pack in the browser: every line measured on each condition, the ones that
 * meet them all kept, sorted by the query's sort or else by the pilot's own ranking. Each line keeps the figures it
 * was kept on, so the answer shows its working.
 */

export interface AskResultLine {
  line: Line;
  /** Where it sits in the pilot's own ranking, 1 = their top line; null without one. */
  rank: number | null;
  /** Each condition's figure for this line, in order. */
  values: (number | null)[];
  sortValue: number | null;
}

const meets = (v: number | null, op: AskQuery["conditions"][number]["op"], target: number) =>
  v !== null && (op === "atMost" ? v <= target + 1e-9 : op === "atLeast" ? v >= target - 1e-9 : Math.abs(v - target) < 1e-9);

export function runAskQuery(query: AskQuery, pack: BidPack, pm: PackMetrics, home: MetricParams = {}, rankedIds: string[] = []): AskResultLine[] {
  const rankOf = new Map(rankedIds.map((id, i) => [id, i + 1]));
  const out: AskResultLine[] = [];
  for (const line of pack.lines) {
    const values = query.conditions.map((c) => measure(c.metric, line, pm, { ...home, ...c.params }));
    if (!query.conditions.every((c, i) => meets(values[i], c.op, c.value))) continue;
    const sortValue = query.sort ? measure(query.sort.metric, line, pm, { ...home, ...query.sort.params }) : null;
    out.push({ line, rank: rankOf.get(line.id) ?? null, values, sortValue });
  }
  const byRank = (a: AskResultLine, b: AskResultLine) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.line.lineNumber.localeCompare(b.line.lineNumber);
  if (query.sort) {
    const dir = query.sort.direction === "asc" ? 1 : -1;
    // Lines with no figure go last, and among themselves (and on equal figures) in the pilot's order.
    const bySort = (a: AskResultLine, b: AskResultLine) =>
      a.sortValue === null || b.sortValue === null ? Number(a.sortValue === null) - Number(b.sortValue === null) : dir * (a.sortValue - b.sortValue);
    return out.sort((a, b) => bySort(a, b) || byRank(a, b));
  }
  return out.sort(byRank);
}
