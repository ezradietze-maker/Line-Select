"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WorldMap } from "@/components/ui/WorldMap";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { MAP_H, MAP_W, project } from "@/lib/globe/flat-map";
import { widthWatcher } from "@/lib/width-watcher";

/** Width over height of the map: a wide strip, so a pack of mostly domestic flying isn't a tall box of empty ocean. */
const RATIO = 3;
const PAD = 10;

interface Stop {
  code: string;
  x: number;
  y: number;
}

/** The part of the world map that holds every point with a margin, widened or heightened to the strip's shape. */
export function frameAround(points: { x: number; y: number }[]): [number, number, number, number] {
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

export type LabelSide = "above" | "west" | "east" | "below";

/**
 * Where a city's code sits from its dot, in px at `rem` px to the rem: the letters themselves (each about 0.68 of the
 * 2xs text's size wide, standing from 0.3 to 0.82 of the way down its 1rem line), not the spacing above and below them.
 */
export function labelBox(side: LabelSide, x: number, y: number, chars: number, rem: number): { l: number; t: number; r: number; b: number } {
  const w = chars * 0.68 * 0.6875 * rem;
  const off = 0.4375 * rem;
  const top = side === "above" ? y - 1.125 * rem : side === "below" ? y + 0.25 * rem : y - off;
  const left = side === "above" || side === "below" ? x - w / 2 : side === "west" ? x - off - w : x + off;
  return { l: left, t: top + 0.3 * rem, r: left + w, b: top + 0.82 * rem };
}

/**
 * Which side of its dot each of the most-flown three is named on. Above it, unless another of them is close by: then
 * the two take a side each, west and east. Where that still runs into one named before it on the map as it's drawn
 * (`widthPx` wide; three close together, or the text set larger), the first other side that's clear: MDT, IND and BWI
 * from Memphis all printed over one another east of their dots. Before the map's width is known, the first rule alone.
 */
export function labelSides(stops: { code: string; x: number; y: number }[], view: [number, number, number, number], widthPx: number, rem: number): LabelSide[] {
  const placed: { l: number; t: number; r: number; b: number }[] = [];
  return stops.map((s) => {
    const near = stops.find((o) => o !== s && Math.abs(o.x - s.x) / view[2] < 0.16 && Math.abs(o.y - s.y) / view[3] < 0.22);
    const first: LabelSide = !near ? "above" : s.x < near.x ? "west" : "east";
    if (widthPx <= 0) return first;
    const px = ((s.x - view[0]) / view[2]) * widthPx;
    const py = ((s.y - view[1]) / view[3]) * widthPx * (view[3] / view[2]);
    const clear = (side: LabelSide) => {
      const b = labelBox(side, px, py, s.code.length, rem);
      return placed.every((o) => b.r + 2 <= o.l || o.r + 2 <= b.l || b.b + 2 <= o.t || o.b + 2 <= b.t);
    };
    const side = ([first, "above", "east", "west", "below"] as const).find(clear) ?? first;
    placed.push(labelBox(side, px, py, s.code.length, rem));
    return side;
  });
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
 * `labels={false}` leaves the codes off, for a screen that already names the cities (the Logbook).
 */
export function LayoverRouteMap({ base, cities, labels = true }: { base: string; cities: string[]; labels?: boolean }) {
  const reduce = useReducedMotion();
  // The map's width as drawn (0 until it's measured), for where its codes have room.
  const boxRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);
  const [watcher] = useState(() => widthWatcher(setWidthPx, 0));
  useEffect(() => watcher.follow(boxRef.current));
  useEffect(() => () => watcher.stop(), [watcher]);
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
  // One after another, but the whole map's drawn inside a couple of seconds, however many cities a pack has.
  const step = Math.min(70, 1400 / stops.length);
  // Measured once it's drawn: the page's text size, so the codes' room grows with them.
  const rem = widthPx > 0 ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 : 16;
  const sides = labelSides(stops.slice(0, 3), view, widthPx, rem);

  return (
    <div ref={boxRef} className="relative">
      <WorldMap view={view} label={`Routes from ${base} to the ${stops.length} layover cities in this pack`}>
        {stops.map((s, i) => (
          <path
            key={s.code}
            d={bow(origin, s)}
            fill="none"
            stroke={i < 3 ? "var(--color-accent)" : "var(--color-ink-muted)"}
            strokeOpacity={i < 3 ? 1 : 0.55}
            // In the map's own units, not non-scaling-stroke: with that, the browser measures the draw-in's dashes in
            // screen pixels, and on a map scaled up the finished line stays broken.
            strokeWidth={(i < 3 ? 1.5 : 1) * unit}
            strokeLinecap="round"
            pathLength={1}
            className={reduce ? "" : "route-draw"}
            style={reduce ? undefined : { animationDelay: `${200 + i * step}ms` }}
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
            style={reduce ? undefined : { animationDelay: `${900 + i * step}ms` }}
          />
        ))}
        <circle cx={origin.x} cy={origin.y} r={3.2 * unit} fill="var(--color-ink)" />
        <circle cx={origin.x} cy={origin.y} r={3.2 * unit} fill="none" stroke="var(--color-ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" className={reduce ? "" : "beacon-ring"} />
      </WorldMap>
      {/* The most-flown three named, in HTML over the map so the codes read the same size on any screen. */}
      {labels && stops.slice(0, 3).map((s, i) => {
        const left = ((s.x - view[0]) / view[2]) * 100;
        const top = ((s.y - view[1]) / view[3]) * 100;
        const side = sides[i];
        const across = side === "above" || side === "below";
        // Set off from the dot in rem, so a code set larger stays clear of its own dot (in px, at 150% it sat on it).
        return (
          <span
            key={s.code}
            aria-hidden
            className={`pointer-events-none absolute font-mono text-2xs font-semibold tracking-wider text-accent ${across ? "-translate-x-1/2" : side === "west" ? "-translate-x-full" : ""} ${reduce ? "" : "route-dot"}`}
            style={{
              left: across ? `${left}%` : `calc(${left}% ${side === "west" ? "-" : "+"} 0.4375rem)`,
              top: side === "above" ? `calc(${top}% - 1.125rem)` : side === "below" ? `calc(${top}% + 0.25rem)` : `calc(${top}% - 0.4375rem)`,
              animationDelay: reduce ? undefined : `${900 + i * step}ms`,
            }}
          >
            {s.code}
          </span>
        );
      })}
    </div>
  );
}
