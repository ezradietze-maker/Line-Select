import type { HotelLookupResult } from "@/types/hotel";
import type { HotelQualityData } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";

// Module-level, so every TripList / HotelRatingsScreen instance on the page
// shares one in-flight request per (code, hotel) pair instead of each
// independently hitting the server — many lines share the same hotel for
// the same layover city.
const inFlight = new Map<string, Promise<HotelLookupResult>>();

export function fetchHotel(code: string, hotelName: string): Promise<HotelLookupResult> {
  const key = `${code.toUpperCase()}|${hotelName.toUpperCase()}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = fetch(`/api/hotels?code=${encodeURIComponent(code)}&name=${encodeURIComponent(hotelName)}`)
    .then((res) => res.json() as Promise<HotelLookupResult>)
    .catch(
      (): HotelLookupResult => ({
        code,
        hotelName,
        hotel: null,
        error: "Couldn't reach the server. Check your connection and try again.",
      })
    );
  inFlight.set(key, promise);
  return promise;
}

/**
 * Every distinct (city, hotel) pair actually assigned somewhere in this bid
 * pack, looked up once each (via the same in-flight/server cache as
 * everything else) and returned keyed exactly the way `scoring.ts` expects
 * — `"<city>|<hotel name>"`, matching `layoverDetails` verbatim rather than
 * a case-normalized form, so a lookup there can't silently miss.
 */
export async function fetchAllHotelQualityData(bidPack: BidPack): Promise<HotelQualityData> {
  const pairs = new Map<string, { code: string; hotelName: string }>();
  for (const line of bidPack.lines) {
    for (const trip of line.trips) {
      for (const layover of trip.layoverDetails) {
        if (!layover.hotelName) continue;
        pairs.set(`${layover.city}|${layover.hotelName}`, {
          code: layover.city,
          hotelName: layover.hotelName,
        });
      }
    }
  }

  const entries = await Promise.all(
    Array.from(pairs.entries()).map(async ([key, { code, hotelName }]) => {
      const result = await fetchHotel(code, hotelName);
      return [key, result.hotel] as const;
    })
  );

  const data: HotelQualityData = {};
  for (const [key, hotel] of entries) {
    if (hotel) {
      data[key] = { amenities: hotel.amenities, reviewSummary: hotel.reviewSummary, rating: hotel.rating };
    }
  }
  return data;
}
