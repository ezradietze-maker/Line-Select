"use client";

/** The box's ruled edge and number, by how good the score is: green for a strong fit, plain ink in the middle, amber low. */
function scoreTone(score: number): string {
  if (score >= 78) return "border-good text-good";
  if (score >= 55) return "border-ink text-ink";
  return "border-warn text-warn";
}

interface ScoreRingProps {
  score: number;
  size?: number;
  /** A violated dealbreaker holds this line's score down — a red bar along the box's foot says it can't go higher. */
  capped?: boolean;
  /** The pilot's top pick: the score is a location sign, yellow on black. */
  top?: boolean;
}

/**
 * A line's Satisfaction Index as a boxed score — a number in a ruled box, the way a strip prints it, coloured by how
 * good the score is. (The name stays from the round dial it replaced, so every screen picks the box up as it is.)
 */
export function ScoreRing({ score, size = 56, capped = false, top = false }: ScoreRingProps) {
  const rounded = Math.round(score);
  return (
    <div
      role="img"
      aria-label={`Satisfaction Index ${rounded} out of 100${capped ? ", held down by a limit you set" : ""}`}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] border-[1.5px] font-display font-extrabold tabular-nums leading-none ${
        top ? "border-sign bg-on-sign text-sign" : `bg-panel ${scoreTone(score)}`
      }`}
      style={{ width: Math.round(size * 1.05), height: Math.round(size * 0.78), fontSize: Math.round(size * 0.42) }}
    >
      <span aria-hidden>{rounded}</span>
      {capped && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-danger" />}
    </div>
  );
}
