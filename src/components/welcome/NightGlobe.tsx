"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { globeRoutes } from "@/lib/globe/routes";

/** Whether this device can draw WebGL at all — checked once, without keeping the probe context alive. */
function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/**
 * What shows before the 3D globe loads, and instead of it where WebGL isn't
 * available: the same composition as a flat drawing — sphere, graticule, a
 * few arcs — so the hero never sits empty or jumps when the real one fades in.
 */
function GlobePoster() {
  return (
    <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="poster-sphere" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="var(--color-surface-raised)" />
          <stop offset="1" stopColor="var(--color-panel)" />
        </radialGradient>
        <radialGradient id="poster-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0.78" stopColor="var(--glow-strong)" stopOpacity="0" />
          <stop offset="0.9" stopColor="var(--glow-strong)" stopOpacity="0.5" />
          <stop offset="1" stopColor="var(--glow-strong)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="196" fill="url(#poster-halo)" />
      <circle cx="200" cy="200" r="160" fill="url(#poster-sphere)" stroke="var(--color-hairline)" />
      <g fill="none" stroke="var(--color-hairline)">
        {[-60, -30, 0, 30, 60].map((lat) => (
          <ellipse key={lat} cx="200" cy={200 - 160 * Math.sin((lat * Math.PI) / 180) * 0.9} rx={160 * Math.cos((lat * Math.PI) / 180)} ry={22 * Math.cos((lat * Math.PI) / 180)} />
        ))}
        {[0, 35, 70, 105, 140].map((r) => (
          <ellipse key={r} cx="200" cy="200" rx={160 * Math.abs(Math.cos((r * Math.PI) / 180))} ry="160" />
        ))}
      </g>
      <g fill="none" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
        <path d="M150 215 Q 210 110 290 150" />
        <path d="M150 215 Q 120 140 95 120" />
        <path d="M150 215 Q 175 270 205 300" />
      </g>
      <g fill="var(--color-accent)">
        <circle cx="150" cy="215" r="3.5" />
        <circle cx="290" cy="150" r="2.5" />
        <circle cx="95" cy="120" r="2.5" />
        <circle cx="205" cy="300" r="2.5" />
      </g>
    </svg>
  );
}

/**
 * The landing hero's 3D night globe — real routes from real bid packs,
 * drawing in and carrying pulses of light, slowly turning, draggable.
 * three.js is imported only here, on the client, after the page has
 * painted, so it never weighs on first load or on any other screen.
 * Purely decorative to assistive tech; the readout below it is real text.
 */
export function NightGlobe({ className = "" }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const routes = useMemo(() => globeRoutes(), []);
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = container.current;
    if (!el || !supportsWebGL()) return;
    let handle: { dispose: () => void; refreshTheme: () => void } | null = null;
    let cancelled = false;

    import("./globe-scene").then(({ createGlobe }) => {
      if (cancelled) return;
      handle = createGlobe({ container: el, routes, reducedMotion: !!reduceMotion, onActiveRoute: (i) => setActive(i) });
      // One frame for the canvas to draw before fading it in over the poster.
      requestAnimationFrame(() => !cancelled && setReady(true));
    });

    // Light/dark/red-light can change under the globe — follow it.
    const themeObserver = new MutationObserver(() => handle?.refreshTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => handle?.refreshTheme();
    scheme.addEventListener("change", onScheme);

    return () => {
      cancelled = true;
      themeObserver.disconnect();
      scheme.removeEventListener("change", onScheme);
      handle?.dispose();
      setReady(false);
    };
  }, [routes, reduceMotion]);

  const route = routes[active] ?? routes[0];

  return (
    <div className={`relative ${className}`}>
      <div className="relative aspect-square w-full">
        <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}>
          <GlobePoster />
        </div>
        <div
          ref={container}
          aria-hidden
          className={`absolute inset-0 cursor-grab transition-opacity duration-1000 active:cursor-grabbing ${ready ? "opacity-100" : "opacity-0"}`}
        />
      </div>
      {route && (
        <div className="pointer-events-none absolute bottom-[8%] left-1/2 -translate-x-1/2 sm:left-auto sm:right-[4%] sm:translate-x-0">
          <div className="panel-glass flex items-center gap-3 whitespace-nowrap px-3.5 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--glow-strong)]" aria-hidden />
            <span className="text-readout text-sm font-medium tracking-wide">
              {route.from} <span className="text-ink-faint">&rarr;</span> {route.to}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              {Math.round(route.nm).toLocaleString()} nm
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
