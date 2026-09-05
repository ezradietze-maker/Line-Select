import type { FeasibilityTier, Strategy, StrategyLineRecommendation } from "@/types/strategy";

const FEASIBILITY_STYLE: Record<FeasibilityTier, string> = {
  strong: "border-good/30 bg-good-soft text-good",
  possible: "border-accent/30 bg-accent-soft text-accent",
  longshot: "border-border-strong text-ink-faint",
};

const FEASIBILITY_LABEL: Record<FeasibilityTier, string> = {
  strong: "Strong odds",
  possible: "Possible",
  longshot: "Long shot",
};

function FeasibilityBadge({ tier }: { tier: FeasibilityTier }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${FEASIBILITY_STYLE[tier]}`}
    >
      {FEASIBILITY_LABEL[tier]}
    </span>
  );
}

function LineRecommendationRow({ rec }: { rec: StrategyLineRecommendation }) {
  return (
    <div className="rounded-lg border border-border bg-canvas p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm font-semibold text-ink">Line {rec.lineNumber}</div>
        <FeasibilityBadge tier={rec.feasibility} />
      </div>
      <p className="mt-1.5 text-sm font-medium text-ink">{rec.headline}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{rec.detail}</p>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
        <span>{rec.daysOff} days off</span>
        <span>{rec.totalCreditHours.toFixed(1)} credit hrs</span>
        <span>{(rec.totalTafbHours / 24).toFixed(1)} days away</span>
      </div>
      <p className="mt-2 text-xs italic leading-relaxed text-ink-faint">{rec.feasibilityNote}</p>
    </div>
  );
}

export function StrategyCard({ strategy, topPick }: { strategy: Strategy; topPick?: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-surface ${
        topPick ? "border-dispatch/40 ring-1 ring-dispatch/20" : "border-border"
      }`}
    >
      {topPick && (
        <div className="flex items-center gap-1.5 bg-dispatch-soft px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-dispatch sm:px-6">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
            <path d="M12 2l2.6 6.5 7 .5-5.3 4.5 1.7 6.9L12 16.9 5.9 20.4l1.7-6.9L2.4 9l7-.5L12 2z" />
          </svg>
          Best match for you
        </div>
      )}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">{strategy.name}</h2>
          {!topPick && strategy.isProcessTip && (
            <span className="inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-xs font-medium text-ink-faint">
              Bonus move
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-brand">{strategy.tagline}</p>
        {strategy.preferenceMatch && strategy.preferenceMatch.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">From your interview:</span>{" "}
            {strategy.preferenceMatch.join(" and ")}.
          </p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{strategy.mechanism}</p>

        <ul className="mt-3 space-y-1.5">
          {strategy.benefits.map((b) => (
            <li key={b} className="flex gap-2 text-sm text-ink-muted">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
              {b}
            </li>
          ))}
        </ul>

        {strategy.lines.length > 0 && (
          <div className="mt-4 space-y-2.5">
            {strategy.lines.map((rec) => (
              <LineRecommendationRow key={rec.lineNumber} rec={rec} />
            ))}
          </div>
        )}

        {!strategy.isProcessTip && strategy.lines.length === 0 && (
          <p className="mt-4 text-sm text-ink-faint">
            No line in this bid pack clears this pattern strongly enough to recommend — nothing
            here rises to a real edge this month.
          </p>
        )}
      </div>
    </div>
  );
}
