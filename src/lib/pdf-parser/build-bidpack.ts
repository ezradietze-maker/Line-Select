import type { ParsedLineSummary, ParsedPairing } from "@/lib/pdf-parser/types";
import type { Line, Trip } from "@/types/bidpack";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pairingToTrip(pairing: ParsedPairing): Trip {
  return {
    id: pairing.id,
    days: pairing.days,
    layoverCities: pairing.layoverCities,
    layoverDetails: pairing.layoverDetails,
    reportTime: pairing.reportTime,
    international: pairing.international,
    deadheadLegs: pairing.deadheadLegs,
    creditHours: round2(pairing.creditHours),
    landings: pairing.landings,
    tafbHours: round2(pairing.tafbHours),
    schedule: pairing.schedule,
  };
}

/**
 * Used when a line's calendar entries couldn't be confidently matched to a
 * specific pairing. Built entirely from the line's own printed totals (all
 * real, not guessed), with neutral placeholders only for the handful of
 * fields the line summary doesn't carry (layovers, report time, deadhead
 * count, international mix). Lines that fall back to this are listed in
 * `linesWithIncompleteTrips` so the UI can be upfront about it rather than
 * presenting an estimate as verified detail.
 */
export function buildEstimatedTrip(summary: ParsedLineSummary): Trip {
  return {
    id: `estimated-${summary.lineNumber}`,
    days: Math.max(1, Math.round(summary.totalTafbHours / 24)),
    layoverCities: [],
    layoverDetails: [],
    reportTime: "afternoon",
    international: false,
    deadheadLegs: 0,
    creditHours: round2(summary.totalCreditHours),
    landings: summary.totalLandings,
    tafbHours: round2(summary.totalTafbHours),
    schedule: [],
  };
}

export function buildLine(
  summary: ParsedLineSummary,
  matchedPairings: ParsedPairing[] | null
): Line {
  const trips = matchedPairings
    ? matchedPairings.map(pairingToTrip)
    : [buildEstimatedTrip(summary)];

  return {
    id: `line-${summary.lineNumber}`,
    lineNumber: summary.lineNumber,
    trips,
    daysOff: summary.daysOff,
    totalCreditHours: round2(summary.totalCreditHours),
    totalTafbHours: round2(summary.totalTafbHours),
    totalLandings: summary.totalLandings,
    estimated: matchedPairings === null,
  };
}
