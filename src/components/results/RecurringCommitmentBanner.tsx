import type { RecurringCommitmentConflict } from "@/lib/scoring";

interface RecurringCommitmentBannerProps {
  conflicts: RecurringCommitmentConflict[];
}

/**
 * Deliberately always visible — never behind an expand toggle, same
 * posture as `DealbreakerBanner`. Warn (amber), not danger (red): unlike a
 * violated dealbreaker this never caps the Satisfaction Index — it's a
 * real personal commitment the pilot told the interview about, checked for
 * real against this line's own calendar (see
 * `recurringCommitmentConflictsForLine` in `scoring.ts`), surfaced as its
 * own thing rather than silently folded into a number. A fully clear line
 * shows nothing here — only a genuine conflict is worth a banner.
 */
export function RecurringCommitmentBanner({ conflicts }: RecurringCommitmentBannerProps) {
  if (conflicts.length === 0) return null;

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
          </div>
          <ul className="mt-1 space-y-0.5">
            {conflicts.map((c) => (
              <li key={c.factId} className="text-sm leading-relaxed text-warn">
                Flying on {c.conflictCount} of {c.totalOccurrences} {c.weekday}s this month &mdash; you mentioned:
                &ldquo;{c.statement}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
