"use client";

import { motion, useReducedMotion } from "motion/react";
import { DURATION, EASE } from "@/lib/motion-tokens";

interface FlightPathProgressProps {
  /** 0 to 1 — how far along the route. */
  fraction: number;
  /** Spoken description, e.g. "Interview progress". */
  label: string;
  /** Endpoint labels under the route, e.g. "MEM" / "Your ranking". */
  origin?: string;
  destination?: string;
  /** Evenly spaced waypoints along the route; each lights up once passed. */
  waypoints?: number;
  className?: string;
}

/**
 * Progress drawn as a flight: a dashed route still to fly, the flown part
 * lit solid, and a small aircraft at the current position. Reads at a glance
 * like a nav display rather than a loading bar.
 *
 * Animates `left`/`width` on leaf elements only — no transform on a
 * container — per globals.css's warning about transforms breaking
 * fixed-position descendants.
 */
export function FlightPathProgress({ fraction, label, origin, destination, waypoints = 0, className = "" }: FlightPathProgressProps) {
  const f = Math.min(1, Math.max(0, fraction));
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : { duration: DURATION.reveal, ease: EASE.emphasized };
  const points = Array.from({ length: waypoints }, (_, i) => (i + 1) / (waypoints + 1));

  return (
    <div
      className={className}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
    >
      <div className="relative h-7" aria-hidden>
        {/* The route still to fly. */}
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border-strong" />
        {/* The route already flown. */}
        <motion.div
          className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--glow-strong)]"
          initial={false}
          animate={{ width: `${f * 100}%` }}
          transition={transition}
        />
        {points.map((p) => (
          <div
            key={p}
            className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border transition-colors duration-300 ${
              p <= f ? "border-accent bg-accent" : "border-border-strong bg-canvas"
            }`}
            style={{ left: `${p * 100}%` }}
          />
        ))}
        <motion.div
          className="absolute top-1/2 -ml-3 -mt-3 h-6 w-6 text-accent drop-shadow-[0_0_6px_var(--glow-strong)]"
          initial={false}
          animate={{ left: `${f * 100}%` }}
          transition={transition}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M21 12c0-.8-.7-1.2-1.6-1.2H15L10.3 3.6H8.5l2.3 7.2H6.2L4.6 8.6H3.2l1 3.4-1 3.4h1.4l1.6-2.2h4.6l-2.3 7.2h1.8l4.7-7.2h4.4c.9 0 1.6-.4 1.6-1.2z" />
          </svg>
        </motion.div>
      </div>
      {(origin || destination) && (
        <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint" aria-hidden>
          <span>{origin}</span>
          <span>{destination}</span>
        </div>
      )}
    </div>
  );
}
