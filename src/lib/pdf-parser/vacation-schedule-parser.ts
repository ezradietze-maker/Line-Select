import type { Seat, SweepFlight, VacationPeriod } from "@/types/bidpack";

/**
 * The pack's "Vacation Schedule by Week" pages list every vacation block in and around the bid month: week, name,
 * employee number, seniority number, days, and the Zulu start and end — two blocks to a row. Only three things are
 * kept, keyed by seniority number: the days and the two dates. The name and employee number are matched to anchor the
 * row and never captured, the same discipline as the seniority list (see seniority-list-parser.ts).
 */

const HEADER_RE = /Vacation\s+Schedule\s+by\s+Week\s*:\s*(CAP|F\s*\/\s*O|FO)/i;

/** employee # · seniority # · days · from date · time · to date · time ("4613904 4676 07 28SEP26 0630 05OCT26 0629"). */
const BLOCK_RE = /(?<![\d/])\d{4,7}\s+(\d{1,5})\s+(\d{1,3})\s+(\d{2}[A-Z]{3}\d{2})\s+(\d{4})\s+(\d{2}[A-Z]{3}\d{2})\s+(\d{4})(?!\d)/g;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "28SEP26" + "0630" → "2026-09-28T06:30:00Z"; null when the month isn't one. */
function zulu(date: string, time: string): string | null {
  const m = MONTHS.indexOf(date.slice(2, 5));
  if (m < 0) return null;
  return `20${date.slice(5, 7)}-${String(m + 1).padStart(2, "0")}-${date.slice(0, 2)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`;
}

export function extractVacationScheduleSeat(headerRows: string[]): Seat | null {
  for (const row of headerRows) {
    const m = row.match(HEADER_RE);
    if (m) return /F/i.test(m[1]) ? "FO" : "CAP";
  }
  return null;
}

export function parseVacationScheduleRows(rows: string[]): { seniority: number; period: VacationPeriod }[] {
  const out: { seniority: number; period: VacationPeriod }[] = [];
  for (const row of rows) {
    for (const m of row.matchAll(BLOCK_RE)) {
      const from = zulu(m[3], m[4]);
      const to = zulu(m[5], m[6]);
      if (from && to) out.push({ seniority: Number(m[1]), period: { from, to, days: Number(m[2]) } });
    }
  }
  return out;
}

/** "400 (OAK)": a sweep aircraft's flight number and the departure city the listing gives it. */
const SWEEP_RE = /(?<![\d:])(\d{1,4})\s*\(([A-Z]{3})\)/g;

export function parseSweepFlightRows(rows: string[]): SweepFlight[] {
  const seen = new Set<string>();
  const out: SweepFlight[] = [];
  for (const row of rows) {
    for (const m of row.matchAll(SWEEP_RE)) {
      const key = `${m[1]}-${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ flightNumber: m[1], from: m[2] });
    }
  }
  return out;
}
