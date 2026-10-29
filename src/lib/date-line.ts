import { coordinatesForAirport } from "@/lib/airport-coordinates";

/**
 * Whether a leg crosses the international date line, and which way: its shortest path between the two airports runs
 * across 180° longitude. Eastbound (Asia to Alaska or the US — Shanghai to Memphis, Narita to Anchorage), the pilot
 * lands on the same date they left, or the one before: they live that date twice. Westbound (Anchorage to Seoul) they
 * skip one. A long flight that only crosses time zones (Paris to Memphis) is neither. Null when either airport's place
 * isn't known.
 */
export type DateLineDirection = "east" | "west";

export function dateLineCrossing(from: string, to: string): DateLineDirection | null {
  const a = coordinatesForAirport(from);
  const b = coordinatesForAirport(to);
  if (!a || !b) return null;
  const span = b[1] - a[1];
  if (Math.abs(span) <= 180) return null;
  // The short way round goes over 180°: from the eastern hemisphere's far side to the west's, that's heading east.
  return span < 0 ? "east" : "west";
}
