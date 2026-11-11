/**
 * Kept under no pilot's id, but just as much theirs: the employee number and answers for VIPS, the home airport and
 * commute settings, and the flights looked up from it.
 */
const UNSCOPED = ["line-select:vips-employee-number:v1", "line-select:vips-answers:v1", "line-select:commute-settings:v1", "line-select:flights:v5:", "line-select:commute-check:v2:"];

/**
 * Everything this device kept for a signed-in pilot — their pack, profile, seniority, interview and story drafts
 * (their own words), starred lines, swaps, history — removed when they sign out, so the next person at a crew-room
 * computer can't read it. The account keeps its own copy on the server; signing back in brings it back.
 */
export function forgetPilotOnDevice(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const store = window.localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k && k.startsWith("line-select:") && (k.includes(userId) || UNSCOPED.some((p) => k.startsWith(p))));
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage unavailable: nothing was kept to forget.
  }
}
