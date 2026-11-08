import { AWARD_BANDS, awardBandOf, MIN_SHARED_PILOTS } from "@/lib/award-history";
import type { AwardBand, AwardSummaryResponse, HeldByEntry } from "@/types/award-history";

/**
 * The only way shared awards reach anyone else. Single rows stay on the server: other pilots get group numbers, held
 * back until enough different pilots stand behind them, and "held by" only from pilots who agreed to show it.
 */

/** One stored report, as much of it as these numbers need. The hash is for counting different pilots and never leaves this file's results. */
export interface AwardRow {
  pilotHash: string | null;
  seniorityRank: number;
  seniorityTotalPilots: number;
  outcome: string;
  lineNumber: string | null;
  daysOff: number | null;
  totalCreditHours: number | null;
  holderShown: boolean;
}

/** How many different pilots are behind these rows: one pilot over many months is still one pilot. A row with no hash can't be matched to any other, so it counts alone. */
export function distinctPilots(rows: Pick<AwardRow, "pilotHash">[]): number {
  return new Set(rows.map((r, i) => r.pilotHash ?? `row-${i}`)).size;
}

function average(values: (number | null)[], decimals: number): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  const factor = 10 ** decimals;
  return Math.round((known.reduce((a, b) => a + b, 0) / known.length) * factor) / factor;
}

/** Group numbers per slice of the list. A slice short of `MIN_SHARED_PILOTS` says only how many reports it has. */
export function summarizeBands(rows: AwardRow[]): AwardSummaryResponse {
  const bands: AwardBand[] = Array.from({ length: AWARD_BANDS }, (_, band) => {
    const inBand = rows.filter((r) => awardBandOf({ rank: r.seniorityRank, totalPilots: r.seniorityTotalPilots }) === band);
    const lines = inBand.filter((r) => r.outcome === "line");
    const enoughLines = distinctPilots(lines) >= MIN_SHARED_PILOTS;
    return {
      reports: inBand.length,
      avgDaysOff: enoughLines ? average(lines.map((r) => r.daysOff), 1) : null,
      avgCreditHours: enoughLines ? average(lines.map((r) => r.totalCreditHours), 1) : null,
      lineRate: distinctPilots(inBand) >= MIN_SHARED_PILOTS ? Math.round((lines.length / inBand.length) * 100) / 100 : null,
    };
  });
  return { totalReports: rows.length, bands };
}

/**
 * The lines we can truly say who held, from one pack's rows. Reports are self-reported: a line can only have one
 * holder and a place on the list only one pilot, so when two reports claim the same either way, neither is believed.
 */
export function trustedHolders<T extends Pick<AwardRow, "seniorityRank" | "outcome" | "lineNumber" | "holderShown">>(rows: T[]): (T & { lineNumber: string })[] {
  const shown = rows.filter((r): r is T & { lineNumber: string } => r.holderShown && r.outcome === "line" && !!r.lineNumber);
  const lines = new Map<string, number>();
  const places = new Map<number, number>();
  for (const r of shown) {
    lines.set(r.lineNumber, (lines.get(r.lineNumber) ?? 0) + 1);
    places.set(r.seniorityRank, (places.get(r.seniorityRank) ?? 0) + 1);
  }
  return shown.filter((r) => lines.get(r.lineNumber) === 1 && places.get(r.seniorityRank) === 1);
}

/** Who held what for one pack: nothing at all until `MIN_SHARED_PILOTS` different pilots have agreed to show it. */
export function heldByFrom(rows: AwardRow[]): HeldByEntry[] {
  const holders = trustedHolders(rows);
  if (distinctPilots(holders) < MIN_SHARED_PILOTS) return [];
  return holders.map((r) => ({ lineNumber: r.lineNumber, bidPosition: r.seniorityRank })).sort((a, b) => a.bidPosition - b.bidPosition);
}
