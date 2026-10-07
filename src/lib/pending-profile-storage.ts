import type { PreferenceProfile } from "@/types/preferences";

/**
 * A finished interview that hasn't been confirmed yet. The interview's own
 * draft is gone the moment it finishes, so without this a refresh, a locked
 * phone or a switched app on the confirmation screen threw away every answer
 * the pilot had just given. Kept until they confirm, redo the interview, or
 * load a different bid pack — and never across bid packs.
 */

interface StoredPending {
  bidPackId: string;
  savedAt: number;
  profile: PreferenceProfile;
}

/** A day is plenty to come back and confirm; much older and it's a stale month. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function key(userId: string | null): string {
  return `line-select:pending-profile:${userId ?? "guest"}:v1`;
}

export function savePendingProfile(userId: string | null, bidPackId: string, profile: PreferenceProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(userId), JSON.stringify({ bidPackId, savedAt: Date.now(), profile } satisfies StoredPending));
  } catch {
    // storage full or unavailable — confirming still works this session
  }
}

export function loadPendingProfile(userId: string | null, bidPackId: string | null): PreferenceProfile | null {
  if (typeof window === "undefined" || !bidPackId) return null;
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredPending>;
    if (d.bidPackId !== bidPackId || typeof d.savedAt !== "number" || Date.now() - d.savedAt > MAX_AGE_MS) return null;
    return d.profile && typeof d.profile === "object" && d.profile.weights ? (d.profile as PreferenceProfile) : null;
  } catch {
    return null;
  }
}

export function clearPendingProfile(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(userId));
  } catch {
    // ignore
  }
}
