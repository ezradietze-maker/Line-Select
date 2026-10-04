import { coordinatesForAirport } from "@/lib/airport-coordinates";
import type { Line } from "@/types/bidpack";

const WIDTH = 520;
const HEIGHT = 300;
const PAD = 36;

/** The real-world short way around, so a route crossing the date line (MEM to NRT goes over the North Pacific, not back through Europe) projects in the geographically correct direction instead of the long way around a naive linear longitude axis. */
function shortestLonDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

interface Point {
  code: string;
  lat: number;
  /** Longitude "unwrapped" relative to the home base, via `shortestLonDelta` — not a real absolute longitude, but what makes a bounding-box fit and a straight connecting line both point the real direction. */
  lon: number;
}

function buildPoints(homeBase: string, cities: string[]): Point[] | null {
  const home = coordinatesForAirport(homeBase);
  if (!home) return null;
  const [homeLat, homeLon] = home;
  const points: Point[] = [{ code: homeBase, lat: homeLat, lon: homeLon }];
  for (const code of cities) {
    const coords = coordinatesForAirport(code);
    if (!coords) continue;
    const [lat, lon] = coords;
    points.push({ code, lat, lon: homeLon + shortestLonDelta(homeLon, lon) });
  }
  return points;
}

function project(p: Point, bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }): [number, number] {
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 1);
  const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 1);
  const x = PAD + ((p.lon - bounds.minLon) / lonSpan) * (WIDTH - PAD * 2);
  // Latitude increases northward, SVG y increases downward — flip.
  const y = PAD + (1 - (p.lat - bounds.minLat) / latSpan) * (HEIGHT - PAD * 2);
  return [x, y];
}

/** Real 30°-spaced graticule lines (equator, tropics, standard meridians) — a real-geography reference grid, not arbitrary decoration, and one a pilot already reads nav charts in. */
function Graticule({ bounds }: { bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } }) {
  const lats: number[] = [];
  for (let lat = -60; lat <= 60; lat += 30) if (lat > bounds.minLat - 30 && lat < bounds.maxLat + 30) lats.push(lat);
  const lons: number[] = [];
  const startLon = Math.floor(bounds.minLon / 30) * 30;
  for (let lon = startLon; lon <= bounds.maxLon + 30; lon += 30) lons.push(lon);

  return (
    <g stroke="var(--color-border)" strokeWidth={1} opacity={0.6}>
      {lats.map((lat) => {
        const [, y1] = project({ code: "", lat, lon: bounds.minLon }, bounds);
        return <line key={`lat${lat}`} x1={0} y1={y1} x2={WIDTH} y2={y1} />;
      })}
      {lons.map((lon) => {
        const [x1] = project({ code: "", lat: bounds.minLat, lon }, bounds);
        return <line key={`lon${lon}`} x1={x1} y1={0} x2={x1} y2={HEIGHT} />;
      })}
    </g>
  );
}

interface RouteMapProps {
  homeBase: string;
  line: Line;
}

export function RouteMap({ homeBase, line }: RouteMapProps) {
  const tripPaths = line.trips
    .map((trip) => buildPoints(homeBase, trip.layoverCities))
    .filter((pts): pts is Point[] => !!pts && pts.length > 1);

  if (tripPaths.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        {coordinatesForAirport(homeBase)
          ? "This line has no layover cities with known coordinates to map yet."
          : "This base's coordinates aren't in the map yet."}
      </p>
    );
  }

  const allPoints = tripPaths.flat();
  const bounds = {
    minLat: Math.min(...allPoints.map((p) => p.lat)) - 6,
    maxLat: Math.max(...allPoints.map((p) => p.lat)) + 6,
    minLon: Math.min(...allPoints.map((p) => p.lon)) - 6,
    maxLon: Math.max(...allPoints.map((p) => p.lon)) + 6,
  };

  const uniqueCities = new Map<string, Point>();
  for (const p of allPoints) uniqueCities.set(p.code, p);

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full rounded-lg border border-border bg-canvas" role="img" aria-label={`Flight paths for this line, from ${homeBase} to ${[...uniqueCities.keys()].filter((c) => c !== homeBase).join(", ")}`}>
        <Graticule bounds={bounds} />
        {tripPaths.map((pts, i) => {
          const d = pts.map((p) => project(p, bounds)).map(([x, y], j) => `${j === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
          const closeBack = project(pts[0], bounds);
          return <path key={i} d={`${d} L ${closeBack[0]} ${closeBack[1]}`} fill="none" stroke="var(--color-calendar-accent)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.75} />;
        })}
        {[...uniqueCities.entries()].map(([code, p]) => {
          const [x, y] = project(p, bounds);
          const isHome = code === homeBase;
          return (
            <g key={code}>
              {isHome ? (
                <rect x={x - 4} y={y - 4} width={8} height={8} rx={1.5} transform={`rotate(45 ${x} ${y})`} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={1.5} />
              ) : (
                <circle cx={x} cy={y} r={4} fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth={1.5} />
              )}
              <text x={x} y={y - 10} textAnchor="middle" className="font-mono" fontSize={11} fontWeight={isHome ? 700 : 500} fill="var(--color-ink)">
                {code}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-ink-faint">
        Straight paths between real coordinates, not flight-planned great-circle routes — close enough to see where this line actually goes.
      </p>
    </div>
  );
}
