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

/**
 * Where a trip lays over, in the order it goes: LAX, IND, then LAX again. The trip's `layoverCities` lists each city
 * once, so a trip that went back to LAX looked as if it flew home from IND; its layovers in visit order (a stop
 * repeated straight after itself, as a two-night layover reads, counted once) keep the real order.
 */
export function tripStops(trip: Pick<Line["trips"][number], "layoverCities" | "layoverDetails">): string[] {
  const visited = trip.layoverDetails?.length ? trip.layoverDetails.map((l) => l.city) : trip.layoverCities;
  return visited.filter((city, i) => city !== visited[i - 1]);
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

/** A city's code tag, in chart units. */
const LABEL_H = 16;
export const labelWidth = (code: string) => code.length * 7.4 + 10;

export interface CityLabel {
  code: string;
  /** The dot. */
  x: number;
  y: number;
  /** The tag's top-left corner. */
  left: number;
  top: number;
  width: number;
  /** Set out away from its dot, with a thin line back to it. */
  leader: boolean;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Where each city's code tag goes. Every tag used to sit straight above its dot, so two cities close on the chart (MEM
 * and ATL, HKG and HAN on a B777 line) printed one tag over the other and a city couldn't be read. Each tag now takes
 * the first place around its dot that's clear of the other tags, the dots and the frame's edge (above, below, beside,
 * then corners); in a tight cluster it steps further out, with a thin line back to its dot. Base goes first, then the
 * most crowded cities, so the cities with the fewest free places choose first.
 */
export function placeLabels(cities: { code: string; x: number; y: number }[], width: number, height: number, homeBase: string): CityLabel[] {
  const dots: Box[] = cities.map(({ x, y }) => ({ left: x - 6, top: y - 6, right: x + 6, bottom: y + 6 }));
  const crowd = (c: { x: number; y: number }) => cities.filter((o) => Math.abs(o.x - c.x) < 60 && Math.abs(o.y - c.y) < 40).length;
  const order = [...cities].sort((a, b) => Number(b.code === homeBase) - Number(a.code === homeBase) || crowd(b) - crowd(a));
  const placed: Box[] = [];
  const out = new Map<string, CityLabel>();
  for (const c of order) {
    const w = labelWidth(c.code);
    // Centre offsets from the dot: right next to it first, then a step further out (those get a leader line).
    const near: [number, number][] = [
      [0, -18], [0, 18], [w / 2 + 9, 0], [-w / 2 - 9, 0],
      [w / 2 + 3, -15], [-w / 2 - 3, -15], [w / 2 + 3, 15], [-w / 2 - 3, 15],
    ];
    const far: [number, number][] = [1.6, 2.4, 3.2].flatMap((k) => near.map(([dx, dy]): [number, number] => [dx === 0 ? 0 : dx + Math.sign(dx) * (k - 1) * (w / 2 + 6), dy * k]));
    let best: { box: Box; cost: number; leader: boolean } | null = null;
    for (const [i, [dx, dy]] of [...near, ...far].entries()) {
      const box = { left: c.x + dx - w / 2, top: c.y + dy - LABEL_H / 2, right: c.x + dx + w / 2, bottom: c.y + dy + LABEL_H / 2 };
      // Out of the frame is as bad as covering a tag; covering a dot a little less so.
      const outside = w * LABEL_H - overlap(box, { left: 2, top: 2, right: width - 2, bottom: height - 2 });
      const cost = outside * 4 + placed.reduce((s, p) => s + overlap(box, p) * 4, 0) + dots.reduce((s, d) => s + overlap(box, d), 0) + i * 0.01;
      if (!best || cost < best.cost) best = { box, cost, leader: i >= near.length };
      if (cost < 1) break;
    }
    placed.push(best!.box);
    out.set(c.code, { code: c.code, x: c.x, y: c.y, left: best!.box.left, top: best!.box.top, width: w, leader: best!.leader });
  }
  return cities.map((c) => out.get(c.code)!);
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

/** The chart for a line at this width: each trip's points, the frame, and where every city's tag goes. Null when nothing can be mapped. */
export function routeChart(homeBase: string, line: Pick<Line, "trips">, width: number) {
  const trips = line.trips
    .map((trip, i) => ({ trip, i, pts: buildPoints(homeBase, tripStops(trip)) }))
    .filter((t): t is { trip: Line["trips"][number]; i: number; pts: Point[] } => !!t.pts && t.pts.length > 1);
  if (trips.length === 0) return null;

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
  const labels = placeLabels(
    [...cities.values()].map((p) => {
      const [x, y] = project(p, bounds);
      return { code: p.code, x, y };
    }),
    bounds.width,
    bounds.height,
    homeBase,
  );
  return { trips, bounds, labels };
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

  const chart = routeChart(homeBase, line, width);

  if (!chart) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        {coordinatesForAirport(homeBase)
          ? "This line has no layover cities with known coordinates to map yet."
          : "This domicile's coordinates aren't in the map yet."}
      </p>
    );
  }
  const { trips, bounds, labels } = chart;

  return (
    <div>
      <svg
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        className="w-full rounded-xl border border-hairline"
        style={{ background: "radial-gradient(ellipse at 50% 35%, var(--color-surface-raised), var(--color-panel))" }}
        role="img"
        aria-label={`Flight paths for this line, from ${homeBase} to ${labels.map((l) => l.code).filter((c) => c !== homeBase).join(", ")}`}
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

        {labels.map(({ code, x, y }) => {
          const isHome = code === homeBase;
          return (
            <g key={code}>
              <circle cx={x} cy={y} r={isHome ? 9 : 7} fill="var(--color-accent)" opacity={0.18} />
              {isHome ? (
                <rect x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1.5} transform={`rotate(45 ${x} ${y})`} fill="var(--color-accent)" stroke="var(--color-panel)" strokeWidth={1.5} />
              ) : (
                <circle cx={x} cy={y} r={3.6} fill="var(--color-readout)" stroke="var(--color-accent)" strokeWidth={1.5} />
              )}
            </g>
          );
        })}
        {/* A tag set out from its dot keeps a thin line back to it. Tags after every dot and line, so nothing is drawn over a city's code. */}
        {labels.map(({ code, x, y, left, top, width: w, leader }) =>
          leader ? <line key={code} x1={x} y1={y} x2={Math.min(Math.max(x, left), left + w)} y2={Math.min(Math.max(y, top), top + LABEL_H)} stroke="var(--color-ink-faint)" strokeWidth={1} /> : null,
        )}
        {labels.map(({ code, left, top, width: w }) => {
          const isHome = code === homeBase;
          return (
            <g key={code} transform={`translate(${left} ${top})`}>
              <rect width={w} height={LABEL_H} rx={4} fill="var(--color-panel)" stroke="var(--color-hairline)" />
              <text x={w / 2} y={11.5} textAnchor="middle" className="font-mono" fontSize={10.5} fontWeight={isHome ? 700 : 600} fill={isHome ? "var(--color-accent)" : "var(--color-ink)"}>
                {code}
              </text>
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
                {/* Wraps on a phone: cut off, a long trip's last stops couldn't be read anywhere. */}
                <span className="min-w-0">
                  {[homeBase, ...tripStops(trip), homeBase].join(" → ")}
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
