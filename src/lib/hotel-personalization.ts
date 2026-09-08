import type { HotelAmenityCategory, ReviewSentiment, ReviewThemeKey } from "@/types/hotel";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";

/** Minimum positive weight before a pilot's own slider counts as "flagged this," not just left at its neutral default. */
const FLAG_THRESHOLD = 15;

const AMENITY_WEIGHT_KEY: Record<HotelAmenityCategory, keyof PreferenceWeights | null> = {
  food: "hotelFood",
  gym: "hotelGym",
  grocery: "hotelGrocery",
  // No slider maps to "coffee shops nearby" specifically — it keeps its default position.
  coffee: null,
};

/**
 * Reorders amenity categories by how much this pilot's own interview
 * weighted each one, instead of the same fixed food/gym/grocery/coffee order
 * for every pilot. Array.sort is stable, so categories tied at the same
 * weight (including two pilots' worth of "didn't ask about this") keep the
 * original order rather than shuffling arbitrarily.
 */
export function orderedAmenityCategories(
  profile: PreferenceProfile | null,
  categories: HotelAmenityCategory[]
): HotelAmenityCategory[] {
  if (!profile) return categories;
  const weightFor = (c: HotelAmenityCategory) => {
    const key = AMENITY_WEIGHT_KEY[c];
    return key ? profile.weights[key] : 0;
  };
  return [...categories].sort((a, b) => weightFor(b) - weightFor(a));
}

/**
 * This pilot's own stated reason for loving/avoiding this specific city,
 * when that reason was hotel-related (`PreferenceFact.cityReason`) — surfaced
 * as a lead-in ahead of the generic amenity/review breakdown instead of
 * buried in the qualitative-facts list on the results screen.
 */
export function hotelCityReason(profile: PreferenceProfile | null, code: string): string | null {
  if (!profile) return null;
  const fact = profile.discoveredFacts.find(
    (f) => f.cityReason?.category === "hotel" && f.cityReason.code === code
  );
  return fact?.statement ?? null;
}

/** True when this pilot's own interview flagged room quietness or circadian protection strongly enough to promote a quiet-room note rather than bury it. */
export function wantsQuietRoom(profile: PreferenceProfile | null): boolean {
  if (!profile) return false;
  return profile.weights.hotelQuiet > FLAG_THRESHOLD || profile.weights.circadianHealth > FLAG_THRESHOLD;
}

/** True when this pilot's own interview flagged gym access strongly enough to promote an on-site-gym review theme, when the hotel has one, ahead of the rest. */
export function wantsGymEmphasis(profile: PreferenceProfile | null): boolean {
  if (!profile) return false;
  return profile.weights.hotelGym > FLAG_THRESHOLD;
}

/**
 * Reorders review themes so whichever one this pilot's own interview
 * flagged (quietness/sleep for a circadian- or quiet-flagging pilot,
 * on-site gym for a gym-flagging pilot) leads instead of whatever order the
 * review-summarization step happened to emit them in.
 */
export function orderedThemeEntries(
  profile: PreferenceProfile | null,
  entries: [ReviewThemeKey, ReviewSentiment][]
): [ReviewThemeKey, ReviewSentiment][] {
  if (!profile) return entries;
  const priority = new Set<ReviewThemeKey>();
  if (wantsQuietRoom(profile)) {
    priority.add("quietness");
    priority.add("sleepComfort");
  }
  if (wantsGymEmphasis(profile)) priority.add("onSiteGym");
  if (priority.size === 0) return entries;
  return [...entries].sort((a, b) => Number(priority.has(b[0])) - Number(priority.has(a[0])));
}
