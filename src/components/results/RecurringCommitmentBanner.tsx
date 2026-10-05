import { weekdayPlural, type DateCommitmentConflict, type RecurringCommitmentConflict } from "@/lib/scoring";

interface RecurringCommitmentBannerProps {
  conflicts: RecurringCommitmentConflict[];
  /** One-off dates the pilot needs off that this line works (see `dateCommitmentConflictsForLine`). Absent from older callers. */
  dateConflicts?: DateCommitmentConflict[];
  /** Total points the line's score lost for these (see `commitmentPenalty`). */
  penalty?: number;
}

/** "Oct 14" / "Oct 14, 15" — short enough for a banner line, from the YYYY-MM-DD dates. */
function shortDates(dates: string[]): string {
  return dates
    .map((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }))
    .join(", ");
}

/**
 * Deliberately always visible — never behind an expand toggle, same
 * posture as `DealbreakerBanner`. Warn (amber), not danger (red): unlike a
 * violated dealbreaker this doesn't cap the Satisfaction Index, it takes a
 * measured number of points off (`commitmentPenalty` in `scoring.ts`), since
 * the pilot may still trade the conflicting trip away. The banner says how
 * many, so the drop in rank is never a mystery. A fully clear line shows
 * nothing here — only a genuine conflict is worth a banner.
 */
export function RecurringCommitmentBanner({ conflicts, dateConflicts = [], penalty = 0 }: RecurringCommitmentBannerProps) {
  if (conflicts.length === 0 && dateConflicts.length === 0) return null;

  return (
    <div className="border-b border-warn/30 bg-warn-soft px-5 py-2.5 sm:px-6">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mt-0.5 h-4 w-4 shrink-0 text-warn">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 7v5l3.5 2" />
        </svg>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-warn">
            Conflicts with something you mentioned
            {penalty > 0 && <span className="font-normal normal-case tracking-normal"> &middot; ranked {Math.round(penalty)} points lower</span>}
          </div>
          <ul className="mt-1 space-y-0.5">
            {conflicts.map((c) => (
              <li key={c.factId} className="text-sm leading-relaxed text-warn">
                Flying on {c.conflictCount} of {c.totalOccurrences} {weekdayPlural(c.weekday)} this month &mdash; you mentioned:
                &ldquo;{c.statement}&rdquo;
              </li>
            ))}
            {dateConflicts.map((c) => (
              <li key={c.factId} className="text-sm leading-relaxed text-warn">
                Working {shortDates(c.conflictDates)}
                {c.datesInPeriod.length > c.conflictDates.length &&
                  ` (off ${shortDates(c.datesInPeriod.filter((d) => !c.conflictDates.includes(d)))})`}
                {" "}&mdash; you mentioned: &ldquo;{c.statement}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
