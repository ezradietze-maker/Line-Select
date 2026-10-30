import { DateTime } from "luxon";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { timezoneForAirport } from "@/lib/airport-timezones";

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

/** Unit vector for a [latitude, longitude] in degrees. */
function vector([lat, lon]: [number, number]): [number, number, number] {
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

/** Longitude (degrees) of the point a fraction `t` of the way along the great circle from `a` to `b`. */
function longitudeAlong(a: [number, number, number], b: [number, number, number], t: number): number {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const ω = Math.acos(dot);
  const s = Math.sin(ω);
  const [wa, wb] = s < 1e-9 ? [1 - t, t] : [Math.sin((1 - t) * ω) / s, Math.sin(t * ω) / s];
  const p = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
  return (Math.atan2(p[1], p[0]) * 180) / Math.PI;
}

/**
 * How far along the flight (0–1 of the way, along the great circle) it crosses 180° — where the date line is drawn
 * on its bar. Null when it doesn't cross, or an airport's place isn't known.
 */
export function dateLineFraction(from: string, to: string): number | null {
  if (!dateLineCrossing(from, to)) return null;
  const a = vector(coordinatesForAirport(from)!);
  const b = vector(coordinatesForAirport(to)!);
  // Walk the route until the longitude flips sign across 180°, then close in on the spot.
  const steps = 200;
  let prev = longitudeAlong(a, b, 0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const lon = longitudeAlong(a, b, t);
    if (Math.abs(lon - prev) > 180) {
      let lo = (i - 1) / steps;
      let hi = t;
      for (let k = 0; k < 20; k++) {
        const m = (lo + hi) / 2;
        if (Math.abs(longitudeAlong(a, b, m) - prev) > 180) hi = m;
        else lo = m;
      }
      return (lo + hi) / 2;
    }
    prev = lon;
  }
  return null;
}

/**
 * A flight across the date line as the ex-pilot reckons it: which way, the moment it crosses 180° (Zulu), and how far
 * the local clock jumps there — the arrival city's UTC offset less the departure city's, at those moments (+17h
 * Anchorage to Seoul in October, −17h back). On the local calendar the flight is its real length in bold and the
 * jump a squiggle; the two together carry it from its local takeoff to its local landing.
 */
export interface DateLinePass {
  direction: DateLineDirection;
  crossesAt: string;
  jumpMinutes: number;
}

export function dateLinePass(from: string, to: string, zuluStart: string, zuluEnd: string): DateLinePass | null {
  const direction = dateLineCrossing(from, to);
  const fraction = dateLineFraction(from, to);
  const fromZone = timezoneForAirport(from);
  const toZone = timezoneForAirport(to);
  if (!direction || fraction === null || !fromZone || !toZone) return null;
  const start = DateTime.fromISO(zuluStart, { zone: "utc" });
  const end = DateTime.fromISO(zuluEnd, { zone: "utc" });
  if (!start.isValid || !end.isValid) return null;
  const crossesAt = start.plus({ milliseconds: (end.toMillis() - start.toMillis()) * fraction }).toISO()!;
  return { direction, crossesAt, jumpMinutes: end.setZone(toZone).offset - start.setZone(fromZone).offset };
}
