import type { BidPeriodChangeSummary } from "@/lib/bid-period-history";

interface BidPeriodChangeBannerProps {
  summary: BidPeriodChangeSummary | null;
  /** Inside the results status panel: no card or heading of its own. */
  bare?: boolean;
}

/** Only ever states what's actually in storage from a genuinely different bid month — never a guess, and nothing to show at all on a pilot's first time here. */
export function BidPeriodChangeBanner({ summary, bare = false }: BidPeriodChangeBannerProps) {
  if (!summary) return null;

  return (
    <div className={bare ? "" : "mt-4 rounded-xl border border-border bg-surface p-4 shadow-elevated sm:p-5"}>
      {!bare && <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Since {summary.previousMonth}</div>}
      {summary.sameTopLine ? (
        <p className="mt-1 text-sm leading-relaxed text-ink">
          Line {summary.currentTopLine} is your top pick again this month &mdash; scored {summary.currentTopScore} now,
          {" "}
          {summary.previousTopScore} last time.
        </p>
      ) : (
        <p className="mt-1 text-sm leading-relaxed text-ink">
          Your top pick changed: Line {summary.currentTopLine} is #1 now (scored {summary.currentTopScore}).{" "}
          {summary.previousMonth}&rsquo;s top line, Line {summary.previousTopLine},{" "}
          {summary.previousTopLineNowRank
            ? `is #${summary.previousTopLineNowRank} this time.`
            : "isn't in this bid pack this time."}
        </p>
      )}
    </div>
  );
}
