/**
 * What one pilot has actually held, month after month — their own record,
 * read back to them (and only them) so "what can I really hold?" is
 * answered with their own history alongside the forecast. Built from the
 * awards they report; linked across months by a one-way hash of their
 * account, never their name.
 */

export interface HoldRecord {
  month: string;
  base: string;
  aircraft: string;
  seat: string;
  /** 1 = most senior, 0 = most junior, at the time. */
  percentile: number | null;
  outcome: "line" | "reserve" | "other";
  /** Which of their own choices they were awarded (1 = their first), when they told us their ranking. */
  awardedChoice: number | null;
  daysOff: number | null;
  creditHours: number | null;
  submittedAt: string;
}

export interface HoldHistorySummary {
  months: number;
  lineMonths: number;
  reserveMonths: number;
  /** Middle of the choices they were awarded, and the spread, over months that recorded it. */
  typicalChoice: number | null;
  choiceRange: { best: number; worst: number } | null;
  /** Their seniority at the latest month versus the earliest — how far up the list they've moved. */
  seniorityTrend: { from: number; to: number } | null;
  /** Newest first. */
  records: HoldRecord[];
  /** A plain sentence for the screen. */
  headline: string;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "OCT26" -> a sortable number; anything unrecognized sorts by when it was reported instead. */
export function monthOrdinal(month: string): number | null {
  const m = /^([A-Z]{3})\s*'?(\d{2,4})$/i.exec(month.trim());
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].toUpperCase());
  if (idx === -1) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return year * 12 + idx;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarizeHoldHistory(records: HoldRecord[]): HoldHistorySummary {
  const sorted = [...records].sort((a, b) => {
    const x = monthOrdinal(a.month);
    const y = monthOrdinal(b.month);
    if (x !== null && y !== null && x !== y) return y - x;
    return b.submittedAt.localeCompare(a.submittedAt);
  });
  // One record per month (a re-report replaces an earlier one).
  const seen = new Set<string>();
  const byMonth = sorted.filter((r) => {
    const key = `${r.month}|${r.base}|${r.aircraft}|${r.seat}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const choices = byMonth.map((r) => r.awardedChoice).filter((c): c is number => typeof c === "number" && c > 0);
  const percentiles = byMonth.map((r) => r.percentile).filter((p): p is number => typeof p === "number");
  const lineMonths = byMonth.filter((r) => r.outcome === "line").length;
  const reserveMonths = byMonth.filter((r) => r.outcome === "reserve").length;
  const typicalChoice = choices.length ? Math.round(median(choices)) : null;

  let headline: string;
  if (byMonth.length === 0) headline = "No awards reported yet — report what you held after each bid, and this becomes your own record.";
  else if (typicalChoice !== null)
    headline = `Over ${byMonth.length} reported month${byMonth.length === 1 ? "" : "s"}, you've usually been awarded around your #${typicalChoice} choice${reserveMonths ? `, with ${reserveMonths} month${reserveMonths === 1 ? "" : "s"} on reserve` : ""}.`;
  else headline = `${byMonth.length} month${byMonth.length === 1 ? "" : "s"} reported: ${lineMonths} on a line${reserveMonths ? `, ${reserveMonths} on reserve` : ""}.`;

  return {
    months: byMonth.length,
    lineMonths,
    reserveMonths,
    typicalChoice,
    choiceRange: choices.length ? { best: Math.min(...choices), worst: Math.max(...choices) } : null,
    seniorityTrend: percentiles.length >= 2 ? { from: percentiles[percentiles.length - 1], to: percentiles[0] } : null,
    records: byMonth,
    headline,
  };
}
