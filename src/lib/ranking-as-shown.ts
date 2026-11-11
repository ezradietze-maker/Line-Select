import { cachedFlightAnswers } from "@/lib/flights/client";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { applyPlacements, loadPlacements, prunePlacements } from "@/lib/line-placements";
import { applyTiers, loadTiers, pruneTiers } from "@/lib/line-tiers";
import { rankLines, type LineScore } from "@/lib/scoring";
import { loadSeniority } from "@/lib/seniority-storage";
import { flySchedule, pilotVacations, rankedAsFlown, withChoices } from "@/lib/vacation-lines";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The pilot's ranking as My Rankings orders it, for screens that don't load it themselves: the commuter's looked-up
 * airline flights (kept on this device) count, and so do the lines they moved by hand — the order they bid. Without
 * them, Strategies and the Logbook ranked a different list and named the wrong choice as the one awarded. The tiers
 * count too, as they do on My Rankings and in what goes to VIPS. Hotels' reviews are left out: they're fetched by My
 * Rankings alone.
 */
export function rankingAsShown(bidPack: BidPack, profile: PreferenceProfile, userId: string | null): LineScore[] {
  const flights = profile.pilotModel ? cachedFlightAnswers(bidPack, profile.pilotModel) : null;
  // Scored as it will fly with the pilot's carry-in and vacation, the way My Rankings does (`useCarryIn`).
  const carry = loadCarryIn(userId, bidPack.id);
  const vacations = pilotVacations(bidPack, profile, loadSeniority(userId)).vacations;
  const flown = flySchedule(bidPack, carry, withChoices(vacations, carry.vacationChoices));
  const ranked = rankedAsFlown(rankLines(flown.pack, profile, {}, computeImplicitLineValues(bidPack), undefined, undefined, flights ?? undefined), bidPack, flown);
  const valid = new Set(bidPack.lines.map((l) => l.id));
  const placed = applyPlacements(ranked, prunePlacements(loadPlacements(userId, bidPack.id), valid), (r) => r.line.id);
  return applyTiers(placed, pruneTiers(loadTiers(userId, bidPack.id), valid), (r) => r.line.id);
}
