import type { ParseWarning } from "@/lib/pdf-parser/types";
import type { BidPackInfo, Seat } from "@/types/bidpack";

function timeToHours(hhmm: string): number | null {
  const m = hhmm.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** Finds the row containing `labelPattern` and returns its two trailing tokens (CAP, then F/O) — the shape every single-line stat on the info page uses, e.g. "RLG: 75:45 76:15". */
function findPairedValues(rows: string[], labelPattern: RegExp): [string, string] | null {
  for (const row of rows) {
    const m = row.match(labelPattern);
    if (m) return [m[1], m[2]];
  }
  return null;
}

/** The "Total # ... Lines" stats print across two rows instead of one: the label + "CAP <n>" on one row, then "F/O <n>" on the next. */
function findSeatCounts(rows: string[], labelPattern: RegExp): [number, number] | null {
  const idx = rows.findIndex((r) => labelPattern.test(r));
  if (idx === -1) return null;
  const cap = rows[idx].match(/CAP\s+(\d+)/i);
  const fo = rows[idx + 1]?.match(/F\s*\/?\s*O\s+(\d+)/i);
  if (!cap || !fo) return null;
  return [Number(cap[1]), Number(fo[1])];
}

/**
 * Parses a bid pack's own "Bid Information" page into the per-seat summary
 * numbers it prints (RLG, R-Day value, credit range, average days off, line
 * counts) — real totals the pack states outright, not anything computed
 * from the parsed lines. A field the page didn't print in a recognized
 * format is left `null` on both seats rather than guessed at.
 */
export function parseInfoPage(
  rows: string[],
  pageNumber: number,
  warnings: ParseWarning[]
): Partial<Record<Seat, BidPackInfo>> | null {
  const rlg = findPairedValues(rows, /\bRLG:\s*(\S+)\s+(\S+)/i);
  const rDay = findPairedValues(rows, /R-Day value is:\s*(\S+)\s+(\S+)/i);
  const high = findPairedValues(rows, /High Line Credit:\s*(\S+)\s+(\S+)/i);
  const low = findPairedValues(rows, /Low Line Credit:\s*(\S+)\s+(\S+)/i);
  const avgDaysOff = findPairedValues(rows, /Average Days Off:\s*(\S+)\s+(\S+)/i);
  const regularLines = findSeatCounts(rows, /Total\s*#\s*Regular Lines:/i);
  const reserveLines = findSeatCounts(rows, /Total\s*#\s*Reserve Lines:/i);
  const secondaryLines = findSeatCounts(rows, /Total\s*#\s*Secondary Lines:/i);

  if (!rlg && !rDay && !low && !high) {
    warnings.push({
      pageNumber,
      message: "Info page found, but its RLG/credit fields didn't match the expected layout — skipped.",
    });
    return null;
  }

  const buildFor = (seatIndex: 0 | 1): BidPackInfo => ({
    rlgHours: rlg ? timeToHours(rlg[seatIndex]) : null,
    rDayValueHours: rDay ? timeToHours(rDay[seatIndex]) : null,
    lowLineCreditHours: low ? timeToHours(low[seatIndex]) : null,
    highLineCreditHours: high ? timeToHours(high[seatIndex]) : null,
    averageDaysOff: avgDaysOff ? Number(avgDaysOff[seatIndex]) : null,
    totalRegularLines: regularLines ? regularLines[seatIndex] : null,
    totalReserveLines: reserveLines ? reserveLines[seatIndex] : null,
    totalSecondaryLines: secondaryLines ? secondaryLines[seatIndex] : null,
  });

  return { CAP: buildFor(0), FO: buildFor(1) };
}
