import { clearBidPack } from "@/lib/bidpack-storage";
import { clearProfile } from "@/lib/storage";

/**
 * Kept under no pilot's id, but just as much theirs: the employee number and answers for VIPS, the home airport and
 * commute settings, the flights looked up from it, and the calendar feed sent (its value names their account and #1 line).
 */
const UNSCOPED = ["line-select:vips-employee-number:v1", "line-select:vips-answers:v1", "line-select:commute-settings:v1", "line-select:flights:v5:", "line-select:commute-check:v2:", "line-select:calendar-feed-sent:v1"];

/**
 * What they did as a guest before signing in, on this device: seniority, interview and story words, contract chat, a
 * feedback draft, tiers. Some of it was copied to the account and some wasn't, but either way it was theirs, and left
 * it loaded for the next guest. The guest's pack stays: it's the bid pack every pilot in that seat has.
 */
const isGuestsOwn = (k: string) => k.includes(":guest:") && !k.startsWith("line-select:bidpack:guest:");

/**
 * Everything this device kept for a signed-in pilot — their pack, profile, seniority, interview and story drafts
 * (their own words), starred lines, swaps, history — removed when they sign out, so the next person at a crew-room
 * computer can't read it, and what they'd done as a guest there before signing in. The account keeps its own copy on
 * the server; signing back in brings it back.
 */
export function forgetPilotOnDevice(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  // Through the pack's and the profile's own clears, so a save still compressing, or one the account refused and that's
  // being merged with its newer copy, doesn't write it back afterwards.
  clearBidPack(userId);
  clearProfile(userId);
  try {
    const store = window.localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k && k.startsWith("line-select:") && (k.includes(userId) || UNSCOPED.some((p) => k.startsWith(p)) || isGuestsOwn(k)));
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage unavailable: nothing was kept to forget.
  }
}
