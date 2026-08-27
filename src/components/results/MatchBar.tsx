import type { DimensionScore } from "@/lib/scoring";

const DIMENSION_LABELS: Record<DimensionScore["key"], string> = {
  daysOff: "Days off",
  tripLength: "Trip length",
  international: "International",
  cityPreference: "City preferences",
  reportTime: "Report time",
  creditHours: "Credit hours",
  deadheadTolerance: "Deadhead legs",
  departures: "Departures",
  layoverQuality: "Layover quality",
  circadianHealth: "Circadian health",
};

interface MatchBarProps {
  dimension: DimensionScore;
}

export function MatchBar({ dimension }: MatchBarProps) {
  const matchPct = Math.round(dimension.match * 100);
  const showsPreference = dimension.importance > 0.05;

  if (!dimension.verified) {
    return (
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-ink">
            {DIMENSION_LABELS[dimension.key]}
          </span>
          <span className="font-mono text-warn" title="This line's trips couldn't be confirmed, so this value is a rough estimate rather than a verified fact.">
            estimated
          </span>
        </div>
        <div
          className="mt-1.5 h-2 rounded-full bg-warn-soft"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--color-warn) 0, var(--color-warn) 3px, transparent 3px, transparent 7px)",
            opacity: 0.4,
          }}
          title="Estimated from this line's monthly totals, not a verified trip-by-trip breakdown"
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-ink">
          {DIMENSION_LABELS[dimension.key]}
        </span>
        <span className="font-mono text-ink-faint">
          {showsPreference ? `${matchPct}% match` : "not weighted"}
        </span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-brand-soft">
        <div
          className="h-2 rounded-full bg-brand transition-all"
          style={{ width: `${Math.round(dimension.value * 100)}%` }}
        />
        {showsPreference && (
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-accent"
            style={{ left: `${Math.round(dimension.target * 100)}%` }}
            title="Your target"
          />
        )}
      </div>
    </div>
  );
}
