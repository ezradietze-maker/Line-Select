import { splitIntoLineBlocks } from "@/lib/pdf-parser/line-grid-parser";

const LINE_RE = /LINE\s+(\d+)/;
const DATE_RANGE_RE = /\((\d{4}-\d{2}-\d{2})\s*-\s*\d{4}-\d{2}-\d{2}\)/;

export interface DayPlacement {
  pairingNumber: string;
  /** 0-indexed offset from the bid period's first printed day. */
  startDayIndex: number;
}

/**
 * Extracts the bid period's real first calendar day from a line-grid page's
 * own header, e.g. "SEP (2026-08-31 - 2026-09-27) - B767 OAK DOMICILE -
 * Captain ONLY" -> "2026-08-31". Every day-of-month column on that page is
 * counted relative to this date.
 */
export function extractBidPeriodStart(headerText: string): string | null {
  const m = headerText.match(DATE_RANGE_RE);
  return m ? m[1] : null;
}

/**
 * Splits a grid row's own day-columns into ordinal tokens, one per day
 * column — confirmed against real bid-pack line-grid pages that every row
 * (the day-of-week/day-of-month header rows and every line's own content
 * rows alike) prints exactly one ":" or "|" delimiter per day column, so
 * the Nth token in any row lines up with the Nth token in every other row
 * on the same page without needing pixel-position math. `groupIntoRows`
 * inserts an incidental space between adjacent PDF text runs, which this
 * trims away along with the delimiter itself.
 */
function splitDayTokens(row: string): string[] {
  const gridStart = row.indexOf("|");
  if (gridStart === -1) return [];
  return row
    .slice(gridStart + 1)
    .split(/[:|]/)
    .map((s) => s.trim());
}

/**
 * Reads each line's own day-off/trip-start markers straight from its
 * line-grid block. Each line prints five stacked content rows (fitting a
 * multi-duty-period trip's scattered flight numbers and city codes without
 * them colliding); the bottom of those five is the grid's own dedicated
 * placement row — a bare number is the pairing that starts on that day
 * (running for that pairing's own known `Trip.days` length), "---" marks a
 * day with no trip at all, and a blank cell continues whichever trip most
 * recently started.
 *
 * Confirmed against several real, multi-trip lines from a live bid pack:
 * the day-off count and each trip's own day-count this row implies land
 * exactly on that line's own printed DAYS OFF and pairing-schedule-derived
 * `Trip.days` figures, every time.
 */
export function extractLinePlacements(rows: string[]): Map<string, DayPlacement[]> {
  const placements = new Map<string, DayPlacement[]>();

  for (const block of splitIntoLineBlocks(rows)) {
    const lineMatch = block[0]?.match(LINE_RE);
    if (!lineMatch || block.length < 5) continue;

    const tokens = splitDayTokens(block[4]);
    const entries: DayPlacement[] = [];
    tokens.forEach((token, dayIndex) => {
      if (!token || token === "---") return;
      if (/^\d+$/.test(token)) entries.push({ pairingNumber: token, startDayIndex: dayIndex });
    });

    if (entries.length > 0) placements.set(lineMatch[1], entries);
  }

  return placements;
}
