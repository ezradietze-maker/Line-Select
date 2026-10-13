import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/** How many top lines the interview watches for movement. */
export const WATCHED_TOP = 10;

/** The pilot's current top lines under a model, best first. */
export function topLines(bidPack: BidPack, model: PilotModel, pack: PackMetrics, n = WATCHED_TOP): string[] {
  return scorePackV2(bidPack, model, { pack })
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((r) => r.lineNumber);
}

/**
 * How many of the earlier top lines a newer reading dropped (its replacements came in). Zero means the last answers
 * didn't change which lines the pilot would see at the top — the interview's signal that it has learned what it can.
 */
export function topShift(before: string[], after: string[]): number {
  const now = new Set(after);
  return before.filter((l) => !now.has(l)).length;
}
