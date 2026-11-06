/** Where a layover hotel sits from its airport: how far, in statute miles, and which way. */

const EARTH_MI = 3958.8;
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

export interface HotelPosition {
  miles: number;
  /** Degrees clockwise from true north, 0–360. */
  bearing: number;
  /** One of the eight compass points, e.g. "northwest". */
  direction: (typeof COMPASS)[number];
}

const rad = (d: number) => (d * Math.PI) / 180;

export function hotelPosition(airport: [number, number], hotel: { latitude: number; longitude: number }): HotelPosition {
  const [lat1, lon1] = [rad(airport[0]), rad(airport[1])];
  const [lat2, lon2] = [rad(hotel.latitude), rad(hotel.longitude)];
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  const miles = 2 * EARTH_MI * Math.asin(Math.sqrt(h));
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { miles, bearing, direction: COMPASS[Math.round(bearing / 45) % 8] };
}

/** The outer range ring for a map that shows the hotel comfortably inside it. */
export function rangeRingMiles(miles: number): number {
  return [2, 5, 10, 20, 40, 80].find((r) => r >= miles * 1.15) ?? Math.ceil((miles * 1.15) / 50) * 50;
}
