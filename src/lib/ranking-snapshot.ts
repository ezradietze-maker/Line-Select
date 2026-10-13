/**
 * The latest ranking the rankings screen worked out, kept for the rest of the visit so other parts of the app (the
 * ⌘K palette) can say where a line stands without ranking the whole pack again themselves.
 */
export interface RankingSnapshot {
  bidPackId: string;
  /** By line id: its place in the pilot's own order, and its score. */
  byLineId: Map<string, { rank: number; score: number }>;
}

let latest: RankingSnapshot | null = null;

export function setRankingSnapshot(snapshot: RankingSnapshot): void {
  latest = snapshot;
}

/** The snapshot for this pack, if the rankings have been worked out for it during this visit. */
export function rankingSnapshotFor(bidPackId: string): RankingSnapshot | null {
  return latest && latest.bidPackId === bidPackId ? latest : null;
}
