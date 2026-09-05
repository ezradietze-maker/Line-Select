import { SATISFACTION_CATEGORIES } from "@/lib/satisfaction-categories";
import type { LineScore } from "@/lib/scoring";

interface CategoryBarsProps {
  categoryScores: LineScore["categoryScores"];
}

function toneFor(score: number): string {
  if (score >= 78) return "bg-good";
  if (score >= 55) return "bg-brand";
  return "bg-warn";
}

/**
 * The "in depth" half of the Satisfaction Index — a pilot glancing at one
 * overall number can't tell "excellent on home time, mediocre on pay" from
 * "fine everywhere." Computed from the exact same per-dimension data the
 * overall score uses (see `computeCategoryScores` in `scoring.ts`), just
 * partitioned — these bars are guaranteed to be consistent with, not a
 * second opinion on, the ring above them.
 */
export function CategoryBars({ categoryScores }: CategoryBarsProps) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {SATISFACTION_CATEGORIES.map((category) => {
        const { score, label } = categoryScores[category];
        return (
          <div key={category}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">{label}</span>
              <span className="font-mono text-ink-faint">{Math.round(score)}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-canvas">
              <div
                className={`h-1.5 rounded-full transition-all ${toneFor(score)}`}
                style={{ width: `${Math.round(score)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
