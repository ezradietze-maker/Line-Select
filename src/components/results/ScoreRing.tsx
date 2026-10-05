"use client";

import { Gauge, type GaugeTone } from "@/components/ui/Gauge";

function scoreTone(score: number): GaugeTone {
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

/** A line's Satisfaction Index on the shared `Gauge` instrument, colored by how good the score is. */
export function ScoreRing({ score, size = 56 }: ScoreRingProps) {
  return (
    <Gauge
      value={score}
      size={size}
      tone={scoreTone(score)}
      label={`Satisfaction Index ${Math.round(score)} out of 100`}
    />
  );
}
