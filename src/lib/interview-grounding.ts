import { getBidPackRanges } from "@/lib/scoring";
import { STANDBY_CREDIT_PER_DAY, tripStandbyDays } from "@/lib/standby";
import type { BidPack } from "@/types/bidpack";
import type { BidPackGroundingStats } from "@/types/interview-session";

/**
 * Real numbers pulled straight from a pilot's own bid pack — extracted from
 * what was originally `Interview.tsx`'s own inline `sliderExtraFor` stat
 * computations (shown as `<StatCallout>`s under several sliders) so both
 * the legacy static interview UI and the adaptive turn-loop's system prompt
 * ground their questions in the same real computation instead of
 * duplicating this logic. Estimated lines are excluded throughout — their
 * trip shape is a guess, not a verified fact worth quoting to a pilot or
 * feeding to the interview LLM as if it were confirmed.
 */
export function computeBidPackGroundingStats(bidPack: BidPack): BidPackGroundingStats {
  const verifiedLines = bidPack.lines.filter((l) => !l.estimated);
  const verifiedTrips = verifiedLines.flatMap((l) => l.trips);

  const days = verifiedTrips.map((t) => t.days);
  const tripLength = days.length > 0 ? { min: Math.min(...days), max: Math.max(...days) } : null;

  const reportTimes = verifiedTrips
    .flatMap((t) => (t.schedule[0] ? [t.schedule[0].reportTimeLocal] : []))
    .sort();
  const reportTime =
    reportTimes.length > 0
      ? { earliest: reportTimes[0], latest: reportTimes[reportTimes.length - 1] }
      : null;

  const deadheadTripSharePercent =
    verifiedTrips.length > 0
      ? Math.round((verifiedTrips.filter((t) => t.deadheadLegs > 0).length / verifiedTrips.length) * 100)
      : null;

  const distinctHotelCount = new Set(
    bidPack.lines
      .flatMap((l) => l.trips)
      .flatMap((t) => t.layoverDetails)
      .map((d) => d.hotelName)
      .filter((n): n is string => !!n)
  ).size;

  const distinctCityCount = new Set(bidPack.lines.flatMap((l) => l.trips).flatMap((t) => t.layoverCities)).size;

  const [creditMin, creditMax] = getBidPackRanges(bidPack).creditHours;

  const landingsValues = bidPack.lines.map((l) => l.totalLandings);
  const landings =
    landingsValues.length > 0
      ? { min: Math.min(...landingsValues), max: Math.max(...landingsValues) }
      : { min: 0, max: 0 };

  const standbyByLine = verifiedLines.map((l) => l.trips.map(tripStandbyDays));
  const linesWithStandby = standbyByLine.filter((days) => days.some((d) => d > 0)).length;
  const hotelStandby = {
    linesWithStandby,
    verifiedLines: verifiedLines.length,
    maxDaysOnALine: Math.max(0, ...standbyByLine.map((days) => days.reduce((a, b) => a + b, 0))),
    longestStretchDays: Math.max(0, ...standbyByLine.flat()),
    maxStintsOnALine: Math.max(0, ...standbyByLine.map((days) => days.filter((d) => d > 0).length)),
    creditHoursPerStandbyDay: STANDBY_CREDIT_PER_DAY,
  };

  const reserveLines =
    bidPack.reserveLines && bidPack.reserveLines.length > 0
      ? {
          count: bidPack.reserveLines.length,
          typeBreakdown: bidPack.reserveLines.reduce<Partial<Record<"24hr" | "a" | "b", number>>>((acc, r) => {
            if (r.reserveType) acc[r.reserveType] = (acc[r.reserveType] ?? 0) + 1;
            return acc;
          }, {}),
        }
      : null;

  return {
    tripLength,
    reportTime,
    creditHours: { min: creditMin, max: creditMax },
    deadheadTripSharePercent,
    distinctHotelCount,
    distinctCityCount,
    landings,
    hotelStandby,
    reserveLines,
  };
}
