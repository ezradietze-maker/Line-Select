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
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);

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
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums ${tone.text}`}>
        {Math.round(score)}
      </div>
    </div>
  );
}
