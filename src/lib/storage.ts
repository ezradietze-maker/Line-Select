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
function normalizeProfile(parsed: Partial<PreferenceProfile>): PreferenceProfile {
  return {
    weights: { ...DEFAULT_WEIGHTS, ...parsed.weights },
    deepRoundCompleted: parsed.deepRoundCompleted ?? false,
    tradeoffAnswers: parsed.tradeoffAnswers ?? [],
    explicitTargets: parsed.explicitTargets ?? {},
    isCommuter: parsed.isCommuter ?? null,
    hasCrashPad: parsed.hasCrashPad ?? null,
    cityPreferences: parsed.cityPreferences ?? {},
    completedAt: parsed.completedAt ?? new Date(0).toISOString(),
    implicitWeights: parsed.implicitWeights ?? {},
    implicitConfidence: parsed.implicitConfidence ?? {},
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

export function saveProfile(
  userId: string | null,
  profile: PreferenceProfile
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(profileKey(userId), JSON.stringify(profile));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) - fail silently.
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
