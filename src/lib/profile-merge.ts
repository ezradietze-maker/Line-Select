import type { LoggedMonth } from "@/types/logbook";
import type { PreferenceProfile } from "@/types/preferences";

/** The latest moment an entry was written: logged, checked in, or shared. */
function lastTouched(e: LoggedMonth): string {
  return [e.loggedAt, e.checkIn?.at, e.sharedAt].filter((t): t is string => !!t).sort().at(-1) ?? "";
}

/**
 * What a device keeps when its save is refused because another device saved first: the newer copy, with every
 * logbook entry from both. A month logged on one device and checked in on the other keeps the later of the two.
 * An entry deleted on one device comes back from the other — losing a logged month is worse than deleting it twice.
 *
 * Unless this device finished an interview after the one the other copy holds: then it's this device's interview that
 * stands (the other copy only ticked a box or logged a month since), or a check-in done in a tab left open overnight
 * was thrown away. The bid checklist keeps what either device ticked.
 */
export function mergeAfterConflict(newer: PreferenceProfile, mine: PreferenceProfile): PreferenceProfile {
  const base = (mine.completedAt ?? "") > (newer.completedAt ?? "") ? mine : newer;
  if (base === newer && !mine.logbook && !newer.logbook && !mine.bidChecklist) return newer;
  const ticked = { ...(mine.bidChecklist ?? {}), ...(newer.bidChecklist ?? {}) };
  for (const [packId, t] of Object.entries(mine.bidChecklist ?? {})) if (!ticked[packId]?.enteredAt && t.enteredAt) ticked[packId] = t;
  const withChecklist = Object.keys(ticked).length ? { ...base, bidChecklist: ticked } : base;
  return { ...withChecklist, ...mergedLogbook(newer, mine) };
}

function mergedLogbook(newer: PreferenceProfile, mine: PreferenceProfile): Pick<PreferenceProfile, "logbook"> {
  const byId = new Map<string, LoggedMonth>();
  for (const e of newer.logbook ?? []) byId.set(e.id, e);
  for (const e of mine.logbook ?? []) {
    const theirs = byId.get(e.id);
    if (!theirs || lastTouched(e) > lastTouched(theirs)) byId.set(e.id, e);
  }
  const logbook = [...byId.values()].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  return logbook.length || newer.logbook || mine.logbook ? { logbook } : {};
}
