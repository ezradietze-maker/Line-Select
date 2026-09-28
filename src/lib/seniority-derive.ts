import { resolveBidPosition } from "@/lib/forecast/forecast";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

/**
 * The Strategies board's seniority input (a rank and a seat size) is exactly
 * what the bid pack's own seniority list plus the pilot's seniority number
 * already say — so when both exist, use them instead of asking the pilot for
 * the same thing a second way (and getting a rougher answer). null when either
 * is missing, and the board falls back to asking.
 */
export function deriveSeniorityInput(bidPack: Pick<BidPack, "seniorityList"> | null, profile: Pick<PreferenceProfile, "seniorityNumber"> | null): SeniorityInput | null {
  const list = bidPack?.seniorityList;
  const number = profile?.seniorityNumber;
  if (!list || list.length === 0 || !number) return null;
  return { rank: resolveBidPosition(list, number).bidNumber, totalPilots: list.length };
}
