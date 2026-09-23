import { EMPTY_MARKS, type LineMarks } from "@/lib/results-list";

/**
 * Which lines a pilot shortlisted or hid, per bid pack — local to the
 * device, same as the bid pack it refers to. Keyed by the bid pack's own id
 * so a new month's pack starts clean instead of carrying over marks for
 * line ids that no longer mean anything.
 */
function marksKey(userId: string | null, bidPackId: string): string {
  return `line-select:line-marks:${userId ?? "guest"}:${bidPackId}:v1`;
}

export function loadLineMarks(userId: string | null, bidPackId: string): LineMarks {
  if (typeof window === "undefined") return EMPTY_MARKS;
  try {
    const raw = window.localStorage.getItem(marksKey(userId, bidPackId));
    if (!raw) return EMPTY_MARKS;
    const parsed = JSON.parse(raw) as Partial<LineMarks>;
    return {
      starred: Array.isArray(parsed.starred) ? parsed.starred.filter((x): x is string => typeof x === "string") : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return EMPTY_MARKS;
  }
}

export function saveLineMarks(userId: string | null, bidPackId: string, marks: LineMarks): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(marksKey(userId, bidPackId), JSON.stringify(marks));
  } catch {
    // storage unavailable — marks just won't persist this session
  }
}
