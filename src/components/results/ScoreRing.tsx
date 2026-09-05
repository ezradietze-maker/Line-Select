"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

function scoreTone(score: number): { stroke: string; text: string; track: string } {
  if (score >= 78) {
    return { stroke: "var(--color-good)", text: "text-good", track: "var(--color-good-soft)" };
  }
  if (score >= 55) {
    return { stroke: "var(--color-brand)", text: "text-brand", track: "var(--color-brand-soft)" };
  }
  return { stroke: "var(--color-warn)", text: "text-warn", track: "var(--color-warn-soft)" };
}

interface ScoreRingProps {
  score: number;
  size?: number;
}

export function ScoreRing({ score, size = 56 }: ScoreRingProps) {
  const tone = scoreTone(score);
  const strokeWidth = 4.5;
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, score));

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

  const offset = useTransform(animatedScore, (v) => circumference * (1 - v / 100));
  const roundedScore = useTransform(animatedScore, (v) => Math.round(v));

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Match score ${Math.round(score)} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.track}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums ${tone.text}`}>
        <motion.span>{roundedScore}</motion.span>
      </div>
    </div>
  );
}
