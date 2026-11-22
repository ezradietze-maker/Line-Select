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

/**
 * The lines ⌘K may offer by number: all of them to a member; to a pilot without a membership (`rankedOnly`), only the
 * ones their snapshot holds, their top ten, and none before the rankings have been worked out. Every line was listed,
 * though picking one past the ten opened nothing.
 */
export function linesToOffer<L extends { id: string }>(lines: L[], snapshot: RankingSnapshot | null, rankedOnly: boolean): L[] {
  if (!rankedOnly) return lines;
  return snapshot ? lines.filter((l) => snapshot.byLineId.has(l.id)) : [];
}
