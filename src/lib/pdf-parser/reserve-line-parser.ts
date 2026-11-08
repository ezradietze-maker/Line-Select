import type { PositionedItem } from "@/lib/pdf-parser/text-extraction";
import type { ParseWarning } from "@/lib/pdf-parser/types";
import type { ReserveLine, Seat } from "@/types/bidpack";

const HEADER_SEAT_RE = /Reserve\s+Lines\s*:\s*(CAP|F\s*\/\s*O)/i;

/**
 * A reserve line's own row, e.g. `7014 |A A|A A A A A|A A|A A A A A|A |`. Lines sharing one schedule print on one row
 * as a range with no space before the grid: `7019-20|A A A A | |…` is lines 7019 and 7020.
 */
const ROW_RE = /^(\d{3,5})(?:-(\d{1,5}))?\s*(\|.*)$/;
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

/** "7019", "20" → 7019 and 7020; "7099", "101" → 7099, 7100 and 7101. A range that doesn't read as one is just its first line. */
function lineNumbersInRange(first: string, last: string | undefined): string[] {
  if (!last) return [first];
  const from = Number(first);
  const to = Number(first.slice(0, Math.max(0, first.length - last.length)) + last);
  if (!(to > from) || to - from > 100) return [first];
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
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
    const [, first, last, rest] = m;
    if (!SAFE_GRID_CHARS_RE.test(rest)) continue;

    const letters = new Set(rest.match(/[RAB]/g) ?? []);
    let reserveType: ReserveLine["reserveType"] = null;
    if (letters.size === 1) {
      const [only] = letters;
      reserveType = only === "R" ? "24hr" : only === "A" ? "a" : "b";
    }
    for (const lineNumber of lineNumbersInRange(first, last)) results.push({ lineNumber, reserveType });
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

/** The grid prints a day every 13.5 points, each day's letter one 6.75-point character in from its column's edge. */
const DAY_PITCH = 13.5;
const CHAR_PITCH = 6.75;

/**
 * Which days each reserve line stands, read by position: `groupIntoRows` closes up the blank days, so only where a
 * letter sits on the page says which day it's on. Day 0 is the first day the header prints, which is the bid period's
 * first day; days past the period are the pack's "Carry-Over" columns. A row the text parser would refuse is skipped
 * here too, and a page with no header row to measure from reads as nothing.
 */
export function parseReserveLineDays(items: PositionedItem[]): Map<string, number[]> {
  const days = new Map<string, number[]>();
  const header = items.find((i) => /^\|\d{2} \d{2}/.test(i.str));
  if (!header) return days;
  const firstDayX = header.x + CHAR_PITCH;

  const rows = new Map<number, PositionedItem[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const key = Math.round(it.y / 2) * 2;
    rows.set(key, [...(rows.get(key) ?? []), it]);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    const m = row[0].str.match(/^(\d{3,5})(?:-(\d{1,5}))?(\|.*)?$/);
    if (!m) continue;
    if (!SAFE_GRID_CHARS_RE.test([m[3] ?? "", ...row.slice(1).map((i) => i.str)].join(" "))) continue;
    // A line number's own width varies; the grid's first pipe is always at the header's.
    const cells: PositionedItem[] = [...(m[3] ? [{ ...row[0], str: m[3], x: header.x }] : []), ...row.slice(1)];
    const onCall = new Set<number>();
    for (const cell of cells) {
      [...cell.str].forEach((ch, i) => {
        if (/[RAB]/.test(ch)) onCall.add(Math.round((cell.x + i * CHAR_PITCH - firstDayX) / DAY_PITCH));
      });
    }
    const sorted = [...onCall].filter((d) => d >= 0).sort((a, b) => a - b);
    for (const n of lineNumbersInRange(m[1], m[2])) days.set(n, sorted);
  }
  return days;
}
