"use client";

import { useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { WorldMap } from "@/components/ui/WorldMap";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { MAP_H, MAP_W, project } from "@/lib/globe/flat-map";

/** Width over height of the map: a wide strip, so a pack of mostly domestic flying isn't a tall box of empty ocean. */
const RATIO = 3;
const PAD = 10;

interface Stop {
  code: string;
  x: number;
  y: number;
}

/** The part of the world map that holds every point with a margin, widened or heightened to the strip's shape. */
function frameAround(points: { x: number; y: number }[]): [number, number, number, number] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs) - PAD;
  const x1 = Math.max(...xs) + PAD;
  const y0 = Math.min(...ys) - PAD;
  const y1 = Math.max(...ys) + PAD;
  const h = Math.max(y1 - y0, Math.max(x1 - x0, 60) / RATIO);
  const w = h * RATIO;
  // Centred on the points, but never above the top of the map or below its foot.
  const top = Math.min(Math.max((y0 + y1) / 2 - h / 2, 0), Math.max(0, MAP_H - h));
  return [(x0 + x1) / 2 - w / 2, top, w, h];
}

/** A gentle bow from base to city, bending to the left of the way flown, the way route maps draw them. */
function bow(a: Stop, b: Stop): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = 0.18;
  return `M${a.x} ${a.y} Q${(a.x + b.x) / 2 + dy * k} ${(a.y + b.y) / 2 - dx * k} ${b.x} ${b.y}`;
}

/**
 * Where the pack goes, drawn: a route out from base to every layover city, each drawing itself in one after another,
 * the most-flown three in amber with their codes. Cities across the date line are reached the short way round.
 */
export function LayoverRouteMap({ base, cities }: { base: string; cities: string[] }) {
  const reduce = useReducedMotion();
  const placed = useMemo(() => {
    const home = coordinatesForAirport(base);
    if (!home) return null;
    const [hx, hy] = project({ lat: home[0], lon: home[1] });
    const stops: Stop[] = [];
    for (const code of cities) {
      const c = coordinatesForAirport(code);
      if (!c) continue;
      const [px, y] = project({ lat: c[0], lon: c[1] });
      let x = px;
      if (x - hx > MAP_W / 2) x -= MAP_W;
      else if (hx - x > MAP_W / 2) x += MAP_W;
      stops.push({ code, x, y });
    }
    const origin = { code: base, x: hx, y: hy };
    return { origin, stops, view: frameAround([origin, ...stops]) };
  }, [base, cities]);
  if (!placed || placed.stops.length === 0) return null;
  const { origin, stops, view } = placed;
  // Sizes in the map's own units, kept the same on screen however far it's zoomed in.
  const unit = view[2] / 360;

  return (
    <div className="relative">
      <WorldMap view={view} label={`Routes from ${base} to the ${stops.length} layover cities in this pack`}>
        {stops.map((s, i) => (
          <path
            key={s.code}
            d={bow(origin, s)}
            fill="none"
            stroke={i < 3 ? "var(--color-accent)" : "var(--color-ink-muted)"}
            strokeOpacity={i < 3 ? 1 : 0.55}
            strokeWidth={i < 3 ? 1.5 : 1}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            className={reduce ? "" : "route-draw"}
            style={reduce ? undefined : { animationDelay: `${200 + i * 70}ms` }}
          />
        ))}
        {stops.map((s, i) => (
          <circle
            key={s.code}
            cx={s.x}
            cy={s.y}
            r={(i < 3 ? 2.6 : 1.8) * unit}
            fill={i < 3 ? "var(--color-accent)" : "var(--color-ink-muted)"}
            className={reduce ? "" : "route-dot"}
            style={reduce ? undefined : { animationDelay: `${900 + i * 70}ms` }}
          />
        ))}
        <circle cx={origin.x} cy={origin.y} r={3.2 * unit} fill="var(--color-ink)" />
        <circle cx={origin.x} cy={origin.y} r={3.2 * unit} fill="none" stroke="var(--color-ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" className={reduce ? "" : "beacon-ring"} />
      </WorldMap>
      {/* The most-flown three named, in HTML over the map so the codes read the same size on any screen. */}
      {stops.slice(0, 3).map((s, i) => (
        <span
          key={s.code}
          aria-hidden
          className={`pointer-events-none absolute -translate-x-1/2 font-mono text-[10px] font-semibold tracking-wider text-accent ${reduce ? "" : "route-dot"}`}
          style={{
            left: `${((s.x - view[0]) / view[2]) * 100}%`,
            top: `calc(${((s.y - view[1]) / view[3]) * 100}% - 18px)`,
            animationDelay: reduce ? undefined : `${900 + i * 70}ms`,
          }}
        >
          {s.code}
        </span>
      ))}
    </div>
  );
}
