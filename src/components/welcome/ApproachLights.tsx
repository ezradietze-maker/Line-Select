"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { globeRoutes } from "@/lib/globe/routes";
import { useMediaQuery } from "@/lib/use-media-query";

/**
 * The picture is a pilot's view on final at night, drawn in perspective: the approach light bars coming up toward
 * the green threshold, the runway's edge lights running away to the horizon, and the Line Select sign standing there.
 * Points are worked out once, here, from depth `z` (ground distance from the eye) and `x` (across the runway, in
 * half-widths), and rounded so the server's numbers and the browser's match.
 */
const HORIZON = 130;
const CX = 240;
const round = (n: number) => Math.round(n * 100) / 100;
const sy = (z: number) => round(HORIZON + 1700 / z);
const sx = (x: number, z: number) => round(CX + (600 * x) / z);
const size = (z: number) => round(Math.max(0.9, 15 / z));

/**
 * Approach light bars, nearest first: the sequenced flashers run along their centres toward the runway. The nearest
 * stops short of the picture's foot, which is the route sign's.
 */
const BARS = [6.3, 6.85, 7.45, 8.1, 8.8, 9.5];
const BAR_X = [-0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45];
const THRESHOLD_Z = 10;
const THRESHOLD_X = Array.from({ length: 17 }, (_, i) => -1 + i * 0.125);
const EDGE_Z = Array.from({ length: 16 }, (_, k) => THRESHOLD_Z * 1.2 ** (k + 1));

/** A route from the network, shown on the sign under the picture, turning over every few seconds. */
const ROUTE_MS = 3200;

/**
 * The landing hero (Ramp at Night's one showpiece): approach lights running in sequence toward the logo, three times
 * on arrival, then steady. Always a night scene, whatever the mode — the way the sidebar is always the night sky — so
 * it stays a lit runway on the concrete-grey day page; red under red-light. Under reduced motion the lights simply
 * stand, and the sign stays on its first route.
 */
export function ApproachLights({ className = "" }: { className?: string }) {
  const routes = globeRoutes();
  const still = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (still || routes.length < 2) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % routes.length), ROUTE_MS);
    return () => window.clearInterval(id);
  }, [still, routes.length]);

  const route = routes[active] ?? routes[0];
  const runway = `${sx(-1, THRESHOLD_Z)},${sy(THRESHOLD_Z)} ${sx(1, THRESHOLD_Z)},${sy(THRESHOLD_Z)} ${CX},${HORIZON}`;

  return (
    <div className={`sidebar-scheme relative aspect-square w-full overflow-hidden rounded-[6px] border border-border bg-canvas ${className}`}>
      <svg viewBox="0 0 480 480" className="absolute inset-0 h-full w-full" aria-hidden>
        <line x1={0} x2={480} y1={HORIZON} y2={HORIZON} stroke="var(--color-border-strong)" strokeWidth={1} />
        <polygon points={runway} fill="var(--color-surface)" opacity={0.7} />
        {/* The runway's edge and centreline lights, away to the horizon. */}
        <g fill="var(--color-ink)">
          {EDGE_Z.map((z) => (
            <g key={z} opacity={round(Math.max(0.25, 1 - z / 140))}>
              <circle cx={sx(-1, z)} cy={sy(z)} r={size(z)} />
              <circle cx={sx(1, z)} cy={sy(z)} r={size(z)} />
              <circle cx={CX} cy={sy(z)} r={round(size(z) * 0.6)} />
            </g>
          ))}
        </g>
        {/* The threshold: a bar of green across the runway's start. */}
        <g fill="var(--color-good)">
          {THRESHOLD_X.map((x) => (
            <circle key={x} cx={sx(x, THRESHOLD_Z)} cy={sy(THRESHOLD_Z)} r={size(THRESHOLD_Z)} />
          ))}
        </g>
        {/* The approach light bars, steady. */}
        <g fill="var(--color-ink)" opacity={0.85}>
          {BARS.map((z) => BAR_X.map((x) => <circle key={`${z}:${x}`} cx={sx(x, z)} cy={sy(z)} r={size(z)} />))}
        </g>
        {/* The rabbit: one flash after another along the centre, toward the runway and the sign. */}
        <g fill="var(--color-accent)">
          {BARS.map((z, i) => (
            <circle key={z} className="rabbit-light" style={{ animationDelay: `${400 + i * 90}ms` }} cx={CX} cy={sy(z)} r={round(size(z) * 1.8)} />
          ))}
        </g>
      </svg>
      {/* The sign at the end of the runway. */}
      <LogoMark className="absolute left-1/2 top-[12%] h-auto w-[13%] -translate-x-1/2" />
      {route && (
        <div className="pointer-events-none absolute bottom-[6%] left-1/2 -translate-x-1/2">
          <div key={active} className="mark-in flex items-center gap-3 whitespace-nowrap rounded-[4px] bg-accent-wash px-3.5 py-2 text-on-wash ring-[1.5px] ring-inset ring-accent">
            <span className="font-mono text-sm font-medium tabular-nums tracking-wide">
              {route.from} <span className="opacity-70">&rarr;</span> {route.to}
            </span>
            <span className="text-2xs font-medium opacity-80">
              {Math.round(route.nm).toLocaleString()} nm
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
