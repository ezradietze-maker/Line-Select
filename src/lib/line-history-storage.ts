import type { LineScore } from "@/lib/scoring";

/**
 * A snapshot of which lines a pilot's ranking actually favored, kept purely
 * so a future bid cycle can say "this scores similarly to lines you've
 * historically preferred" (see `historicalConsistencyNote` in `scoring.ts`)
 * — separate from `PreferenceProfile`/`storage.ts` since this describes what
 * the pilot was SHOWN and favored, not what they said in an interview.
 * Refreshed every time results are computed, tagged with its bid month so a
 * later month can compare against it (and this month never compares against
 * itself).
 */
export interface LineSnapshot {
  lineNumber: string;
  score: number;
  /** Normalized [0,1] dimension values for every fixed/implicit dimension this line had, keyed the same way `DimensionScore.key` is — enough to compare "similar shape" against a future line without needing the original bid pack around. */
  dimensionValues: Record<string, number>;
}

const TOP_LINES_TO_KEEP = 3;

/**
 * Two months' worth: the bid month currently being worked on, and the one
 * before it. Comparisons only ever read a different month than the one on
 * screen — reading this month's own snapshot back would just say a line
 * looks like itself.
 */
interface StoredHistory {
  current: { month: string; lines: LineSnapshot[] };
  previous: { month: string; lines: LineSnapshot[] } | null;
}

function snapshotKey(userId: string | null): string {
  return userId ? `line-select:top-lines:${userId}:v2` : "line-select:top-lines:guest:v2";
}

function read(userId: string | null): StoredHistory | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(snapshotKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredHistory;
    return parsed && typeof parsed.current?.month === "string" && Array.isArray(parsed.current.lines) ? parsed : null;
  } catch {
    return null;
  }
}

/** The top lines from the most recent bid month that isn't `month` — null when there's no earlier month yet. */
export function loadTopLinesSnapshot(userId: string | null, month: string): LineSnapshot[] | null {
  const stored = read(userId);
  if (!stored) return null;
  if (stored.current.month !== month) return stored.current.lines;
  return stored.previous && stored.previous.month !== month ? stored.previous.lines : null;
}

export function saveTopLinesSnapshot(userId: string | null, month: string, lineScores: LineScore[]): void {
  if (typeof window === "undefined") return;
  const lines: LineSnapshot[] = [...lineScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_LINES_TO_KEEP)
    .map((r) => ({
      lineNumber: r.line.lineNumber,
      score: r.score,
      dimensionValues: Object.fromEntries(r.dimensions.map((d) => [d.key, d.value])),
    }));
  const stored = read(userId);
  // A new month pushes the last one back to "previous"; the same month just refreshes itself.
  const previous = stored && stored.current.month !== month ? stored.current : (stored?.previous ?? null);
  try {
    window.localStorage.setItem(snapshotKey(userId), JSON.stringify({ current: { month, lines }, previous } satisfies StoredHistory));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) - fail silently, same as storage.ts.
  }
}
