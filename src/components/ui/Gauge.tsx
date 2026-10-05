"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

/**
 * A 270° dial with a gap at the bottom — the classic altimeter/airspeed
 * layout — rather than a full 360° ring, so it reads as a real instrument
 * rather than a generic web progress bar. Angle convention throughout this
 * file: degrees clockwise from straight up (12 o'clock), which is both the
 * natural way to reason about "a gap at the bottom" and exactly what SVG's
 * own `rotate()` expects, so the two never need separate math.
 */
const GAUGE_START = -135;
const GAUGE_SWEEP = 270;

function polarPoint(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/** The gauge's own arc, from its zero point to its full-scale point — drawn once and reused for both the static track and (via the dash trick below) the live fill. */
function arcPath(cx: number, cy: number, r: number): string {
  const [x1, y1] = polarPoint(cx, cy, r, GAUGE_START);
  const [x2, y2] = polarPoint(cx, cy, r, GAUGE_START + GAUGE_SWEEP);
  // Sweep flag 1 = clockwise, matching this file's angle convention; the arc flag is fixed since 270° is always "the long way around" (>180°).
  return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;
}

const MAJOR_TICKS = [0, 0.25, 0.5, 0.75, 1];
const MINOR_TICKS = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9];

export interface GaugeTone {
  /** The live fill. */
  stroke: string;
  /** The unfilled track. */
  track: string;
  /** Tailwind text class for the readout. */
  text: string;
}

interface GaugeProps {
  value: number;
  max?: number;
  size?: number;
  tone: GaugeTone;
  /** Spoken description of the reading, e.g. "Satisfaction Index 82 out of 100". */
  label: string;
  /** A hard limit on the scale, drawn as a red tick — e.g. the score a dealbreaker caps a line at. */
  limit?: number;
  /** Readout text classes (size/weight); color comes from `tone.text`. */
  readoutClassName?: string;
}

/**
 * The instrument behind every score dial in the app. The arc and the
 * readout are driven by one spring, so they can never visibly disagree
 * mid-change, and it starts from zero so a first appearance sweeps up to
 * its reading. Reduced motion: it simply shows the reading.
 */
export function Gauge({ value, max = 100, size = 56, tone, label, limit, readoutClassName = "text-sm font-semibold" }: GaugeProps) {
  const clamped = Math.min(max, Math.max(0, value));

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = Math.max(4, size / 14);
  const showMinorTicks = size >= 64;
  const majorTickLen = size < 64 ? 2.5 : size / 13;
  const minorTickLen = size < 64 ? 1.5 : size / 22;
  const tickGap = 1;
  // Leaves exactly enough room between the arc and the viewBox edge for the longest tick, so nothing clips.
  const radius = size / 2 - strokeWidth / 2 - tickGap - majorTickLen - 0.5;
  const tickOuter = radius + strokeWidth / 2 + tickGap;

  const reduceMotion = useReducedMotion();
  const animated = useSpring(0, { stiffness: 100, damping: 20 });
  useEffect(() => {
    if (reduceMotion) animated.jump(clamped);
    else animated.set(clamped);
  }, [clamped, reduceMotion, animated]);

  const trackPath = arcPath(cx, cy, radius);
  const arcLength = (radius * (GAUGE_SWEEP * Math.PI)) / 180;
  const dashOffset = useTransform(animated, (v) => arcLength * (1 - v / max));
  const rounded = useTransform(animated, (v) => Math.round(v));

  function tick(fraction: number, len: number, key: string, stroke: string, width: number) {
    const angle = GAUGE_START + fraction * GAUGE_SWEEP;
    const [x1, y1] = polarPoint(cx, cy, tickOuter, angle);
    const [x2, y2] = polarPoint(cx, cy, tickOuter + len, angle);
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={width} strokeLinecap="round" />;
  }

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {MAJOR_TICKS.map((f) => tick(f, majorTickLen, `M${f}`, "var(--color-border-strong)", 1.2))}
        {showMinorTicks && MINOR_TICKS.map((f) => tick(f, minorTickLen, `m${f}`, "var(--color-border-strong)", 0.8))}
        <path d={trackPath} fill="none" stroke={tone.track} strokeWidth={strokeWidth} strokeLinecap="round" />
        <motion.path
          d={trackPath}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={arcLength}
          style={{ strokeDashoffset: dashOffset }}
        />
        {limit !== undefined &&
          (() => {
            // A limit tick crosses the whole arc, inside to out, so it reads as a hard stop rather than one more scale mark.
            const angle = GAUGE_START + (Math.min(max, Math.max(0, limit)) / max) * GAUGE_SWEEP;
            const [x1, y1] = polarPoint(cx, cy, radius - strokeWidth, angle);
            const [x2, y2] = polarPoint(cx, cy, tickOuter + majorTickLen, angle);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-danger)" strokeWidth={2} strokeLinecap="round" />;
          })()}
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center font-mono tabular-nums ${tone.text} ${readoutClassName}`} aria-hidden>
        <motion.span>{rounded}</motion.span>
      </div>
    </div>
  );
}
