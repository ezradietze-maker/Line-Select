/**
 * Where a pack's hotels are, as far as the app has looked them up (`fetchHotel`): their street addresses, by city and
 * printed name. A pilot's feeling about an area — "a hotel over the hill in Pleasanton, Dublin or San Ramon would make
 * it much better" — is matched against the printed name, and against the address once the hotel has been looked up.
 * Kept for the visit; nothing is stored.
 */

const addresses = new Map<string, string>();

export const hotelKey = (city: string, hotel: string) => `${city.trim().toUpperCase()}|${hotel.trim().toUpperCase()}`;

export function rememberHotelAddress(city: string, hotel: string, address: string | null | undefined): void {
  if (address) addresses.set(hotelKey(city, hotel), address);
}

export function hotelAddress(city: string, hotel: string): string | null {
  return addresses.get(hotelKey(city, hotel)) ?? null;
}

/** Whether a hotel is in one of the places named: a place's words, whole, in its printed name or its address. */
export function hotelInPlaces(city: string, hotel: string, places: string[]): boolean {
  const text = `${hotel} ${hotelAddress(city, hotel) ?? ""}`.toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  return places.some((place) => {
    const words = place.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    return words.length > 0 && ` ${text} `.includes(` ${words} `);
  });
}
