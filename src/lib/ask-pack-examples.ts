import { cityName } from "@/lib/city-names";
import { hubTurnsOf } from "@/lib/metrics/hub-turns";
import type { BidPack } from "@/types/bidpack";

/**
 * The "Try:" questions under Ask your pack, made from this pack: its most-flown layover city, and night hub turns only
 * when the pack has them. Fixed text asked a Memphis 767 pilot about "lines with Honolulu", a city the pack never goes.
 */
export function askPackExamples(bidPack: BidPack): string[] {
  const counts = new Map<string, number>();
  for (const line of bidPack.lines)
    for (const trip of line.trips)
      for (const city of trip.layoverDetails?.length ? trip.layoverDetails.map((l) => l.city) : trip.layoverCities)
        if (city !== bidPack.base) counts.set(city, (counts.get(city) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const nightHubTurns = bidPack.lines.some((l) => hubTurnsOf(l.trips, bidPack).some((h) => h.night));
  return [
    top ? `Lines with ${cityName(top)} and no weekends worked` : "Most days off, no weekends worked",
    "Fewest commutes, at least 15 days off",
    nightHubTurns ? "No night hub turns and no three-leg duty periods" : "Longest layovers and no three-leg duty periods",
  ];
}
