"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { EASE } from "@/lib/motion-tokens";
import { useMediaQuery } from "@/lib/use-media-query";
import type { Line } from "@/types/bidpack";

/** Chart width in drawing units — narrower on a phone, so labels and strokes keep a readable size once the chart is scaled down to fit. */
const WIDE_WIDTH = 560;
const NARROW_WIDTH = 340;
const PAD = 40;
/** The frame's height follows the routes' own shape — a regional line gets a short, wide chart; a line spanning an ocean gets more room. */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 340;

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
  /** Longitude "unwrapped" relative to the home base, via `shortestLonDelta` — not a real absolute longitude, but what makes a bounding-box fit and a connecting arc both point the real direction. */
  lon: number;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  /** The frame this chart is drawn into. */
  width: number;
  height: number;
}

/** The frame height that fits these routes at full width, within sensible limits. */
function frameHeight(b: Omit<Bounds, "height">): number {
  const cosLat = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
  const k = (b.width - PAD * 2) / Math.max((b.maxLon - b.minLon) * cosLat, 1);
  return Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, (b.maxLat - b.minLat) * k + PAD * 2)));
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

/**
 * An equirectangular chart centred on the routes, with one scale for both
 * axes (longitude shrunk by the cosine of the middle latitude, as on a real
 * chart) — so a mostly east-west line looks east-west instead of being
 * stretched to fill the frame in both directions.
 */
function project(p: { lat: number; lon: number }, b: Bounds): [number, number] {
  const midLat = (b.minLat + b.maxLat) / 2;
  const midLon = (b.minLon + b.maxLon) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const latSpan = Math.max(b.maxLat - b.minLat, 1);
  const lonSpan = Math.max((b.maxLon - b.minLon) * cosLat, 1);
  const k = Math.min((b.width - PAD * 2) / lonSpan, (b.height - PAD * 2) / latSpan);
  // Latitude increases northward, SVG y increases downward — flip.
  return [b.width / 2 + (p.lon - midLon) * cosLat * k, b.height / 2 - (p.lat - midLat) * k + 8];
}

/**
 * One leg as a gentle arc, bowed toward the pole the way a great circle
 * bows on a flat chart — reads as a route, not a ruler line. A curve for
 * readability, not a flight-planned track.
 */
