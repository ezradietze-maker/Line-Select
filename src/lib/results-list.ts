import type { LineScore } from "@/lib/scoring";
import type { Line } from "@/types/bidpack";

/**
 * How many lines the results list renders at first. A real bid pack has 283
 * (Captain) to 489 (First Officer) lines and each card carries a full month
 * calendar, so rendering all of them put ~76,000 nodes on the page and made
 * drag-to-reorder across it unusable — and a pilot only ever seriously works
 * the top couple dozen. The rest is one "show more" tap away.
 */
export const PAGE_SIZE = 25;

export type SortMode = "match" | "daysOff" | "credit" | "departures" | "lineNumber";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "match", label: "Best match" },
  { value: "daysOff", label: "Most days off" },
  { value: "credit", label: "Highest credit" },
  { value: "departures", label: "Fewest departures" },
  { value: "lineNumber", label: "Line number" },
];

function byLineNumber(a: LineScore, b: LineScore): number {
  return a.line.lineNumber.localeCompare(b.line.lineNumber, undefined, { numeric: true });
}

/** A new array in the requested order. "match" keeps the incoming order, which callers pass in already ranked by score. Every other mode breaks ties by score, then line number, so equal lines never shuffle between renders. */
export function sortLineScores(list: LineScore[], mode: SortMode): LineScore[] {
  if (mode === "match") return list;
  const tieBreak = (a: LineScore, b: LineScore) => b.score - a.score || byLineNumber(a, b);
  const sorted = [...list];
  switch (mode) {
    case "daysOff":
      return sorted.sort((a, b) => b.line.daysOff - a.line.daysOff || tieBreak(a, b));
    case "credit":
      return sorted.sort((a, b) => b.line.totalCreditHours - a.line.totalCreditHours || tieBreak(a, b));
    case "departures":
      return sorted.sort((a, b) => a.line.totalDepartures - b.line.totalDepartures || tieBreak(a, b));
    case "lineNumber":
      return sorted.sort(byLineNumber);
  }
}

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
