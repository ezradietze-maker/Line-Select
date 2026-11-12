import type { LoggedMonth } from "@/types/logbook";
import type { PreferenceProfile } from "@/types/preferences";

/** The latest moment an entry was written: logged, checked in, or shared. */
function lastTouched(e: LoggedMonth): string {
  return [e.loggedAt, e.checkIn?.at, e.sharedAt].filter((t): t is string => !!t).sort().at(-1) ?? "";
}

/**
 * The same value, whatever order its keys were written in: the server's database hands a profile back with its keys
 * reordered, so comparing the text would read every untouched setting as changed.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!sameValue(ra[k], rb[k])) return false;
  return true;
}

/** Whether two copies of a profile hold the same things. */
export function sameProfile(a: PreferenceProfile | null, b: PreferenceProfile | null): boolean {
  return sameValue(a, b);
}

/** Merged on their own below, entry by entry, so neither copy's is taken whole. */
const MERGED_APART = new Set<string>(["logbook", "bidChecklist"]);

/**
 * What a device keeps when its save is refused because another device saved first: the newer copy, with what this
 * device changed since the copy its save started from (`base`) laid over it — a priority's level, a pin, a city's
 * grade, the seniority number. Where both changed the same setting, this device's stands: it's the one the pilot is
 * looking at. With no copy to compare against (a save kept from an earlier visit), the newer copy is kept as it is.
 *
 * Unless this device finished an interview after the one the other copy holds: then it's this device's interview that
 * stands whole (the other copy only ticked a box or logged a month since), or a check-in done in a tab left open
 * overnight was thrown away. And when the other copy holds an interview finished since the base, that interview stands
 * whole: this device's changes were made to the one it replaced.
 *
 * Either way every logbook entry from both is kept: a month logged on one device and checked in on the other keeps the
 * later of the two, and an entry deleted on one device comes back from the other — losing a logged month is worse than
 * deleting it twice. The bid checklist keeps what either device ticked.
 */
export function mergeAfterConflict(newer: PreferenceProfile, mine: PreferenceProfile, base: PreferenceProfile | null = null): PreferenceProfile {
  const start = startingCopy(newer, mine, base);
  if (start === newer && !mine.logbook && !newer.logbook && !mine.bidChecklist) return newer;
  const ticked = mergedChecklist(newer, mine);
  const withChecklist = ticked ? { ...start, bidChecklist: ticked } : start;
  return { ...withChecklist, ...mergedLogbook(newer, mine) };
}

function startingCopy(newer: PreferenceProfile, mine: PreferenceProfile, base: PreferenceProfile | null): PreferenceProfile {
  if ((mine.completedAt ?? "") > (newer.completedAt ?? "")) return mine;
  if (!base || (newer.completedAt ?? "") !== (base.completedAt ?? "")) return newer;
  const theirs = newer as unknown as Record<string, unknown>;
  const ours = mine as unknown as Record<string, unknown>;
  const before = base as unknown as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(ours), ...Object.keys(before)])].filter((k) => !MERGED_APART.has(k) && !sameValue(ours[k], before[k]));
  if (!changed.length) return newer;
  const out: Record<string, unknown> = { ...theirs };
  for (const k of changed) {
    // Cleared here (a target taken off, say): cleared in the merged copy too.
    if (ours[k] === undefined) delete out[k];
    else out[k] = ours[k];
  }
  return out as unknown as PreferenceProfile;
}

/** What either copy ticked on the bid checklist; a month entered in VIPS on one device stays entered. Null when neither has one. */
function mergedChecklist(newer: PreferenceProfile, mine: PreferenceProfile): PreferenceProfile["bidChecklist"] | null {
  const ticked = { ...(mine.bidChecklist ?? {}), ...(newer.bidChecklist ?? {}) };
  for (const [packId, t] of Object.entries(mine.bidChecklist ?? {})) if (!ticked[packId]?.enteredAt && t.enteredAt) ticked[packId] = t;
  return Object.keys(ticked).length ? ticked : null;
}

export function mergedLogbook(newer: PreferenceProfile, mine: PreferenceProfile): Pick<PreferenceProfile, "logbook"> {
  const byId = new Map<string, LoggedMonth>();
  for (const e of newer.logbook ?? []) byId.set(e.id, e);
  for (const e of mine.logbook ?? []) {
    const theirs = byId.get(e.id);
    if (!theirs || lastTouched(e) > lastTouched(theirs)) byId.set(e.id, e);
  }
  const logbook = [...byId.values()].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  return logbook.length || newer.logbook || mine.logbook ? { logbook } : {};
}

/**
 * A guest signing in to an account that already has a profile: the account's stays as it is, with the months the guest
 * logged and the bid checklist they ticked added to it, so neither is hidden behind the account's.
 */
export function withGuestRecords(account: PreferenceProfile, guest: PreferenceProfile): PreferenceProfile {
  if (!guest.logbook?.length && !Object.keys(guest.bidChecklist ?? {}).length) return account;
  const ticked = mergedChecklist(account, guest);
  return { ...account, ...(ticked ? { bidChecklist: ticked } : {}), ...mergedLogbook(account, guest) };
}
