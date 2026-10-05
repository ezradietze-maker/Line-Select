import { coordinatesForAirport } from "@/lib/airport-coordinates";

/**
 * The landing globe's routes — real city pairs from real October bid packs
 * (Memphis out to Europe, Latin America and the West Coast; the Pacific
 * through Anchorage, the way that flying actually routes). Shown to a
 * visitor who hasn't uploaded anything, so they're the network's shape,
 * not anyone's own line.
 */
export const GLOBE_ROUTES: [string, string][] = [
  ["MEM", "CDG"],
  ["MEM", "ANC"],
  ["ANC", "NRT"],
  ["MEM", "BOG"],
  ["ANC", "HKG"],
  ["MEM", "OAK"],
  ["MEM", "CGN"],
  ["ANC", "ICN"],
  ["MEM", "GDL"],
  ["LAX", "HNL"],
  ["ANC", "TPE"],
  ["MEM", "SJU"],
  ["CDG", "DEL"],
  ["MEM", "MXP"],
  ["ANC", "CAN"],
  ["MEM", "LAX"],
  ["MEM", "DUB"],
  ["MEM", "MIA"],
];

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GlobeRoute {
  from: string;
  to: string;
  a: LatLon;
  b: LatLon;
  /** Great-circle distance in nautical miles. */
  nm: number;
}

const EARTH_RADIUS_NM = 3440.065;

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

/** Great-circle distance between two points, in nautical miles. */
export function greatCircleNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The routes with real coordinates attached; any pair missing a coordinate is left out rather than drawn somewhere wrong. */
export function globeRoutes(pairs: [string, string][] = GLOBE_ROUTES): GlobeRoute[] {
  return pairs.flatMap(([from, to]) => {
    const fa = coordinatesForAirport(from);
    const fb = coordinatesForAirport(to);
    if (!fa || !fb) return [];
    const a = { lat: fa[0], lon: fa[1] };
    const b = { lat: fb[0], lon: fb[1] };
    return [{ from, to, a, b, nm: greatCircleNm(a, b) }];
  });
}

/** Every distinct airport the routes touch. */
export function routeAirports(routes: GlobeRoute[]): { code: string; at: LatLon }[] {
  const seen = new Map<string, LatLon>();
  for (const r of routes) {
    seen.set(r.from, r.a);
    seen.set(r.to, r.b);
  }
  return [...seen].map(([code, at]) => ({ code, at }));
}
