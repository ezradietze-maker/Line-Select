import type { Line } from "@/types/bidpack";

/**
 * How many lines the results list renders at first. A real bid pack has 283
 * (Captain) to 489 (First Officer) lines and each card carries a full month
 * calendar, so rendering all of them put ~76,000 nodes on the page and made
 * drag-to-reorder across it unusable — and a pilot only ever seriously works
 * the top couple dozen. The rest is one "show more" tap away.
 */
export const PAGE_SIZE = 25;

/** "1105", "line 1105", "#1105" and a partial "110" all find line 1105 — pilots think in line numbers, not ranks. */
export function matchesLineSearch(line: Line, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^(line|#)\s*/, "").replace(/^#/, "");
  if (q === "") return true;
  return line.lineNumber.toLowerCase().includes(q);
}

/** Never hides a line that's the only thing left to show — "show more" for a 3-line remainder would be silly. */
export function nextVisibleCount(current: number, total: number): number {
  return Math.min(total, current + PAGE_SIZE);
}

export interface LineMarks {
  starred: string[];
  hidden: string[];
}

export const EMPTY_MARKS: LineMarks = { starred: [], hidden: [] };

/** Starring a line un-hides it, and hiding a line un-stars it — a line can't be both "I want this" and "get this out of my sight". */
export function toggleStar(marks: LineMarks, lineId: string): LineMarks {
  const has = marks.starred.includes(lineId);
  return {
    starred: has ? marks.starred.filter((id) => id !== lineId) : [...marks.starred, lineId],
    hidden: marks.hidden.filter((id) => id !== lineId),
  };
}

export function hideLine(marks: LineMarks, lineId: string): LineMarks {
  return {
    starred: marks.starred.filter((id) => id !== lineId),
    hidden: marks.hidden.includes(lineId) ? marks.hidden : [...marks.hidden, lineId],
  };
}

export function restoreLine(marks: LineMarks, lineId: string): LineMarks {
  return { ...marks, hidden: marks.hidden.filter((id) => id !== lineId) };
}

/** Drops marks for lines that aren't in the current bid pack (a new month's pack has different line ids). */
export function pruneMarks(marks: LineMarks, validLineIds: Set<string>): LineMarks {
  return {
    starred: marks.starred.filter((id) => validLineIds.has(id)),
    hidden: marks.hidden.filter((id) => validLineIds.has(id)),
  };
}

/**
 * What Copy, Send to VIPS and the calendar take: the whole ranked order as bid, leaving out only the lines the pilot
 * hid or put in Not bid. Never the search or the filters: those are for looking, and a pilot with "9003" in the
 * search box copied that one line and was told it was cleared to bid.
 */
export function bidOrderLines<T extends { line: { id: string } }>(ranked: T[], hidden: Set<string>, notBid: Set<string>): { lines: T[]; hidden: number; notBid: number } {
  const lines: T[] = [];
  let hiddenCount = 0;
  let notBidCount = 0;
  for (const r of ranked) {
    // A hidden line in Not bid counts once, as Not bid: that's the tier the pilot put it in.
    if (notBid.has(r.line.id)) notBidCount++;
    else if (hidden.has(r.line.id)) hiddenCount++;
    else lines.push(r);
  }
  return { lines, hidden: hiddenCount, notBid: notBidCount };
}

/** "the 2 lines you hid and the Not bid line": what an export leaves out, or null when it leaves out nothing. */
export function leftOutPhrase(hidden: number, notBid: number): string | null {
  const parts = [
    hidden ? `the ${hidden === 1 ? "line" : `${hidden} lines`} you hid` : null,
    notBid ? `the ${notBid === 1 ? "Not bid line" : `${notBid} Not bid lines`}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : null;
}

/**
 * The j / k cursor, one line on. It's kept by line, not by place, so when a line moves (a tier key sends it up the
 * list) the cursor goes with it and the next key acts on that same line. A cursor whose line has left the list starts
 * again at the top.
 */
export function stepCursor(ids: string[], current: string | null, by: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return ids[0];
  return ids[Math.max(0, Math.min(ids.length - 1, at + by))];
}
