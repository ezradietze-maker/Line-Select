import { clearServerProfile, fetchServerProfile, saveServerProfile } from "@/lib/preference-profile-client";
import { mergeAfterConflict } from "@/lib/profile-merge";
import { migrateProfile } from "@/lib/profile-migration";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const GUEST_KEY = "line-select:preference-profile:guest:v1";

function profileKey(userId: string | null): string {
  return userId ? `line-select:preference-profile:${userId}:v1` : GUEST_KEY;
}

/**
 * Backfills fields that didn't exist yet when a profile was saved (the
 * interview keeps growing new dimensions and questions), so a profile saved
 * by an older version of the app doesn't crash the newer one — it just
 * treats anything unanswered as "no preference" / "not asked".
 */
function normalizeProfile(raw: Partial<PreferenceProfile>): PreferenceProfile {
  const parsed = migrateProfile(raw);
  return {
    // Everything saved is kept (commuteFrom, targetImportance, cityRatings, strategyReactions …); only missing fields are filled below.
    ...parsed,
    weights: { ...DEFAULT_WEIGHTS, ...parsed.weights },
    deepRoundCompleted: parsed.deepRoundCompleted ?? false,
    tradeoffAnswers: parsed.tradeoffAnswers ?? [],
    explicitTargets: parsed.explicitTargets ?? {},
    isCommuter: parsed.isCommuter ?? null,
    hasCrashPad: parsed.hasCrashPad ?? null,
    seniorityNumber: parsed.seniorityNumber ?? null,
    cityPreferences: parsed.cityPreferences ?? {},
    completedAt: parsed.completedAt ?? new Date(0).toISOString(),
    implicitWeights: parsed.implicitWeights ?? {},
    implicitConfidence: parsed.implicitConfidence ?? {},
    discoveredFacts: parsed.discoveredFacts ?? [],
    interviewTranscript: parsed.interviewTranscript ?? [],
  };
}

export function loadProfile(userId: string | null): PreferenceProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(profileKey(userId));
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw) as Partial<PreferenceProfile>);
  } catch {
    return null;
  }
}

/**
 * Returns whether the write actually landed — mirrors `saveBidPack`'s own
 * boolean return in `bidpack-storage.ts`. The adaptive interview's
 * transcript/discoveredFacts (now including a potentially long bidding-
 * story answer) have no compaction the way a bid pack does, so a quota
 * failure here is more plausible than it used to be; silently swallowing
 * it left a pilot with no idea their finished profile never actually saved.
 */
export function saveProfile(
  userId: string | null,
  profile: PreferenceProfile
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(profileKey(userId), JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function clearProfile(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(profileKey(userId));
  } catch {
    // ignore
  }
}

/**
 * The server (see `preference-profile-client.ts`) is the source of truth
 * for a signed-in pilot — the whole point is that it survives a device
 * change localStorage alone never could. A guest has no server identity, so
 * stays on the plain localStorage functions above. On a hit, the server
 * profile also refreshes the local cache so the next boot has something to
 * show instantly before the network call resolves. When the server says
 * it has nothing, this migrates any pre-existing local-only profile up to
 * it once (covers a pilot who used the app before server-side persistence
 * existed). When the server can't be reached, the local copy is used and
 * nothing is uploaded: an older copy on this device must never replace a
 * newer one saved from another.
 */
export async function loadProfileForUser(userId: string | null): Promise<PreferenceProfile | null> {
  if (!userId) return loadProfile(null);
  const server = await fetchServerProfile();
  if (server.kind === "found") {
    saveProfile(userId, server.profile);
    return server.profile;
  }
  const localProfile = loadProfile(userId);
  if (server.kind === "none" && localProfile) {
    const saved = await saveServerProfile(localProfile);
    if (saved.kind === "conflict" && saved.profile) {
      const merged = mergeAfterConflict(saved.profile, localProfile);
      saveProfile(userId, merged);
      await saveServerProfile(merged);
      return merged;
    }
  }
  return localProfile;
}

/**
 * Where a signed-in pilot's save ended up: on the server ("saved"); merged with a newer copy from another device
 * ("merged" — `profile` is what's now saved, and what the app should show); or only on this device for now
 * ("failed" — retried later). A guest's save is "local".
 */
export type ProfileSync = "local" | "saved" | "merged" | "failed";

export async function saveProfileForUser(userId: string | null, profile: PreferenceProfile): Promise<{ savedLocally: boolean; sync: ProfileSync; profile: PreferenceProfile }> {
  const savedLocally = saveProfile(userId, profile);
  if (!userId) return { savedLocally, sync: "local", profile };
  const saved = await saveServerProfile(profile);
  if (saved.kind === "saved") return { savedLocally, sync: "saved", profile };
  if (saved.kind === "failed" || !saved.profile) return { savedLocally, sync: "failed", profile };
  const merged = mergeAfterConflict(saved.profile, profile);
  saveProfile(userId, merged);
  const again = await saveServerProfile(merged);
  return { savedLocally, sync: again.kind === "saved" ? "merged" : "failed", profile: merged };
}

/**
 * Asks the browser to keep this site's storage rather than clear it when space runs low or the site goes unvisited
 * (Safari clears it after 7 days away). Browsers decide for themselves — Chrome grants it to sites used often, Safari
 * to sites added to the home screen — so this lowers the risk, it doesn't remove it. Asking again is harmless.
 */
export function askToKeepStorage(): void {
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // An old browser without the Storage API: nothing to ask.
  }
}

export async function clearProfileForUser(userId: string | null): Promise<void> {
  clearProfile(userId);
  if (userId) await clearServerProfile();
}
