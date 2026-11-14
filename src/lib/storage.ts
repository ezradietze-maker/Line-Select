import { clearServerProfile, fetchServerProfile, saveServerProfile, serverProfileVersion, setServerProfileVersion } from "@/lib/preference-profile-client";
import { mergeAfterConflict, sameProfile } from "@/lib/profile-merge";
import { migrateProfile } from "@/lib/profile-migration";
import { staleAfterStartOver } from "@/lib/start-over-signal";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const GUEST_KEY = "line-select:preference-profile:guest:v1";

function profileKey(userId: string | null): string {
  return userId ? `line-select:preference-profile:${userId}:v1` : GUEST_KEY;
}

/** The key a guest's profile is kept under, for a tab to hear another tab change it. */
export const GUEST_PROFILE_KEY = GUEST_KEY;

/**
 * The copy of the profile this tab last read from, or saved to, where it's kept: the account for a signed-in pilot,
 * this device for a guest. A save refused because another device (or tab) saved first is merged against it, so what
 * this tab changed since can be told from what the other one did (see `mergeAfterConflict`). Normalized like the
 * app's own copy, so a filled-in default doesn't read as an edit.
 */
let lastKnown: { userId: string | null; profile: PreferenceProfile } | null = null;

function remember(userId: string | null, profile: PreferenceProfile): void {
  lastKnown = { userId, profile: normalizeProfile(profile) };
}
function lastKnownFor(userId: string | null): PreferenceProfile | null {
  return lastKnown && lastKnown.userId === userId ? lastKnown.profile : null;
}
/** Signed out: what this tab last knew of the account's copy isn't what any later save starts from. */
export function forgetLastKnownProfile(): void {
  lastKnown = null;
  lastRun = null;
}

/**
 * Bumped each time a pilot's profile is cleared from this device (signing out, starting over): a save still waiting on
 * the server checks it before writing its merged copy back here, as the pack's saves do (`cleared` in bidpack-storage).
 */
const clearedProfiles = new Map<string, number>();
const clearCount = (userId: string | null) => clearedProfiles.get(profileKey(userId)) ?? 0;

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

/**
 * Another tab started over: a save this tab still has on its way isn't written back here, and what it last knew of the
 * profile is no copy to merge against. What's kept now stays — it may be a new profile made in that tab since.
 */
export function dropPendingProfileWrites(userId: string | null): void {
  clearedProfiles.set(profileKey(userId), clearCount(userId) + 1);
  if (lastKnown?.userId === userId) lastKnown = null;
  if (lastRun?.userId === userId) lastRun = null;
}

export function clearProfile(userId: string | null): void {
  if (typeof window === "undefined") return;
  dropPendingProfileWrites(userId);
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
  if (!userId) {
    const guest = loadProfile(null);
    if (guest) remember(null, guest);
    else forgetLastKnownProfile();
    return guest;
  }
  // Signed out while the server was asked: what it sends back isn't kept here (see `clearedProfiles`).
  const asOf = clearCount(userId);
  const server = await fetchServerProfile(userId);
  if (clearCount(userId) !== asOf) return null;
  if (server.kind === "found") {
    // A save that never reached the server (no signal, then the app was closed) goes up now, against the copy it was
    // made from, rather than being replaced by the older copy there.
    const pending = unsyncedBase(userId);
    const local = pending ? loadProfile(userId) : null;
    if (pending && local) {
      setServerProfileVersion(pending.base);
      // Which copy it was made from isn't known, only that copy's version: refused, the newer one is kept as before.
      forgetLastKnownProfile();
      const sent = await saveProfileForUser(userId, local);
      // Still not through (the server busy, say): it stays this device's, marked, rather than be replaced by the
      // server's older copy and lost. Later saves from here go against the copy it was made from too.
      return sent.profile;
    }
    // Backfilled like a local copy: a server copy saved by an older version lacks the newer weights and lists too.
    const profile = normalizeProfile(server.profile);
    saveProfile(userId, profile);
    remember(userId, profile);
    return profile;
  }
  const localProfile = loadProfile(userId);
  // Unreachable with a save still kept here: the retries the app runs (see `hasUnsyncedProfile`) go against the copy it
  // was made from, as above, not against no copy at all.
  const pending = server.kind === "unreachable" ? unsyncedBase(userId) : null;
  if (pending && localProfile) setServerProfileVersion(pending.base);
  if (server.kind === "none" && localProfile) {
    const saved = await saveServerProfile(localProfile, userId);
    if (clearCount(userId) !== asOf) return null;
    // Through now, so the "kept on this device" mark goes: left, sign-out kept the pilot's data on the device.
    if (saved.kind === "saved") {
      clearUnsynced(userId);
      remember(userId, localProfile);
    }
    if (saved.kind === "conflict" && saved.profile) {
      const newer = normalizeProfile(saved.profile);
      const merged = mergeAfterConflict(newer, localProfile);
      saveProfile(userId, merged);
      remember(userId, newer);
      const again = await saveServerProfile(merged, userId);
      if (clearCount(userId) === asOf && again.kind === "saved") {
        clearUnsynced(userId);
        remember(userId, merged);
      }
      return merged;
    }
  }
  return localProfile;
}

