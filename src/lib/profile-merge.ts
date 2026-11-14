import { newestMonthFirst } from "@/lib/logbook";
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
 * Settings that are a list of separate answers — one per priority, target, city, strategy — merged answer by answer, so
 * a city graded on the phone and another graded on the laptop are both kept. The number is how deep that goes: a
 * city's grade is merged field by field, and its hotels hotel by hotel. A target's own value (a range, say) is one
 * answer, never half from each device.
 */
const BY_ANSWER: Record<string, number> = {
  weights: 1,
  explicitTargets: 1,
  targetImportance: 1,
  cityPreferences: 1,
  cityRatings: 3,
  implicitWeights: 1,
  implicitConfidence: 1,
  strategyReactions: 1,
};

/**
 * What a device keeps when its save is refused because another device saved first: the newer copy, with what this
 * device changed since the copy its save started from (`base`) laid over it — a priority's level, a pin, a city's
 * grade, a drag, the seniority number. Settings made of separate answers (cities, priorities, targets, pins, drags) are
 * merged answer by answer, so each device's own answers are kept. Where both changed the same answer, this device's
 * stands: it's the one the pilot is looking at. With no copy to compare against (a save kept from an earlier visit), the
 * newer copy is kept as it is.
 *
 * Unless this device finished an interview after the one the other copy holds: then it's this device's interview that
 * stands whole (the other copy only ticked a box or logged a month since), or a check-in done in a tab left open
 * overnight was thrown away. And when the other copy holds an interview finished since the base, that interview stands
 * whole: this device's changes were made to the one it replaced.
 *
 * The working model (`pilotModel`) is taken whole, from this device if it changed it: it's refitted from the pins and
 * drags, which are merged, the next time either changes.
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
    else if (k === "brainInterview") out[k] = mergedInterviewRecord(theirs[k], ours[k], before[k]);
    else out[k] = mergedAnswers(theirs[k], ours[k], before[k], BY_ANSWER[k] ?? 0);
  }
  return out as unknown as PreferenceProfile;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The other copy's answers with this device's changes since the base laid over them, answer by answer to `depth`
 * levels. Below that, or where any copy isn't a set of answers, this device's value is taken whole.
 */
function mergedAnswers(theirs: unknown, mine: unknown, base: unknown, depth: number): unknown {
  if (sameValue(mine, base)) return theirs;
  // Not there yet on a copy (no strategy reacted to, say): no answers, rather than something to take whole.
  if (theirs === undefined) theirs = {};
  if (base === undefined) base = {};
  if (depth <= 0 || !isRecord(theirs) || !isRecord(mine) || !isRecord(base)) return mine;
  const out: Record<string, unknown> = { ...theirs };
  for (const k of new Set([...Object.keys(mine), ...Object.keys(base)])) {
    if (sameValue(mine[k], base[k])) continue;
    if (mine[k] === undefined) delete out[k];
    else out[k] = mergedAnswers(theirs[k], mine[k], base[k], depth - 1);
  }
  return out;
}

type InterviewRecord = NonNullable<PreferenceProfile["brainInterview"]>;

/**
 * The interview's record: pins merged pin by pin, and the drags on the results (with what was said about each swap)
 * drag by drag — one made on either device is kept, and one undone on either device since the base stays undone. The
 * interview's own questions, answers and confirmed model are taken whole, from this device if it changed them.
 */
function mergedInterviewRecord(theirs: unknown, mine: unknown, base: unknown): unknown {
  if (!isRecord(theirs) || !isRecord(mine) || !isRecord(base)) return mine;
  const t = theirs as unknown as InterviewRecord;
  const m = mine as unknown as InterviewRecord;
  const b = base as unknown as InterviewRecord;
  const out = { ...(mergedAnswers(theirs, mine, base, 1) as Record<string, unknown>) };
  const pins = mergedAnswers(t.pins, m.pins, b.pins, 1);
  if (pins === undefined) delete out.pins;
  else out.pins = pins;
  out.choices = mergedByDrag(t.choices ?? [], m.choices ?? [], b.choices ?? []);
  if (t.swapAnswers || m.swapAnswers) out.swapAnswers = mergedByDrag(t.swapAnswers ?? [], m.swapAnswers ?? [], b.swapAnswers ?? []);
  return out;
}

/**
 * A list of entries grouped by the drag that made them: the other copy's groups, less the ones this device undid since
 * the base, with this device's version of a group it changed (a later drag set an earlier one aside), and with the
 * groups it added. Entries no drag made (the interview's own choices) are one group.
 */
function mergedByDrag<T extends { dragId?: string }>(theirs: T[], mine: T[], base: T[]): T[] {
  const groups = (list: T[]) => {
    const byDrag = new Map<string, T[]>();
    for (const e of list) byDrag.set(e.dragId ?? "", [...(byDrag.get(e.dragId ?? "") ?? []), e]);
    return byDrag;
  };
  const [t, m, b] = [groups(theirs), groups(mine), groups(base)];
  const out: T[] = [];
  for (const [id, entries] of t) {
    if (b.has(id) && !m.has(id)) continue;
    const changedHere = m.has(id) && !sameValue(m.get(id), b.get(id));
    out.push(...(changedHere ? m.get(id)! : entries));
  }
  for (const [id, entries] of m) if (!t.has(id) && !b.has(id)) out.push(...entries);
  return out;
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
  const logbook = newestMonthFirst([...byId.values()]);
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
