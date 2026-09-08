/**
 * One small, consistent indicator for everything accumulating onto a line
 * beyond the score itself and an outright dealbreaker violation (which stays
 * on `DealbreakerBanner`'s own always-visible, danger-colored banner — a
 * real safety/trust signal that shouldn't get quieter just because more
 * features have landed since it was built). This badge covers the newer,
 * softer signals — a dealbreaker near-miss, a compounding circadian-recovery
 * risk — as one "N things worth a closer look" pill rather than one banner
 * per feature. Deliberately excludes per-line sensitivity (`mostLeveragedDimension`):
 * almost every line that isn't a perfect match has SOME leveraged dimension,
 * so treating that as a "flag" here would fire on nearly every card and stop
 * meaning anything — it's already surfaced as prose in the counterfactual
 * text instead.
 */

interface LineInsightBadgeProps {
  nearMissCount: number;
  hasCircadianRisk: boolean;
  onClick: () => void;
}

export function LineInsightBadge({ nearMissCount, hasCircadianRisk, onClick }: LineInsightBadgeProps) {
  const flagCount = nearMissCount + (hasCircadianRisk ? 1 : 0);
  if (flagCount === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 rounded-md border border-warn/30 bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn transition-colors hover:border-warn/50"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      </svg>
      {flagCount} thing{flagCount > 1 ? "s" : ""} worth a closer look
    </button>
  );
}
