import type { ScheduledFlight } from "@/lib/flights/itineraries";
import { travelKey, tripStartUtc } from "@/lib/flights/needs";
import type { BidPack, TripLeg } from "@/types/bidpack";

/**
 * The company's own flights, read from the bid pack: every FedEx leg any
 * line in it flies, placed on its real date and time. A commuting FedEx
 * pilot can ride these on the jumpseat — home straight to base, an airline
 * flight to a FedEx gateway and the jumpseat from there, or the same home —
 * so they count as ways to get to work and home alongside the airlines.
 *
 * Only the pack's own flying is known (one base and fleet), so these are the
 * jumpseat options this pack shows, not all of FedEx's.
 */

/** A FedEx-operated flight: a numeric flight number (airline deadheads print "DL0377", ground moves "GT9999"), not standby. */
export function isCompanyFlight(leg: TripLeg): boolean {
  return !leg.isStandby && /^\d+$/.test(leg.flightNumber) && leg.equipment !== "CAB";
}

/** Every distinct FedEx flight in the pack, with real times — one entry per departure however many lines fly it. */
export function jumpseatFlights(bidPack: BidPack): ScheduledFlight[] {
  const byDeparture = new Map<string, ScheduledFlight>();
  const seenTrips = new Set<string>();
  for (const line of bidPack.lines) {
    if (line.estimated) continue;
    for (const trip of line.trips) {
      if (seenTrips.has(travelKey(trip))) continue;
      seenTrips.add(travelKey(trip));
      const start = tripStartUtc(bidPack, trip);
      if (start === null) continue;
      for (const duty of trip.schedule)
        for (const leg of duty.legs) {
          if (!isCompanyFlight(leg) || leg.endMinutes <= leg.startMinutes) continue;
          const f: ScheduledFlight = {
            n: `FX ${Number(leg.flightNumber)}`,
            from: leg.depAirport,
            to: leg.arrAirport,
            dep: start + leg.startMinutes * 60_000,
            arr: start + leg.endMinutes * 60_000,
            jumpseat: true,
          };
          byDeparture.set(`${f.from}|${f.to}|${f.dep}`, f);
        }
    }
  }
  return [...byDeparture.values()].sort((a, b) => a.dep - b.dep);
}
