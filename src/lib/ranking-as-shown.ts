import { cachedFlightAnswers } from "@/lib/flights/client";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { applyPlacements, loadPlacements, prunePlacements } from "@/lib/line-placements";
import { rankLines, type LineScore } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The pilot's ranking as My Rankings orders it, for screens that don't load it themselves: the commuter's looked-up
 * airline flights (kept on this device) count, and so do the lines they moved by hand — the order they bid. Without
 * them, Strategies and the Logbook ranked a different list and named the wrong choice as the one awarded. Hotels'
 * reviews are left out: they're fetched by My Rankings alone.
 */
export function rankingAsShown(bidPack: BidPack, profile: PreferenceProfile, userId: string | null): LineScore[] {
  const flights = profile.pilotModel ? cachedFlightAnswers(bidPack, profile.pilotModel) : null;
  const ranked = rankLines(bidPack, profile, {}, computeImplicitLineValues(bidPack), undefined, undefined, flights ?? undefined);
  const placements = prunePlacements(loadPlacements(userId, bidPack.id), new Set(bidPack.lines.map((l) => l.id)));
  return applyPlacements(ranked, placements, (r) => r.line.id);
}
