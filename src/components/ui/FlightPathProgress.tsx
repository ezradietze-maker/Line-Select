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
  /**
   * Named stops along the route instead (0 to 1), labelled above it; one at 0 or 1 just names that end. `wideOnly`
   * labels a stop only on wider screens — on a phone it would run into its neighbour; its marker stays.
   */
  stops?: { at: number; label: string; wideOnly?: boolean }[];
  className?: string;
}

/**
 * Progress as steps along a ruled line: the way still to go a plain rule, the part done the green centreline, each
 * step a tick that's stamped green as it's passed, and a small location sign (yellow on black) where you are now.
 *
 * Animates `left`/`width` on leaf elements only — no transform on a
 * container — per globals.css's warning about transforms breaking
 * fixed-position descendants.
 */
export function FlightPathProgress({ fraction, label, origin, destination, waypoints = 0, stops, className = "" }: FlightPathProgressProps) {
  const f = Math.min(1, Math.max(0, fraction));
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : { duration: DURATION.reveal, ease: EASE.emphasized };
  const points = stops ? stops.map((s) => s.at).filter((at) => at > 0 && at < 1) : Array.from({ length: waypoints }, (_, i) => (i + 1) / (waypoints + 1));

  return (
    <div
      className={className}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
    >
      {stops && (
        <div className="relative h-3 text-2xs font-medium" aria-hidden>
          {stops.map((s) => (
            <span
              key={s.label}
              className={`absolute top-0 whitespace-nowrap transition-colors duration-300 ${s.wideOnly ? "hidden sm:block" : ""} ${s.at <= 0.02 ? "" : s.at >= 0.98 ? "-translate-x-full" : "-translate-x-1/2"} ${s.at <= f ? "text-ink" : "text-ink-faint"}`}
              style={{ left: `${s.at * 100}%` }}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="relative h-7" aria-hidden>
        {/* The way still to go: a plain rule. */}
        <div className="absolute inset-x-0 top-1/2 border-t border-border-strong" />
        {/* The part done: the green centreline. */}
        <motion.div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-good"
          initial={false}
          animate={{ width: `${f * 100}%` }}
          transition={transition}
        />
        {points.map((p) => (
          <div
            // Remounted as it's passed, so it's stamped once (Mark).
            key={`${p}-${p <= f}`}
            className={`absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 transition-colors duration-300 ${
              p <= f ? "waypoint-ping bg-good" : "bg-border-strong"
            }`}
            style={{ left: `${p * 100}%` }}
          />
        ))}
        {/* Where you are now: a small location sign on the line. */}
        <motion.div
          className="absolute top-1/2 -ml-[7px] -mt-[7px] h-[14px] w-[14px] rounded-[2px] bg-on-sign ring-2 ring-inset ring-sign"
          initial={false}
          animate={{ left: `${f * 100}%` }}
          transition={transition}
        />
      </div>
      {(origin || destination) && (
        <div className="mt-1 flex justify-between text-2xs text-ink-faint font-medium" aria-hidden>
          <span>{origin}</span>
          <span>{destination}</span>
        </div>
      )}
    </div>
  );
}
