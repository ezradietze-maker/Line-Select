import { isSamplePack } from "@/lib/fake-trade-offers";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/** Where a pilot picks up: their rankings once they've a profile, the preferences screen with only a pack, else the landing page. */
export function landingPathFor(bidPack: BidPack | null, profile: PreferenceProfile | null): string {
  if (!bidPack) return "/";
  return profile ? "/results" : "/preferences";
}

/**
 * Where signing in lands. An account never takes over the sample pack, so a guest trying the sample who makes one has
 * no pack on it yet: they go to upload their own, not to the landing page as though they'd never started.
 */
export function landingAfterSignIn(accountPack: BidPack | null, profile: PreferenceProfile | null, guestPack: BidPack | null): string {
  if (!accountPack && guestPack && isSamplePack(guestPack)) return "/upload";
  return landingPathFor(accountPack, profile);
}
