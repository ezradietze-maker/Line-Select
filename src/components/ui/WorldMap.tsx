"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { landPoints } from "@/lib/globe/land-mask";
import { MAP_H, MAP_W, project } from "@/lib/globe/flat-map";

let land: [number, number][] | null = null;
const landXY = () => (land ??= landPoints().map((p) => project(p)));

/**
 * A small dotted world map — the same land as the landing page's globe, laid flat — with whatever's drawn over it in
 * the map's own 360 × 180 frame (`children`: arcs, the night side, city dots). The land is painted once on a canvas,
 * in the theme's own faint ink, and again when the theme changes.
 */
export function WorldMap({ children, className = "", label }: { children?: ReactNode; className?: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const draw = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(el).color;
      ctx.globalAlpha = 0.28;
      const sx = w / MAP_W;
      const sy = h / MAP_H;
      const r = Math.max(0.6, w / 520);
      for (const [x, y] of landXY()) {
        ctx.beginPath();
        ctx.arc(x * sx, y * sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(el);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", draw);
    return () => {
      resize.disconnect();
      theme.disconnect();
      scheme.removeEventListener("change", draw);
    };
  }, []);

  return (
    <div className={`relative aspect-[2/1] w-full overflow-hidden rounded-lg bg-canvas/60 ${className}`} role="img" aria-label={label}>
      <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full text-ink" />
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full">
        {children}
      </svg>
    </div>
  );
}