function arc([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const bow = Math.min(60, len * 0.18);
  return `M ${x1} ${y1} Q ${mx} ${my - bow} ${x2} ${y2}`;
}

/** A real graticule — the reference grid a pilot already reads nav charts in. */
function Graticule({ bounds }: { bounds: Bounds }) {
  // Every 10° on a regional map, every 30° once it spans an ocean.
  const step = bounds.maxLon - bounds.minLon > 70 || bounds.maxLat - bounds.minLat > 40 ? 30 : 10;
  const lats: number[] = [];
  for (let lat = Math.floor((bounds.minLat - 40) / step) * step; lat <= bounds.maxLat + 40; lat += step) if (Math.abs(lat) <= 80) lats.push(lat);
  const lons: number[] = [];
  for (let lon = Math.floor((bounds.minLon - 80) / step) * step; lon <= bounds.maxLon + 80; lon += step) lons.push(lon);
  return (
    <g stroke="var(--color-hairline)" strokeWidth={1}>
      {lats.map((lat) => {
        const [, y] = project({ lat, lon: bounds.minLon }, bounds);
        return <line key={`lat${lat}`} x1={0} y1={y} x2={bounds.width} y2={y} />;
      })}
      {lons.map((lon) => {
        const [x] = project({ lat: bounds.minLat, lon }, bounds);
        return <line key={`lon${lon}`} x1={x} y1={0} x2={x} y2={bounds.height} />;
      })}
    </g>
  );
}

interface RouteMapProps {
  homeBase: string;
  line: Line;
}

/**
 * Where this line actually goes: every trip as lit arcs out of base and
 * back, drawing in one trip after another, over a faint chart grid. Hovering
 * (or focusing) a trip in the list underneath brings its route forward.
 */
export function RouteMap({ homeBase, line }: RouteMapProps) {
  const reduce = useReducedMotion();
  const glowId = useId().replace(/:/g, "");
  const [focusTrip, setFocusTrip] = useState<number | null>(null);
  const width = useMediaQuery("(min-width: 640px)") ? WIDE_WIDTH : NARROW_WIDTH;

  const trips = line.trips
    .map((trip, i) => ({ trip, i, pts: buildPoints(homeBase, trip.layoverCities) }))
    .filter((t): t is { trip: Line["trips"][number]; i: number; pts: Point[] } => !!t.pts && t.pts.length > 1);

  if (trips.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        {coordinatesForAirport(homeBase)
          ? "This line has no layover cities with known coordinates to map yet."
          : "This base's coordinates aren't in the map yet."}
      </p>
    );
  }

  const allPoints = trips.flatMap((t) => t.pts);
  // A little room on every side (the frame's own padding does most of it), a bit more on top for the labels and the arcs' bow.
  const extent = {
    minLat: Math.min(...allPoints.map((p) => p.lat)) - 1,
    maxLat: Math.max(...allPoints.map((p) => p.lat)) + 2,
    minLon: Math.min(...allPoints.map((p) => p.lon)) - 2,
    maxLon: Math.max(...allPoints.map((p) => p.lon)) + 2,
    width,
  };
  const bounds: Bounds = { ...extent, height: frameHeight(extent) };
  const cities = new Map<string, Point>();
  for (const p of allPoints) cities.set(p.code, p);

  return (
    <div>
      <svg
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        className="w-full rounded-xl border border-hairline"
        style={{ background: "radial-gradient(ellipse at 50% 35%, var(--color-surface-raised), var(--color-panel))" }}
        role="img"
        aria-label={`Flight paths for this line, from ${homeBase} to ${[...cities.keys()].filter((c) => c !== homeBase).join(", ")}`}
      >
        <defs>
          <filter id={`glow-${glowId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <Graticule bounds={bounds} />

        {trips.map(({ pts, i }, order) => {
          const xy = pts.map((p) => project(p, bounds));
          // Out through every layover, then home.
          const legs = [...xy.slice(1), xy[0]].map((to, j) => arc(xy[j], to));
          const d = legs.join(" ");
          const dim = focusTrip !== null && focusTrip !== i;
          const delay = reduce ? 0 : 0.15 + order * 0.35;
          return (
            <g key={i} style={{ opacity: dim ? 0.18 : 1, transition: "opacity 200ms" }}>
              {/* The glow: the same route, wide and blurred, underneath. */}
              <motion.path
                d={d}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={5}
                strokeLinecap="round"
                filter={`url(#glow-${glowId})`}
                opacity={0.35}
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ delay, duration: reduce ? 0 : 1.1, ease: EASE.emphasized }}
              />
              <motion.path
                d={d}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1.75}
                strokeLinecap="round"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ delay, duration: reduce ? 0 : 1.1, ease: EASE.emphasized }}
              />
            </g>
          );
        })}

        {[...cities.entries()].map(([code, p]) => {
          const [x, y] = project(p, bounds);
          const isHome = code === homeBase;
          const w = code.length * 7.4 + 10;
          return (
            <g key={code}>
              <circle cx={x} cy={y} r={isHome ? 9 : 7} fill="var(--color-accent)" opacity={0.18} />
              {isHome ? (
                <rect x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1.5} transform={`rotate(45 ${x} ${y})`} fill="var(--color-accent)" stroke="var(--color-panel)" strokeWidth={1.5} />
              ) : (
                <circle cx={x} cy={y} r={3.6} fill="var(--color-readout)" stroke="var(--color-accent)" strokeWidth={1.5} />
              )}
              <g transform={`translate(${x - w / 2} ${y - 26})`}>
                <rect width={w} height={16} rx={4} fill="var(--color-panel)" stroke="var(--color-hairline)" />
                <text x={w / 2} y={11.5} textAnchor="middle" className="font-mono" fontSize={10.5} fontWeight={isHome ? 700 : 600} fill={isHome ? "var(--color-accent)" : "var(--color-ink)"}>
                  {code}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {trips.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Trips on this line">
          {trips.map(({ trip, i }) => (
            <li key={i}>
              <button
                type="button"
                onMouseEnter={() => setFocusTrip(i)}
                onMouseLeave={() => setFocusTrip(null)}
                onFocus={() => setFocusTrip(i)}
                onBlur={() => setFocusTrip(null)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs text-ink-muted transition-colors hover:bg-accent-soft/40 hover:text-ink focus-visible:bg-accent-soft/40 focus-visible:outline-none"
              >
                <span className="text-accent">{trip.pairingNumber ? `#${trip.pairingNumber}` : `Trip ${i + 1}`}</span>
                <span className="truncate">
                  {[homeBase, ...trip.layoverCities, homeBase].join(" → ")}
                </span>
                <span className="ml-auto shrink-0 text-ink-faint">{trip.days}d</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-faint">
        Arcs between real coordinates, curved for readability &mdash; they show where the line goes, not a flight-planned track.
      </p>
    </div>
  );
}
