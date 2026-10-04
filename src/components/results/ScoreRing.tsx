"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

/**
 * A 270° dial with a gap at the bottom — the classic altimeter/airspeed
 * layout — rather than a full 360° ring, so this reads as a real instrument
 * rather than a generic web progress bar. Angle convention throughout this
 * file: degrees clockwise from straight up (12 o'clock), which is both the
 * natural way to reason about "a gap at the bottom" and exactly what SVG's
 * own `rotate()` expects, so the two never need separate math.
 */
const GAUGE_START = -135;
const GAUGE_SWEEP = 270;

function scoreTone(score: number): { stroke: string; text: string; track: string } {
  if (score >= 78) {
    return { stroke: "var(--color-good)", text: "text-good", track: "var(--color-good-soft)" };
  }
  if (score >= 55) {
    return { stroke: "var(--color-brand)", text: "text-brand", track: "var(--color-brand-soft)" };
  }
  return { stroke: "var(--color-warn)", text: "text-warn", track: "var(--color-warn-soft)" };
}

function angleForValue(value: number): number {
  return GAUGE_START + (Math.max(0, Math.min(100, value)) / 100) * GAUGE_SWEEP;
}

function polarPoint(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/** The gauge's own arc, from its zero point to its hundred point — drawn once and reused for both the static track and (via the dash trick below) the live progress fill. */
function arcPath(cx: number, cy: number, r: number): string {
  const [x1, y1] = polarPoint(cx, cy, r, GAUGE_START);
  const [x2, y2] = polarPoint(cx, cy, r, GAUGE_START + GAUGE_SWEEP);
  // Sweep flag 1 = clockwise, matching this file's angle convention; the arc flag is fixed since 270° is always "the long way around" (>180°).
  return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;
}

const MAJOR_TICKS = [0, 25, 50, 75, 100];
const MINOR_TICKS = [10, 20, 30, 40, 60, 70, 80, 90];

interface ScoreRingProps {
  score: number;
  size?: number;
}

export function ScoreRing({ score, size = 56 }: ScoreRingProps) {
  const tone = scoreTone(score);
  const clamped = Math.min(100, Math.max(0, score));

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 4;
  const showMinorTicks = size >= 64;
  const majorTickLen = size < 64 ? 2.5 : 5;
  const minorTickLen = size < 64 ? 1.5 : 3;
  const tickGap = 1;
  // Leaves exactly enough room between the arc and the viewBox edge for the longest tick, so nothing clips.
  const radius = size / 2 - strokeWidth / 2 - tickGap - majorTickLen - 0.5;
  const tickOuter = radius + strokeWidth / 2 + tickGap;

  // The ring and the numeric label are driven by one animated value instead
  // of the ring's own CSS transition plus a label that snaps instantly —
  // that split is what used to make them visibly disagree mid-rescore.
  // Starting the spring at 0 also gives a real reveal on first mount, since
  // there's no prior score to have already been showing.
  const reduceMotion = useReducedMotion();
  const animatedScore = useSpring(0, { stiffness: 100, damping: 20 });
  useEffect(() => {
    if (reduceMotion) {
      animatedScore.jump(clamped);
    } else {
      animatedScore.set(clamped);
    }
  }, [clamped, reduceMotion, animatedScore]);

  const trackPath = arcPath(cx, cy, radius);
  const arcLength = (radius * (GAUGE_SWEEP * Math.PI)) / 180;
  const dashOffset = useTransform(animatedScore, (v) => arcLength * (1 - v / 100));
  const roundedScore = useTransform(animatedScore, (v) => Math.round(v));

  function renderTick(value: number, major: boolean) {
    const angle = angleForValue(value);
    const len = major ? majorTickLen : minorTickLen;
    const [x1, y1] = polarPoint(cx, cy, tickOuter, angle);
    const [x2, y2] = polarPoint(cx, cy, tickOuter + len, angle);
    return (
      <line
        key={`${major ? "M" : "m"}${value}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-border-strong)"
        strokeWidth={major ? 1.2 : 0.8}
        strokeLinecap="round"
      />
    );
  }

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Satisfaction Index ${Math.round(score)} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {MAJOR_TICKS.map((v) => renderTick(v, true))}
        {showMinorTicks && MINOR_TICKS.map((v) => renderTick(v, false))}
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
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums ${tone.text}`}>
        <motion.span>{roundedScore}</motion.span>
      </div>
    </div>
  );
}
