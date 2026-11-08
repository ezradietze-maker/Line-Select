/**
 * Everything this device kept for a signed-in pilot — their pack, profile, seniority, interview and story drafts
 * (their own words), starred lines, swaps, history — removed when they sign out, so the next person at a crew-room
 * computer can't read it. The account keeps its own copy on the server; signing back in brings it back.
 */
export function forgetPilotOnDevice(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const store = window.localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k && k.startsWith("line-select:") && k.includes(userId));
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage unavailable: nothing was kept to forget.
  }
}
