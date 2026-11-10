"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { WorldMap } from "@/components/ui/WorldMap";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { greatCircle, pathThrough, project } from "@/lib/globe/flat-map";
import { sunTimes } from "@/lib/sun-times";

/**
 * The way there: base to the city on a small world map, the great circle drawing itself in and a plane flying it
 * once. Nothing to draw for an airport the app can't place.
 */
export function RouteArc({ from, to }: { from: string; to: string }) {
  const reduce = useReducedMotion();
  const a = coordinatesForAirport(from);
  const b = coordinatesForAirport(to);
  const points = useMemo(() => (a && b ? greatCircle({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }, 96) : []), [a, b]);
  const plane = useRef<SVGGElement>(null);
  useEffect(() => {
    const g = plane.current;
    if (!g || reduce || points.length < 2) return;
    let raf = 0;
    const started = performance.now() + 700; // once the arc has drawn in
    const tick = (t: number) => {
      const f = Math.min(1, Math.max(0, (t - started) / 2600));
      const i = Math.min(points.length - 2, Math.floor(f * (points.length - 1)));
      const [x1, y1] = project(points[i]);
      const [x2, y2] = project(points[i + 1]);
      // Across the date line the next point is on the far edge: keep the last heading rather than spin round.
      const jump = Math.abs(x2 - x1) > 180;
      const angle = jump ? Number(g.dataset.angle ?? 0) : (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      g.dataset.angle = String(angle);
      g.setAttribute("transform", `translate(${x1} ${y1}) rotate(${angle})`);
      g.style.opacity = f <= 0 || f >= 1 ? "0" : "1";
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [points, reduce]);
  if (!a || !b || points.length < 2) return null;
  const [ax, ay] = project({ lat: a[0], lon: a[1] });
  const [bx, by] = project({ lat: b[0], lon: b[1] });
  return (
    <WorldMap label={`The great-circle route from ${from} to ${to}`}>
      <path d={pathThrough(points)} fill="none" stroke="var(--color-accent)" strokeWidth={1.2} strokeLinecap="round" pathLength={1} className={reduce ? "" : "route-draw"} />
      <circle cx={ax} cy={ay} r={2.4} fill="var(--color-ink)" />
      <circle cx={bx} cy={by} r={2.8} fill="var(--color-accent)" />
      <g ref={plane} style={{ opacity: 0 }}>
        <path d="M4 0 L-3 -2.6 L-1.6 0 L-3 2.6 Z" fill="var(--color-accent)" />
      </g>
    </WorldMap>
  );
}

/**
 * The sun over the city right now: a horizon, the sun's arc from sunrise to sunset, and where it is on it — or, after
 * dark, the moon's way across the night to the next sunrise. On the city's own clock.
 */
export function SunDial({ code, now }: { code: string; now: number }) {
  const at = coordinatesForAirport(code);
  if (!at) return null;
  const day = (offset: number) => sunTimes(new Date(now + offset * 86_400_000), at[0], at[1]);
  const today = day(0);
  if (!today) return null;
  // Which stretch we're in: today's daylight, or the night between two of them.
  let up: boolean;
  let f: number;
  if (now >= today.sunrise && now < today.sunset) {
    up = true;
    f = (now - today.sunrise) / (today.sunset - today.sunrise);
  } else {
    const before = now < today.sunrise ? day(-1) : today;
    const after = now < today.sunrise ? today : day(1);
    if (!before || !after) return null;
    up = false;
    f = (now - before.sunset) / (after.sunrise - before.sunset);
  }
  f = Math.min(1, Math.max(0, f));
  const cx = 60;
  const cy = 46;
  const r = 38;
  const angle = Math.PI * (1 - f);
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  return (
    <svg viewBox="0 0 120 54" className="h-14 w-32" role="img" aria-label={up ? `The sun is up in ${code}, ${Math.round(f * 100)}% of the way across the sky` : `It's night in ${code}`}>
      <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--color-hairline)" strokeWidth={1.5} strokeDasharray="2 3" />
      <line x1={4} y1={cy} x2={116} y2={cy} stroke="var(--color-ink-faint)" strokeWidth={1} />
      {up ? (
        <g>
          <circle cx={x} cy={y} r={9} fill="var(--color-accent)" opacity={0.18} />
          <circle cx={x} cy={y} r={5} fill="var(--color-accent)" />
        </g>
      ) : (
        <g>
          <circle cx={x} cy={y} r={5} fill="var(--color-ink-muted)" />
          <circle cx={x + 2.2} cy={y - 1.6} r={4.2} fill="var(--color-surface)" />
        </g>
      )}
    </svg>
  );
}
