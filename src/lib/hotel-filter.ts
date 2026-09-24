import type { Line } from "@/types/bidpack";

/** One specific layover hotel — the same (city, hotel) pair Hotel Ratings groups by. */
export interface HotelFilter {
  city: string;
  hotelName: string;
}

/** Whether any trip on this line has a layover at exactly this hotel. */
export function lineHasHotel(line: Line, filter: HotelFilter): boolean {
  return line.trips.some((trip) =>
    trip.layoverDetails.some((l) => l.city === filter.city && l.hotelName === filter.hotelName)
  );
}

/** Link from a Hotel Ratings card into Results, filtered to lines that stay at that hotel. */
export function hotelFilterHref(filter: HotelFilter): string {
  const params = new URLSearchParams({ hotelCity: filter.city, hotel: filter.hotelName });
  return `/results?${params.toString()}`;
}

export function parseHotelFilter(params: { get(name: string): string | null }): HotelFilter | null {
  const city = params.get("hotelCity")?.trim();
  const hotelName = params.get("hotel")?.trim();
  return city && hotelName ? { city, hotelName } : null;
}
