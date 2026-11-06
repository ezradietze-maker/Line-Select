"use client";

import { useReducedMotion } from "motion/react";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { hotelPosition, rangeRingMiles } from "@/lib/hotel-position";

/** The outer ring's radius in the drawing's own units. */
const RING = 44;

const formatMiles = (mi: number) => (mi < 10 && !Number.isInteger(mi) ? mi.toFixed(1) : Math.round(mi).toString());

/**
 * Where the hotel is from the field, drawn like a nav display: range rings round the airport, the hotel's pin dropping
 * onto its real bearing and distance, the straight line between them drawing in. Nothing when either can't be placed.
 */
export function HotelPinMap({ code, location }: { code: string; location: { latitude: number; longitude: number } | null }) {
  const reduce = useReducedMotion();
  const airport = coordinatesForAirport(code);
  if (!airport || !location) return null;
  const pos = hotelPosition(airport, location);
  const ring = rangeRingMiles(pos.miles);
  const r = (pos.miles / ring) * RING;
  const hx = r * Math.sin((pos.bearing * Math.PI) / 180);
  const hy = -r * Math.cos((pos.bearing * Math.PI) / 180);

  return (
    <div className="mb-4 flex items-center gap-4">
      <svg viewBox="-56 -52 112 104" className="h-24 w-24 shrink-0" aria-hidden>
        {[RING / 2, RING].map((rr) => (
          <circle key={rr} r={rr} fill="none" stroke="var(--color-hairline)" strokeDasharray={rr === RING ? undefined : "2 2"} />
        ))}
        <line x1={0} y1={-RING - 3} x2={0} y2={-RING + 3} stroke="var(--color-ink-faint)" />
        <text x={0} y={-RING - 5} textAnchor="middle" fontSize={7} fill="var(--color-ink-faint)" fontFamily="var(--font-mono)">
          N
        </text>
        {/* The field: two crossing runways. */}
        <g fill="var(--color-ink-muted)">
          <rect x={-1.2} y={-7} width={2.4} height={14} rx={0.6} transform="rotate(-30)" />
          <rect x={-1.2} y={-6} width={2.4} height={12} rx={0.6} transform="rotate(45)" />
        </g>
        <line x1={0} y1={0} x2={hx} y2={hy} stroke="var(--color-accent)" strokeOpacity={0.7} strokeWidth={1.2} strokeLinecap="round" pathLength={1} className={reduce ? "" : "route-draw"} />
        <g transform={`translate(${hx} ${hy})`}>
          {!reduce && <circle r={3} fill="none" stroke="var(--color-accent)" className="pin-ping" />}
          <g className={reduce ? "" : "pin-drop"}>
            <path d="M0 0 C-1 -3 -5 -6 -5 -10 A5 5 0 1 1 5 -10 C5 -6 1 -3 0 0 Z" fill="var(--color-accent)" />
            <circle cy={-10} r={1.9} fill="var(--color-canvas)" />
          </g>
        </g>
      </svg>
      <p className="text-xs leading-relaxed text-ink-muted">
        <span className="font-mono text-sm font-semibold text-ink">{formatMiles(pos.miles)} mi</span> {pos.direction} of {code}, in a straight line.
        <span className="block text-ink-faint">
          Rings at {formatMiles(ring / 2)} and {formatMiles(ring)} mi.
        </span>
      </p>
    </div>
  );
}
