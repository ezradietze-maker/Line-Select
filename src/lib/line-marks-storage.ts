import { saveOrReport } from "@/lib/local-save-failed";
import { EMPTY_MARKS, type LineMarks } from "@/lib/results-list";
import { changedIds, mergeIds, type StoredList } from "@/lib/shared-store";

/**
 * Which lines a pilot shortlisted or hid, per bid pack — local to the
 * device, same as the bid pack it refers to. Keyed by the bid pack's own id
 * so a new month's pack starts clean instead of carrying over marks for
 * line ids that no longer mean anything.
 */
export function marksKey(userId: string | null, bidPackId: string): string {
  return `line-select:line-marks:${userId ?? "guest"}:${bidPackId}:v1`;
}

export function loadLineMarks(userId: string | null, bidPackId: string): LineMarks {
  return readLineMarks(userId, bidPackId) ?? EMPTY_MARKS;
}

/** What's stored, or null when nothing readable is. */
function readLineMarks(userId: string | null, bidPackId: string): LineMarks | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(marksKey(userId, bidPackId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LineMarks>;
    return {
      starred: Array.isArray(parsed.starred) ? parsed.starred.filter((x): x is string => typeof x === "string") : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

/** Whether the browser kept them; when it didn't, the pilot is told they won't survive a refresh (`saveOrReport`). */
export function saveLineMarks(userId: string | null, bidPackId: string, marks: LineMarks): boolean {
  return saveOrReport(marksKey(userId, bidPackId), JSON.stringify(marks));
}

/**
 * Another tab's stars and hidden lines kept, and this tab's say on the lines it changed: both lists together, since
 * starring a line un-hides it.
 */
export function mergeLineMarks(base: LineMarks, mine: LineMarks, theirs: LineMarks): LineMarks {
  const touched = new Set([...changedIds(base.starred, mine.starred), ...changedIds(base.hidden, mine.hidden)]);
  if (touched.size === 0) return theirs;
  return { starred: mergeIds(mine.starred, theirs.starred, touched), hidden: mergeIds(mine.hidden, theirs.hidden, touched) };
}

/** The pilot's marks for this pack, for `useSharedList`. */
export function lineMarksStore(userId: string | null, bidPackId: string): StoredList<LineMarks> {
  return { read: () => readLineMarks(userId, bidPackId), write: (m) => saveLineMarks(userId, bidPackId, m), merge: mergeLineMarks };
}
