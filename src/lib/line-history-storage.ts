import type { LineScore } from "@/lib/scoring";

/**
 * A snapshot of which lines a pilot's ranking actually favored, kept purely
 * so a future bid cycle can say "this scores similarly to lines you've
 * historically preferred" (see `historicalConsistencyNote` in `scoring.ts`)
 * — separate from `PreferenceProfile`/`storage.ts` since this describes what
 * the pilot was SHOWN and favored, not what they said in an interview.
 * Overwritten every time results are computed for a completed profile, so
 * it always reflects the most recent cycle's top lines by the time a new
 * cycle's interview starts.
 */
export interface LineSnapshot {
  lineNumber: string;
  score: number;
  /** Normalized [0,1] dimension values for every fixed/implicit dimension this line had, keyed the same way `DimensionScore.key` is — enough to compare "similar shape" against a future line without needing the original bid pack around. */
  dimensionValues: Record<string, number>;
}

const TOP_LINES_TO_KEEP = 3;

function snapshotKey(userId: string | null): string {
  return userId ? `line-select:top-lines:${userId}:v1` : "line-select:top-lines:guest:v1";
}

export function loadTopLinesSnapshot(userId: string | null): LineSnapshot[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(snapshotKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LineSnapshot[]) : null;
  } catch {
    return null;
  }
}

export function saveTopLinesSnapshot(userId: string | null, lineScores: LineScore[]): void {
  if (typeof window === "undefined") return;
  const snapshot: LineSnapshot[] = [...lineScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_LINES_TO_KEEP)
    .map((r) => ({
      lineNumber: r.line.lineNumber,
      score: r.score,
      dimensionValues: Object.fromEntries(r.dimensions.map((d) => [d.key, d.value])),
    }));
  try {
    window.localStorage.setItem(snapshotKey(userId), JSON.stringify(snapshot));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) - fail silently, same as storage.ts.
  }
}
