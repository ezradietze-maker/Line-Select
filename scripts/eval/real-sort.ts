import { prepareMetrics } from "@/lib/metrics/compute";
import { scoreTripsV2, tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/** A real pilot's own sort of some lines (piles, best first, the top pile in order) and trip picks ([chosen, other]). */
export interface RealSort {
  piles: string[][];
  tripPicks?: [string, string][];
}

/** Every pair the sort settles: each line above every line in a lower pile, and the top pile in its order. */
export function sortPairs(s: RealSort): [string, string][] {
  const out: [string, string][] = [];
  s.piles.forEach((upper, i) => s.piles.slice(i + 1).forEach((lower) => upper.forEach((x) => lower.forEach((y) => out.push([x, y])))));
  const top = s.piles[0] ?? [];
  top.forEach((x, i) => top.slice(i + 1).forEach((y) => out.push([x, y])));
  return out;
}

/** Share of the sort's pairs an order agrees with (0–1), as the ex-pilot benchmark counts them. */
export function sortAgreement(order: string[], s: RealSort): number {
  const at = new Map(order.map((l, i) => [l, i]));
  const pairs = sortPairs(s).filter(([x, y]) => at.has(x) && at.has(y));
  return pairs.length ? pairs.filter(([x, y]) => at.get(x)! < at.get(y)!).length / pairs.length : 0;
}

/** How many of the pilot's trip picks a model's trip scores agree with. */
export function tripPicksAgreed(pack: BidPack, model: PilotModel, s: RealSort, pm = prepareMetrics(pack)): { agreed: number; of: number } {
  const picks = s.tripPicks ?? [];
  const scores = scoreTripsV2(pack, model, { pack: pm });
  const trip = (n: string) => pack.lines.flatMap((l) => l.trips).find((t) => t.pairingNumber === n);
  let agreed = 0;
  for (const [a, b] of picks) {
    const ta = trip(a), tb = trip(b);
    if (ta && tb && scores.get(tripKey(ta))!.score > scores.get(tripKey(tb))!.score) agreed++;
  }
  return { agreed, of: picks.length };
}
