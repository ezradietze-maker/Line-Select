"use client";

import { useId, useState } from "react";
import { ScoreRing } from "@/components/results/ScoreRing";
import { ChevronDownIcon } from "@/components/ui/icons";
import { tripValueText, type TripCriterionResult, type TripScore } from "@/lib/scoring-v2/trip-score";

/** Pulls smaller than this (score points) aren't worth naming in the one-line summary. */
const NOTABLE = 0.5;

const named = (r: TripCriterionResult) => {
  const v = tripValueText(r);
  return v ? `${r.label} (${v})` : r.label;
};

function summary(s: TripScore): string {
  if (s.violations.length) return `Breaks your dealbreaker: ${s.violations.map((v) => v.label).join(", ")}.`;
  const ups = s.results.filter((r) => r.contribution >= NOTABLE).sort((a, b) => b.contribution - a.contribution).slice(0, 2);
  const down = s.results.filter((r) => r.contribution <= -NOTABLE).sort((a, b) => a.contribution - b.contribution)[0];
  const parts: string[] = [];
  if (ups.length) parts.push(`Strong for you on ${ups.map(named).join(" and ")}.`);
  if (down) parts.push(`Weaker on ${named(down)}.`);
  return parts.join(" ") || "About average for you on everything you care about.";
}

/**
 * The trip's own score for this pilot — from the same priorities that rank their lines — with what drives it, one tap
 * away. Counts a line adds up over a month (commutes, red-eyes, nights worked) are the trip's own, set against the
 * pack's other trips, so the panel says so; priorities one trip can't show (days off) are named rather than dropped.
 */
export function TripScorePanel({ score }: { score: TripScore }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = [...score.results].sort((a, b) => b.weight - a.weight);
  const totalWeight = rows.reduce((a, r) => a + r.weight, 0) || 1;
  const hasCounts = rows.some((r) => r.reading === "count");
  return (
    <div className="mt-2 rounded-lg border border-hairline bg-canvas/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-3 px-2.5 py-2 text-left"
      >
        <ScoreRing score={score.score} size={40} capped={score.violations.length > 0} />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Trip score for you</span>
          <span className={`block text-xs leading-snug ${score.violations.length ? "text-danger" : "text-ink-muted"}`}>{summary(score)}</span>
        </span>
        <ChevronDownIcon className={`h-3 w-3 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id} className="border-t border-hairline px-3 pb-3 pt-2">
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.criterionId}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 flex-1 text-ink">{r.label}</span>
                  <span className="max-w-[50%] text-right font-mono text-[11px] text-ink-muted">{tripValueText(r) ?? "—"}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-accent-soft" title={`${Math.round(Math.max(0, r.utility) * 100)}% of what you want`}>
                    <div className={`h-full rounded-full ${r.utility >= 0.66 ? "bg-good" : r.utility >= 0.33 ? "bg-accent" : "bg-warn"}`} style={{ width: `${Math.max(2, Math.min(1, Math.max(0, r.utility)) * 100)}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-faint">{Math.round((r.weight / totalWeight) * 100)}%</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Scored on the same priorities that rank your lines; the % is how much each one counts on this trip.
            {hasCounts && " Things a line adds up over the month — commutes, red-eyes, nights worked — count as this trip’s own, against the pack’s other trips; a monthly number you gave sits at the same place among trips as among lines."}
            {score.notApplicable.length > 0 && ` ${score.notApplicable.map((n) => n.label).join(" and ")} ${score.notApplicable.length === 1 ? "depends" : "depend"} on how a line strings its trips together, so ${score.notApplicable.length === 1 ? "it counts" : "they count"} in the line’s score, not a trip’s.`}
          </p>
        </div>
      )}
    </div>
  );
}
