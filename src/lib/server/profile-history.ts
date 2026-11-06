import { getJson, incrementCounter, setJson } from "@/lib/server/kv";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The last few versions of each pilot's saved profile, kept for a while after they're replaced — a way back if a
 * pilot ever says their logbook or priorities vanished. Never shown in the app; read through the admin route.
 * Each version is its own key (a ring of `VERSIONS` slots), so one large profile can't push the others out.
 */

export const VERSIONS = 5;
const KEEP_SECONDS = 30 * 24 * 60 * 60;

export interface ProfileVersion {
  savedAt: string;
  replacedAt: string;
  profile: PreferenceProfile;
}

const counterKey = (userId: string) => `line-select:profile-history:${userId}:count`;
const slotKey = (userId: string, slot: number) => `line-select:profile-history:${userId}:${slot}`;

/** Keeps the version a save is about to replace. Never throws: history is a safety net, not part of saving. */
export async function keepReplacedVersion(userId: string, replaced: { profile: PreferenceProfile; updatedAt: string }, now = new Date()): Promise<void> {
  try {
    const n = await incrementCounter(counterKey(userId), KEEP_SECONDS);
    const version: ProfileVersion = { savedAt: replaced.updatedAt, replacedAt: now.toISOString(), profile: replaced.profile };
    await setJson(slotKey(userId, (n - 1) % VERSIONS), version, { ttlSeconds: KEEP_SECONDS });
  } catch (e) {
    console.error("[profile-history] version not kept", e);
  }
}

/** The kept versions, newest first. */
export async function listKeptVersions(userId: string): Promise<ProfileVersion[]> {
  const slots = await Promise.all(Array.from({ length: VERSIONS }, (_, i) => getJson<ProfileVersion>(slotKey(userId, i))));
  return slots.filter((v): v is ProfileVersion => !!v).sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));
}
