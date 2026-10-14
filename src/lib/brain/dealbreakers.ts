import { formatValue } from "@/lib/brain/describe";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Asked early, the same way for every pilot, without a model call: is there
 * anything that rules a line out no matter what else it has? Most pilots have
 * a line they'd never bid — eight commutes, a 14-day trip, a report before
 * 0400 — and a weight can't say that: enough pay always buys it back. A
 * number here becomes a hard limit (`Criterion.hardLimit`, which caps a
 * line's score) when the brain next reads the interview. The question shows
 * their own top priorities' real ranges in this pack, so the answer comes in
 * the pack's terms.
 */

/** How the question opens — how the transcript (and the brain) recognizes it. */
export const DEALBREAKER_LEAD = "Dealbreakers:";

/** How many of their priorities' ranges to show. */
const SHOWN = 4;

export interface DealbreakerQuestion {
  prompt: string;
  helpText: string;
  /** How it goes into the transcript: the question with the ranges it showed, so the brain reads the answer against them. */
  transcript: string;
}

/** The pack's range on each of the pilot's top priorities that can have a limit — "Commutes to base: 1–8 here". */
function rangesFor(bidPack: BidPack, model: PilotModel, pack: PackMetrics): string[] {
  const scored = scorePackV2(bidPack, model, { pack });
  if (!scored.length) return [];
  return [...model.criteria]
    .filter((c) => c.shape.kind !== "target" && !c.params?.cityScores && !c.params?.dates)
    .sort((a, b) => b.weight - a.weight)
    .flatMap((c) => {
      const def = METRICS_BY_ID.get(c.metric);
      const values = scored.flatMap((s) => s.results.filter((r) => r.criterionId === c.id && r.value !== null).map((r) => r.value as number));
      if (!def || values.length < 2) return [];
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (lo === hi) return [];
      return [`${c.label}: ${formatValue(lo, def)} to ${formatValue(hi, def)}`];
    })
    .slice(0, SHOWN);
}

export function dealbreakerQuestion(bidPack: BidPack, model: PilotModel | null, pack: PackMetrics): DealbreakerQuestion {
  const ranges = model ? rangesFor(bidPack, model, pack) : [];
  const prompt = "Is there anything that rules a line out for you, no matter how good the rest of it is?";
  const helpText = ranges.length
    ? `Give the number if there is one. In this pack — ${ranges.join(" · ")}. "Nothing's an absolute" is a fine answer too.`
    : `Give the number if there is one — more than a few commutes, a trip over so many days, a report before a certain hour. "Nothing's an absolute" is a fine answer too.`;
  return { prompt, helpText, transcript: `${DEALBREAKER_LEAD} ${prompt}${ranges.length ? ` (This pack: ${ranges.join("; ")}.)` : ""}` };
}

/** Whether the interview has already asked it. */
export function askedDealbreakers(exchanges: { question: string }[]): boolean {
  return exchanges.some((e) => e.question.startsWith(DEALBREAKER_LEAD));
}
