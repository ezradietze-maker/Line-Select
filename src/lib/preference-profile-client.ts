import { migrateProfile } from "@/lib/profile-migration";
import { apiFetch, shownAccount } from "@/lib/shown-account";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * Thin client for the server-backed profile store (see
 * `/api/preference-profile` and `lib/server/db.ts`'s `preferenceProfiles`).
 * Every call here is only ever made for a signed-in pilot — a guest has no
 * server identity to key a profile by, so the caller (`lib/app-state.tsx`)
 * keeps guests on localStorage alone via `lib/storage.ts` and never reaches
 * this module for them. Nothing here throws: each call says what happened,
 * and "couldn't reach the server" is never mistaken for "nothing saved there".
 */

/** The version of the server's copy this tab last loaded or saved — sent with each save, so a save made from an older copy is refused, never written over a newer one. */
let serverVersion: string | null = null;

export type ServerProfileLoad =
  | { kind: "found"; profile: PreferenceProfile }
  /** Signed in, and nothing saved on the server yet. */
  | { kind: "none" }
  /** Couldn't tell: offline, a server error, a session that lapsed. Never a reason to upload over the server. */
  | { kind: "unreachable" };

/** `userId`: whose profile is asked for, which the server checks is the one signed in (see `apiFetch`). */
export async function fetchServerProfile(userId: string | null | undefined = shownAccount()): Promise<ServerProfileLoad> {
  try {
    const res = await apiFetch("/api/preference-profile", { credentials: "same-origin", cache: "no-store" }, userId);
    if (!res.ok) return { kind: "unreachable" };
    const data = (await res.json()) as { profile?: PreferenceProfile | null; updatedAt?: string | null };
    serverVersion = data.updatedAt ?? null;
    return data.profile ? { kind: "found", profile: migrateProfile(data.profile) } : { kind: "none" };
  } catch {
    return { kind: "unreachable" };
  }
}

/**
 * The account's profile as the server has it now, for a look only: its version isn't taken as this tab's own, so a
 * save from here is still refused over a newer copy. Undefined when the server couldn't be reached.
 */
export async function peekServerProfile(): Promise<PreferenceProfile | null | undefined> {
  try {
    const res = await apiFetch("/api/preference-profile", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { profile?: PreferenceProfile | null };
    return data.profile ?? null;
  } catch {
    return undefined;
  }
}

export type ServerProfileSave =
  | { kind: "saved" }
  /** Saved from another device since this one loaded it: the newer copy, to merge with. */
  | { kind: "conflict"; profile: PreferenceProfile | null }
  | { kind: "failed" };

/** What the server's copy was when this tab last heard: for a save kept on this device to be sent against later. */
export const serverProfileVersion = () => serverVersion;
export function setServerProfileVersion(version: string | null): void {
  serverVersion = version;
}

/**
 * Saves go one at a time, each with the version the one before it got back. Sent together, the second carried the
 * same version as the first, was refused once the first landed, and its edit was lost to a "merge" with this tab's own
 * save, under a banner saying another device had made it.
 */
let queue: Promise<unknown> = Promise.resolve();

/** `userId`: whose profile it is — named when the save is asked for, not when its turn comes and the tab may show another. */
export function saveServerProfile(profile: PreferenceProfile, userId: string | null | undefined = shownAccount()): Promise<ServerProfileSave> {
  const run = queue.then(() => sendProfile(profile, userId));
  queue = run.catch(() => {});
  return run;
}

async function sendProfile(profile: PreferenceProfile, userId: string | null | undefined): Promise<ServerProfileSave> {
  try {
    const res = await apiFetch(
      "/api/preference-profile",
      { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ profile, baseUpdatedAt: serverVersion }) },
      userId
    );
    const data = (await res.json().catch(() => ({}))) as { profile?: PreferenceProfile | null; updatedAt?: string | null };
    if (res.ok) {
      serverVersion = data.updatedAt ?? serverVersion;
      return { kind: "saved" };
    }
    if (res.status === 409) {
      serverVersion = data.updatedAt ?? null;
      return { kind: "conflict", profile: data.profile ? migrateProfile(data.profile) : null };
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export async function clearServerProfile(userId: string | null | undefined = shownAccount()): Promise<void> {
  try {
    await apiFetch("/api/preference-profile", { method: "DELETE", credentials: "same-origin" }, userId);
    serverVersion = null;
  } catch {
    // worst case a stale server profile lingers until the next successful save.
  }
}
