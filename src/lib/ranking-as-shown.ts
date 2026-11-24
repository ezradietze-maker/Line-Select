import { cachedFlightAnswers } from "@/lib/flights/client";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { lineTotalsAsFlown, type LineTotal } from "@/lib/pay/line-total";
import { applyPlacements, loadPlacements, prunePlacements } from "@/lib/line-placements";
import { applyTiers, loadTiers, pruneTiers } from "@/lib/line-tiers";
import { rankLines, type LineScore } from "@/lib/scoring";
import { withSatisfactionIndex } from "@/lib/satisfaction-index";
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
  // Scored as it will fly with the pilot's carry-in and vacation, the way My Rankings does.
  const flown = flownAsShown(bidPack, profile, userId);
  // Scores as My Rankings shows them: the Satisfaction Index (`lib/satisfaction-index.ts`).
  const implicit = computeImplicitLineValues(bidPack);
  // Lines the month leaves the same (a vacation taking every trip off) are told apart by the lines as printed.
  const printed = flown.pack === bidPack ? null : new Map(rankLines(bidPack, profile, {}, implicit, undefined, undefined, flights ?? undefined).map((r) => [r.line.id, r.score]));
  const ranked = withSatisfactionIndex(rankedAsFlown(rankLines(flown.pack, profile, {}, implicit, undefined, undefined, flights ?? undefined), bidPack, flown, printed));
  const valid = new Set(bidPack.lines.map((l) => l.id));
  const placed = applyPlacements(ranked, prunePlacements(loadPlacements(userId, bidPack.id), valid), (r) => r.line.id);
  return applyTiers(placed, pruneTiers(loadTiers(userId, bidPack.id), valid), (r) => r.line.id);
}

/** The pack as the pilot will fly it, with their carry-in and vacation, as My Rankings works it out (`useCarryIn`). */
function flownAsShown(bidPack: BidPack, profile: Pick<PreferenceProfile, "seniorityNumber"> | null, userId: string | null) {
  const carry = loadCarryIn(userId, bidPack.id);
  const vacations = pilotVacations(bidPack, profile, loadSeniority(userId), carry).vacations;
  // With the pilot's switch on, each line's vacation where My Rankings last placed it (`appliedPlacements`).
  const placements = carry.slidesRank && carry.appliedPlacements ? new Map(Object.entries(carry.appliedPlacements)) : undefined;
  return flySchedule(bidPack, carry, withChoices(vacations, carry.vacationChoices), placements);
}

/** Each line's Total CH as My Rankings says it: with the pilot's carry-in and vacation (`lineTotalsAsFlown`). */
export function lineTotalsAsShown(bidPack: BidPack, profile: Pick<PreferenceProfile, "seniorityNumber"> | null, userId: string | null): Map<string, LineTotal> {
  return lineTotalsAsFlown(bidPack, flownAsShown(bidPack, profile, userId));
}
