import type { LineScore } from "@/lib/scoring";

/**
 * One bid period's ranking, kept so a later, genuinely different bid month
 * can say "here's what changed since last time" — distinct from
 * `line-history-storage.ts`'s snapshot, which is overwritten continuously
 * within the SAME bid period (it exists to track "historically preferred
 * shape," not "which month this was"). This is keyed by the bid pack's own
 * `month` string specifically so refining preferences within one month
 * never gets mistaken for a new bid period.
 */
export interface BidPeriodSnapshot {
  month: string;
  savedAt: string;
  ranked: { lineNumber: string; rank: number; score: number }[];
}

const MAX_SNAPSHOTS = 6;
const TOP_N = 10;

function historyKey(userId: string | null): string {
  return userId ? `line-select:bid-period-history:${userId}:v1` : "line-select:bid-period-history:guest:v1";
}

function loadHistory(userId: string | null): BidPeriodSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(historyKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as BidPeriodSnapshot[]) : [];
  } catch {
    return [];
  }
}

/** The most recently saved snapshot from a bid month other than `currentMonth` — null when there isn't one yet (first time here, or everything on record so far is this same month). */
export function loadPreviousPeriodSnapshot(userId: string | null, currentMonth: string): BidPeriodSnapshot | null {
  const prior = loadHistory(userId)
    .filter((s) => s.month !== currentMonth)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return prior[0] ?? null;
}

/**
 * Replaces this month's own entry rather than appending to it — refining
 * preferences within the same bid period should update that month's
 * record, not pile up duplicate entries for it. Keeps up to
 * `MAX_SNAPSHOTS` distinct months, oldest dropped first.
 */
export function saveBidPeriodSnapshot(userId: string | null, month: string, lineScores: LineScore[]): void {
  if (typeof window === "undefined") return;
  const others = loadHistory(userId).filter((s) => s.month !== month);
  const ranked = [...lineScores].sort((a, b) => b.score - a.score);
  const entry: BidPeriodSnapshot = {
    month,
    savedAt: new Date().toISOString(),
    ranked: ranked.slice(0, TOP_N).map((r, i) => ({ lineNumber: r.line.lineNumber, rank: i + 1, score: Math.round(r.score) })),
  };
  const next = [entry, ...others]
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, MAX_SNAPSHOTS);
  try {
    window.localStorage.setItem(historyKey(userId), JSON.stringify(next));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) - fail silently, same as the rest of this storage family.
  }
}

export interface BidPeriodChangeSummary {
  previousMonth: string;
  currentTopLine: string;
  currentTopScore: number;
  previousTopLine: string;
  previousTopScore: number;
  sameTopLine: boolean;
  /** This period's rank of what was the top line last period — null when that line isn't in this bid pack at all (retired, or the pack genuinely changed shape), never guessed at. */
  previousTopLineNowRank: number | null;
}

/** Null when there's nothing real to compare — no previous-period snapshot, or either side has no ranked lines at all. */
export function summarizeBidPeriodChange(
  previous: BidPeriodSnapshot | null,
  currentRanked: LineScore[]
): BidPeriodChangeSummary | null {
  if (!previous || previous.ranked.length === 0 || currentRanked.length === 0) return null;
  const sorted = [...currentRanked].sort((a, b) => b.score - a.score);
  const currentTop = sorted[0];
  const previousTop = previous.ranked[0];
  const previousTopNowIndex = sorted.findIndex((r) => r.line.lineNumber === previousTop.lineNumber);
  return {
    previousMonth: previous.month,
    currentTopLine: currentTop.line.lineNumber,
    currentTopScore: Math.round(currentTop.score),
    previousTopLine: previousTop.lineNumber,
    previousTopScore: previousTop.score,
    sameTopLine: currentTop.line.lineNumber === previousTop.lineNumber,
    previousTopLineNowRank: previousTopNowIndex === -1 ? null : previousTopNowIndex + 1,
  };
}
