import { getBidPackRanges } from "@/lib/scoring";
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

  return {
    tripLength,
    reportTime,
    creditHours: { min: creditMin, max: creditMax },
    deadheadTripSharePercent,
    distinctHotelCount,
    distinctCityCount,
  };
}
