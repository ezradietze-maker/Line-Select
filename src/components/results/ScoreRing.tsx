"use client";

import { formatIndex } from "@/lib/satisfaction-index";

/**
 * The box's ruled edge and number, by how good the score is: green for a strong fit, plain ink in the middle, amber low.
 * A line's Satisfaction Index reads its pack's best line in the high 90s and its middle about 50 (`lib/satisfaction-index.ts`),
 * so its bands sit higher and wider than a trip's or an open trip's fit, which are absolute.
 */
function scoreTone(score: number, index: boolean): string {
  if (score >= (index ? 80 : 78)) return "border-good text-good";
  if (score >= (index ? 45 : 55)) return "border-ink text-ink";
  return "border-warn text-warn";
}

interface ScoreRingProps {
  score: number;
  size?: number;
  /** A violated dealbreaker holds this line's score down — a red bar along the box's foot says it can't go higher. */
  capped?: boolean;
  /** The pilot's top pick: the score is a location sign, yellow on black. */
  top?: boolean;
  /** A line's Satisfaction Index: shown to one decimal, which sets apart lines a whole number would show as a tie. */
  index?: boolean;
  /** With `index`, a trip's score: the Trip Index, as Trip Rankings names it, not a line's Satisfaction Index. */
  trip?: boolean;
}

/**
 * A line's Satisfaction Index as a boxed score — a number in a ruled box, the way a strip prints it, coloured by how
 * good the score is. (The name stays from the round dial it replaced, so every screen picks the box up as it is.)
 */
export function ScoreRing({ score, size = 56, capped = false, top = false, index = false, trip = false }: ScoreRingProps) {
  const shown = index ? formatIndex(score) : String(Math.round(score));
  return (
    <div
      role="img"
      aria-label={`${index ? (trip ? "Trip Index" : "Satisfaction Index") : "Score"} ${shown} out of 100${capped ? ", held down by a limit you set" : ""}`}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] border-[1.5px] font-display font-extrabold tabular-nums leading-none ${
        top ? "border-sign bg-on-sign text-sign" : `bg-panel ${scoreTone(score, index)}`
      }`}
      // Wide enough for "100.0" when it carries a decimal.
      style={{ width: Math.round(size * (index ? 1.5 : 1.05)), height: Math.round(size * 0.78), fontSize: Math.round(size * (index ? 0.38 : 0.42)) }}
    >
      <span aria-hidden>{shown}</span>
      {capped && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-danger" />}
    </div>
  );
}
