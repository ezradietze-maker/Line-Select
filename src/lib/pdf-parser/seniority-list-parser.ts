import type { ParseWarning } from "@/lib/pdf-parser/types";
import type { Seat, SeniorityEntry } from "@/types/bidpack";

/**
 * The bid pack's "Bid Seniority List" pages print, for every pilot who can bid
 * this seat, a bid-order position, a seniority number, an employee number, a
 * name and a few status columns — two pilots to a row. The forecast needs
 * exactly two of those numbers: where each pilot sits in bid order and their
 * seniority number, so it knows how many pilots bid ahead of any given one.
 *
 * Nothing else is kept. The employee number and the name are matched only so
 * the row can be told apart from other text, and are never read into a
 * variable that survives the loop — the returned entries have two numeric
 * fields and no others. A page or row that doesn't fit the expected shape
 * yields nothing rather than being partially trusted.
 */

const HEADER_RE = /Bid\s+Seniority\s+List\s*:\s*(CAP|F\s*\/\s*O|FO)/i;

/**
 * bid # · seniority # · employee # · then a name starting with a letter. The
 * employee number is required to anchor the match (it's the 4-7 digit run
 * between the seniority number and the name) but its digits are not captured.
 */
const ENTRY_RE = /(?<![\d/])(\d{1,4})\s+(\d{1,5})\s+\d{4,7}(?=\s+[A-Za-z])/g;

export function extractSeniorityListSeat(headerRows: string[]): Seat | null {
  for (const row of headerRows) {
    const m = row.match(HEADER_RE);
    if (m) return /F/i.test(m[1]) ? "FO" : "CAP";
  }
  return null;
}

export function parseSeniorityListRows(rows: string[]): SeniorityEntry[] {
  const entries: SeniorityEntry[] = [];
  for (const row of rows) {
    for (const m of row.matchAll(ENTRY_RE)) {
      entries.push({ bidNumber: Number(m[1]), seniority: Number(m[2]) });
    }
  }
  return entries;
}

/**
 * Whether a seat's entries, gathered from every page of its list, look like
 * the real list: each bid position once, running 1..N with at most a couple
 * of unreadable rows, and seniority numbers strictly rising with bid position.
 * Anything else is dropped (with a warning) — a list with holes or shuffled
 * order would give the forecast the wrong number of pilots ahead of someone.
 */
export function validateSeniorityList(
  entries: SeniorityEntry[],
  seat: Seat,
  warnings: ParseWarning[]
): SeniorityEntry[] | null {
  if (entries.length === 0) return null;
  const byBid = new Map<number, number>();
  for (const e of entries) {
    if (byBid.has(e.bidNumber) && byBid.get(e.bidNumber) !== e.seniority) {
      warnings.push({ pageNumber: 0, message: `The ${seat} seniority list repeats a bid position with different numbers, so it was ignored.` });
      return null;
    }
    byBid.set(e.bidNumber, e.seniority);
  }
  const sorted = Array.from(byBid.entries()).sort((a, b) => a[0] - b[0]);
  const highest = sorted[sorted.length - 1][0];
  const missing = highest - sorted.length;
  const rising = sorted.every(([, s], i) => i === 0 || s > sorted[i - 1][1]);
  if (!rising || sorted[0][0] !== 1 || missing > Math.max(2, Math.floor(highest * 0.01))) {
    warnings.push({
      pageNumber: 0,
      message: `The ${seat} seniority list didn't read cleanly (${sorted.length} of ${highest} positions, ${rising ? "in order" : "out of order"}), so it was ignored.`,
    });
    return null;
  }
  return sorted.map(([bidNumber, seniority]) => ({ bidNumber, seniority }));
}
