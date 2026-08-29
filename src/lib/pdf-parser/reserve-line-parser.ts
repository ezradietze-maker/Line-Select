import type { ParseWarning } from "@/lib/pdf-parser/types";
import type { ReserveLine, Seat } from "@/types/bidpack";

const HEADER_SEAT_RE = /Reserve\s+Lines\s*:\s*(CAP|F\s*\/\s*O)/i;

/** A reserve line's own row, e.g. `7014 |A A|A A A A A|A A|A A A A A|A |`. */
const ROW_RE = /^(\d{3,5})\s+(.*)$/;
/**
 * Anything outside this character class fails the row closed rather than
 * being partially trusted — the one thing this parser must never do is
 * carry a name or employee number through on a differently-formatted bid
 * pack whose "Reserve Lines" page happens to also print who's on each line.
 */
const SAFE_GRID_CHARS_RE = /^[\sRAB|]*$/;

export function extractReserveLineSeat(headerRows: string[]): Seat | null {
  for (const row of headerRows) {
    const m = row.match(HEADER_SEAT_RE);
    if (m) return m[1].toUpperCase().replace(/\s+/g, "").includes("F") ? "FO" : "CAP";
  }
  return null;
}

/**
 * Parses one Reserve Lines grid page into line-number + on-call-type pairs
 * only. Never returns anything for a row that doesn't fit the pure
 * digits-then-R/A/B-grid shape real reserve line rows have — see
 * `SAFE_GRID_CHARS_RE`.
 */
export function parseReserveLineGridRows(
  rows: string[],
  pageNumber: number,
  warnings: ParseWarning[]
): ReserveLine[] {
  const results: ReserveLine[] = [];

  for (const row of rows) {
    const m = row.match(ROW_RE);
    if (!m) continue;
    const [, lineNumber, rest] = m;
    if (!SAFE_GRID_CHARS_RE.test(rest)) continue;

    const letters = new Set(rest.match(/[RAB]/g) ?? []);
    let reserveType: ReserveLine["reserveType"] = null;
    if (letters.size === 1) {
      const [only] = letters;
      reserveType = only === "R" ? "24hr" : only === "A" ? "a" : "b";
    }
    results.push({ lineNumber, reserveType });
  }

  if (results.length === 0) {
    warnings.push({
      pageNumber,
      message:
        "This Reserve Lines page didn't match the expected line-number + R/A/B grid format, so it was skipped.",
    });
  }

  return results;
}
