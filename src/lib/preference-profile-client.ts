import { migrateDeparturesToDutyPeriods } from "@/lib/profile-migration";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * Thin client for the server-backed profile store (see
 * `/api/preference-profile` and `lib/server/db.ts`'s `preferenceProfiles`).
 * Every call here is only ever made for a signed-in pilot — a guest has no
 * server identity to key a profile by, so the caller (`lib/app-state.tsx`)
 * keeps guests on localStorage alone via `lib/storage.ts` and never reaches
 * this module for them. Every function fails soft (returns null / no-ops)
 * so a network hiccup degrades to "read the local cache" rather than
 * blocking the app.
 */

export async function fetchServerProfile(): Promise<PreferenceProfile | null> {
  try {
    const res = await fetch("/api/preference-profile", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.profile ? migrateDeparturesToDutyPeriods(data.profile as PreferenceProfile) : null;
  } catch {
    return null;
  }
}

export async function saveServerProfile(profile: PreferenceProfile): Promise<void> {
  try {
    await fetch("/api/preference-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ profile }),
    });
  } catch {
    // Local cache (lib/storage.ts) already has it — next load retries the server.
  }
}

export async function clearServerProfile(): Promise<void> {
  try {
    await fetch("/api/preference-profile", { method: "DELETE", credentials: "same-origin" });
  } catch {
    // worst case a stale server profile lingers until the next successful save.
  }
}
