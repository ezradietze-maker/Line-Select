"use client";

import { useState } from "react";
import type { FeasibilityTier, Strategy, StrategyLineRecommendation } from "@/types/strategy";

function VerificationBadge({ verification }: { verification: Strategy["verification"] }) {
  if (verification !== "pending-contract") return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn"
      title="This mechanism depends on specific contract/PBS language this app hasn't confirmed yet — built ahead of that confirmation on purpose, but not the same confidence level as a strategy read straight from your own bid pack's printed numbers."
    >
      Pending contract verification
    </span>
  );
}

function ScoreContextLine({ scoreContext }: { scoreContext: StrategyLineRecommendation["scoreContext"] }) {
  if (!scoreContext) return null;
  const { score, deltaFromTopPick } = scoreContext;
  if (deltaFromTopPick === 0) {
    return (
      <p className="mt-2 text-xs font-medium text-good">
        Scores {score} on your Satisfaction Index — already your current top pick.
      </p>
    );
  }
  const isAhead = deltaFromTopPick > 0;
  return (
    <p className={`mt-2 text-xs font-medium ${isAhead ? "text-good" : "text-ink-faint"}`}>
      Scores {score} on your Satisfaction Index — {Math.abs(deltaFromTopPick)} point
      {Math.abs(deltaFromTopPick) === 1 ? "" : "s"} {isAhead ? "above" : "below"} your current top
      pick.
    </p>
  );
}

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

/** Only rendered when a tier actually came from real, self-reported hold outcomes (see `estimateFeasibility`'s doc comment) — never shown for the seniority-vs-rarity heuristic, so a real read is never confused with an estimate. */
function AwardHistoryBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"
      title="Based on real, self-reported hold outcomes from pilots near your seniority for this exact base/aircraft/seat — not the usual rarity estimate."
    >
      Real reports
    </span>
  );
}

function LineRecommendationRow({ rec }: { rec: StrategyLineRecommendation }) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas/40 p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-mono text-sm font-semibold text-ink">Line {rec.lineNumber}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {rec.feasibilitySource === "award-history" && <AwardHistoryBadge />}
          <FeasibilityBadge tier={rec.feasibility} />
        </div>
      </div>
      <p className="mt-1.5 text-sm font-medium text-ink">{rec.headline}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{rec.detail}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5 font-mono text-[11px] text-ink-muted">
        <span className="rounded border border-hairline px-1.5 py-0.5">{rec.daysOff} days off</span>
        <span className="rounded border border-hairline px-1.5 py-0.5">{rec.totalCreditHours.toFixed(1)} credit hrs</span>
        <span className="rounded border border-hairline px-1.5 py-0.5">{(rec.totalTafbHours / 24).toFixed(1)} days away</span>
      </div>
      <ScoreContextLine scoreContext={rec.scoreContext} />
      <p className="mt-2 text-xs italic leading-relaxed text-ink-faint">{rec.feasibilityNote}</p>
    </div>
  );
}

function ReactionButtons({
  reaction,
  onReact,
}: {
  reaction: "used" | "dismissed" | null;
  onReact: (reaction: "used" | "dismissed") => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
      <span className="text-xs text-ink-faint">Actually going to try this?</span>
      <button
        type="button"
        onClick={() => onReact("used")}
        aria-pressed={reaction === "used"}
        className={`press rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
          reaction === "used"
            ? "border-good bg-good-soft text-good"
            : "border-border text-ink-faint hover:border-border-strong hover:text-ink-muted"
        }`}
      >
        I&rsquo;m using this
      </button>
      <button
        type="button"
        onClick={() => onReact("dismissed")}
        aria-pressed={reaction === "dismissed"}
        className={`press rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
          reaction === "dismissed"
            ? "border-ink-faint bg-canvas text-ink-muted"
            : "border-border text-ink-faint hover:border-border-strong hover:text-ink-muted"
        }`}
      >
        Not for me
      </button>
    </div>
  );
}

export function StrategyCard({
  strategy,
  topPick,
  reaction = null,
  onReact,
}: {
  strategy: Strategy;
  topPick?: boolean;
  /** This pilot's own prior reaction, if any — null when they haven't reacted yet, or when `onReact` isn't supplied at all (no profile to persist to). */
  reaction?: "used" | "dismissed" | null;
  /** Absent hides the reaction buttons entirely — there's no profile yet for a reaction to nudge. */
  onReact?: (reaction: "used" | "dismissed") => void;
}) {
  // The mechanism paragraph and benefit bullets are the "why this works" — worth having, not worth putting in front of someone scanning eleven strategies for the one that fits. Lines (the actual picks) stay visible; the explanation is one tap away. A process tip (trade, grievance, vacation) has no lines, so its explanation is its content — but it sits in its own "Bonus moves" bank with its tagline showing, so it starts closed too rather than making that bank several screens of prose.
  const [showHow, setShowHow] = useState(false);
  return (
    <article
      id={`strategy-${strategy.id}`}
      className={`panel-glass scroll-mt-24 overflow-hidden ${topPick ? "top-pick-glow !border-accent/50 ring-1 ring-accent/20" : ""}`}
    >
      {topPick && (
        <div className="flex items-center gap-1.5 border-b border-accent/20 bg-gradient-to-r from-accent-soft to-transparent px-5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent sm:px-6">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
            <path d="M12 2l2.6 6.5 7 .5-5.3 4.5 1.7 6.9L12 16.9 5.9 20.4l1.7-6.9L2.4 9l7-.5L12 2z" />
          </svg>
          Best match for you
        </div>
      )}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-xl font-semibold tracking-tight text-ink">{strategy.name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <VerificationBadge verification={strategy.verification} />
          </div>
        </div>
        <p className="mt-1 text-sm font-medium text-accent">{strategy.tagline}</p>
        {strategy.preferenceMatch && strategy.preferenceMatch.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">From your interview:</span>{" "}
            {strategy.preferenceMatch.join(" and ")}.
          </p>
        )}
        <button
          type="button"
          onClick={() => setShowHow((v) => !v)}
          aria-expanded={showHow}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
        >
          {showHow ? "Hide how this works" : "How this works"}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 transition-transform ${showHow ? "rotate-180" : ""}`} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {showHow && (
          <div className="animate-fade-in mt-3 border-l-2 border-hairline pl-4">
            <p className="text-sm leading-relaxed text-ink-muted">{strategy.mechanism}</p>
            <ul className="mt-3 space-y-1.5">
              {strategy.benefits.map((b) => (
                <li key={b} className="flex gap-2 text-sm text-ink-muted">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}

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

        {onReact && <ReactionButtons reaction={reaction} onReact={onReact} />}
      </div>
    </article>
  );
}