/**
 * Where a signed-in pilot's save ended up: on the server ("saved"); merged with a newer copy from another device
 * ("merged" — `profile` is what's now saved, and what the app should show); or only on this device for now
 * ("failed" — retried later; `profile` may be a merged copy whose second send failed, and it is what the app should
 * show and retry with). A guest's save is "local".
 */
export type ProfileSync = "local" | "saved" | "merged" | "failed";

/**
 * A signed-in pilot's saves run one at a time, each one whole — sent, refused, merged and sent again — before the next
 * starts. Run side by side, an edit saved while the one before it was being merged went up first, and the merged copy
 * (the other device's change with the first edit) then landed over it: the second edit was lost.
 */
let saving: Promise<unknown> = Promise.resolve();

/**
 * The last save this tab ran: what it sent, and what the account ended up with (a merged copy, when it was refused).
 * The next save was made from what was sent — the screen didn't have the merged copy yet — so it's laid over the merged
 * copy (`mergeAfterConflict` against what was sent), rather than sent over it and the other device's change lost again.
 */
let lastRun: { userId: string; sent: PreferenceProfile; result: PreferenceProfile } | null = null;

export async function saveProfileForUser(userId: string | null, profile: PreferenceProfile): Promise<{ savedLocally: boolean; sync: ProfileSync; profile: PreferenceProfile }> {
  // Started over in another tab that this one hasn't caught up with: its profile is the one just deleted, and saved it
  // went back onto the device and the account. Neither is touched; the tab drops it as soon as it hears (app-state).
  if (staleAfterStartOver(userId)) return { savedLocally: true, sync: "local", profile };
  if (!userId) return saveGuestProfile(profile);
  const savedLocally = saveProfile(userId, profile);
  const asOf = clearCount(userId);
  const run = saving.then(() => sendInTurn(userId, profile, asOf));
  saving = run.catch(() => {});
  const outcome = await run;
  // Signed out (or started over) while it was on its way: nothing of it is written back to this device.
  if (clearCount(userId) !== asOf) return { savedLocally, ...outcome };
  // Read after the save had its turn: saves wait for one another, so before it a save just ahead of this one hadn't
  // landed yet, and the mark named a version older than the one this save was sent against.
  if (outcome.sync === "failed") markUnsynced(userId, serverProfileVersion());
  else clearUnsynced(userId);
  return { savedLocally, ...outcome };
}

async function sendInTurn(userId: string, profile: PreferenceProfile, asOf: number): Promise<{ sync: ProfileSync; profile: PreferenceProfile }> {
  if (clearCount(userId) !== asOf) return { sync: "failed", profile };
  // Waited its turn behind another save while another tab started over: not sent (see `saveProfileForUser`).
  if (staleAfterStartOver(userId)) return { sync: "local", profile };
  const before = lastRun && lastRun.userId === userId && lastRun.result !== lastRun.sent ? lastRun : null;
  let toSend = profile;
  if (before) {
    const rebased = mergeAfterConflict(before.result, normalizeProfile(profile), normalizeProfile(before.sent));
    if (!sameProfile(rebased, normalizeProfile(profile))) {
      toSend = rebased;
      saveProfile(userId, toSend);
    }
  }
  const outcome = await sendForUser(userId, toSend, asOf);
  if (clearCount(userId) === asOf) lastRun = { userId, sent: profile, result: outcome.profile };
  // Laid over a merged copy, it's a merged copy too: the app shows it, and says another device's change is in it.
  return toSend !== profile && outcome.sync === "saved" ? { sync: "merged", profile: outcome.profile } : outcome;
}

