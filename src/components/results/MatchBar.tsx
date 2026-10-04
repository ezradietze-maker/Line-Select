import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";
import type { DimensionKey, DimensionScore } from "@/lib/scoring";

const FIXED_DIMENSION_LABELS: Record<DimensionKey, string> = {
  daysOff: "Days off",
  tripLength: "Trip length",
  international: "International",
  cityPreference: "City preferences",
  reportTime: "Report time",
  creditHours: "Credit hours",
  deadheadTolerance: "Deadhead legs",
  dutyPeriods: "Duty periods",
  layoverQuality: "Layover quality",
  circadianHealth: "Circadian health",
  landings: "Landings",
  hotelStandby: "Hotel standby",
};

/** `IMPLICIT_VARIABLES`-derived label for a dimension key not in the fixed set — see `DimensionScore.key`'s own doc comment for why the two kinds share one field. Falls back to the raw key itself in the (should-never-happen) case of a truly unknown id, rather than rendering blank. */
const IMPLICIT_LABELS = new Map(IMPLICIT_VARIABLES.map((v) => [v.id, v.label] as const));

function labelFor(key: DimensionScore["key"]): string {
  return FIXED_DIMENSION_LABELS[key as DimensionKey] ?? IMPLICIT_LABELS.get(key) ?? key;
}

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
            {labelFor(dimension.key)}
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
          {labelFor(dimension.key)}
        </span>
        <span className="font-mono text-ink-faint">
          {showsPreference ? `${matchPct}% aligned` : "not weighted"}
        </span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-brand-soft shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]">
        {/* Graduation marks at the quarter points — a plain flat bar reads as a web progress indicator; a scaled one reads as an instrument. */}
        <div className="absolute inset-0" aria-hidden>
          {[25, 50, 75].map((pct) => (
            <span key={pct} className="absolute inset-y-0 w-px bg-ink/10" style={{ left: `${pct}%` }} />
          ))}
        </div>
        <div
          className="relative h-2 rounded-full bg-gradient-to-b from-brand-strong to-brand transition-all"
          style={{ width: `${Math.round(dimension.value * 100)}%` }}
        />
        {showsPreference && (
          <div
            className="absolute top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-accent shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
            style={{ left: `${Math.round(dimension.target * 100)}%` }}
            title="Your target"
          />
        )}
      </div>
    </div>
  );
}