async function sendForUser(userId: string, profile: PreferenceProfile, asOf: number): Promise<{ sync: ProfileSync; profile: PreferenceProfile }> {
  const saved = await saveServerProfile(profile, userId);
  const stillHere = () => clearCount(userId) === asOf;
  if (saved.kind === "saved") {
    if (stillHere()) remember(userId, profile);
    return { sync: "saved", profile };
  }
  if (saved.kind === "failed" || !saved.profile) return { sync: "failed", profile };
  const newer = normalizeProfile(saved.profile);
  const merged = mergeAfterConflict(newer, normalizeProfile(profile), lastKnownFor(userId));
  if (!stillHere()) return { sync: "failed", profile: merged };
  saveProfile(userId, merged);
  // The account holds the newer copy now, and the version this tab sends next is that one's: refused again, it's the
  // copy the merged one is compared against.
  remember(userId, newer);
  const again = await saveServerProfile(merged, userId);
  if (again.kind === "saved" && stillHere()) remember(userId, merged);
  return { sync: again.kind === "saved" ? "merged" : "failed", profile: merged };
}

/**
 * A guest's profile lives on this device only, and two tabs open on it each hold their own copy: one tab's save written
 * whole over the other's threw away a month just logged there. So a save first reads what's kept here, and if another
 * tab changed it since this tab last read or wrote it, the two are merged as two devices' are (`mergeAfterConflict`),
 * and the merged copy is what's saved and shown.
 */
function saveGuestProfile(profile: PreferenceProfile): { savedLocally: boolean; sync: ProfileSync; profile: PreferenceProfile } {
  const stored = loadProfile(null);
  const known = lastKnownFor(null);
  const toSave = stored && known && !sameProfile(stored, known) ? mergeAfterConflict(stored, normalizeProfile(profile), known) : profile;
  const savedLocally = saveProfile(null, toSave);
  if (savedLocally) remember(null, toSave);
  return { savedLocally, sync: "local", profile: toSave };
}

/**
 * The guest's profile as another tab just saved it, for a tab sitting idle to show: remembered as the copy this tab
 * last read, so its next save starts from it. Null when there's none kept, or it's the copy this tab already has.
 */
export function guestProfileChangedElsewhere(): PreferenceProfile | null {
  const stored = loadProfile(null);
  if (!stored || sameProfile(stored, lastKnownFor(null))) return null;
  remember(null, stored);
  return stored;
}

/**
 * Once the account holds the guest's logged months and bid checklist, the guest's copy gives them up: left there, every
 * later sign-in on this device added them to the account again, and brought back a month the pilot had since deleted.
 */
export function dropGuestRecords(): void {
  const guest = loadProfile(null);
  if (!guest || (!guest.logbook && !guest.bidChecklist)) return;
  const { logbook: _logbook, bidChecklist: _checklist, ...rest } = guest;
  void _logbook;
  void _checklist;
  // Not remembered as this tab's copy: it's the account's that the next save here starts from.
  saveProfile(null, rest);
}

/**
 * A save kept on this device only, with the server version it was made from: the first one that failed, so a run of
 * them is sent against the copy they all started from.
 */
const unsyncedKey = (userId: string) => `line-select:profile-unsynced:${userId}:v1`;
function markUnsynced(userId: string, base: string | null): void {
  try {
    if (!window.localStorage.getItem(unsyncedKey(userId))) window.localStorage.setItem(unsyncedKey(userId), JSON.stringify({ base }));
  } catch {
    // Storage unavailable: then nothing was kept on the device to send either.
  }
}
function clearUnsynced(userId: string): void {
  try {
    window.localStorage.removeItem(unsyncedKey(userId));
  } catch {
    // Nothing to clear.
  }
}
/**
 * Whether this device holds a save that never reached the account. The app reads it after loading the profile: then
 * the "kept on this device" notice shows and the retries run, and signing out leaves this device's copy alone (it's
 * the only one).
 */
export function hasUnsyncedProfile(userId: string): boolean {
  return unsyncedBase(userId) !== null;
}
function unsyncedBase(userId: string): { base: string | null } | null {
  try {
    const raw = window.localStorage.getItem(unsyncedKey(userId));
    const parsed = raw ? (JSON.parse(raw) as { base?: unknown }) : null;
    return parsed ? { base: typeof parsed.base === "string" ? parsed.base : null } : null;
  } catch {
    return null;
  }
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
  if (userId) await clearServerProfile(userId);
}
