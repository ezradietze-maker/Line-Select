"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { weekdayPlural } from "@/lib/scoring";
import type { PreferenceProfile } from "@/types/preferences";

interface PilotProfileSummaryProps {
  profile: PreferenceProfile;
}

/**
 * "Here's what we learned about you" — the qualitative half of the
 * adaptive interview's output, as distinct from the measurable half
 * (which, once wired into scoring, already surfaces through each line's
 * own Satisfaction Index breakdown and explanation text — see scoring.ts). A qualitative
 * fact never moves a score — except a dated or weekly commitment, which is
 * checked against every line and ranks a conflicting one lower (see
 * `commitmentPenalty`). This is the only place they're all shown, so
 * it lives once, page-level, rather than per-line — genuinely different
 * from LineCard's own "Also factored in" panel, which is specifically
 * about why *one line* scored the way it did.
 *
 * Open by default, not collapsed — this used to start closed, which meant
 * a pilot could scroll straight past it without ever seeing what they told
 * the interview came through. A fact tagged `recurringWeekday` gets its own
 * callout here too: it's the one kind of personal-life detail this app can
 * actually check against a line's real calendar (see
 * `recurringCommitmentConflictsForLine` in `scoring.ts`), not just repeat
 * back, and it's worth saying so up front rather than leaving that
 * connection to be discovered only by scrolling into a line that conflicts.
 *
 * Renders nothing for a profile with no qualitative facts (the legacy
 * static interview, or an adaptive interview that never surfaced anything
 * qualitative) rather than showing an empty shell.
 */
export function PilotProfileSummary({ profile }: PilotProfileSummaryProps) {
  const [expanded, setExpanded] = useState(true);

  const qualitativeFacts = [...profile.discoveredFacts]
    .filter((f) => f.kind === "qualitative")
    .sort((a, b) => b.importance - a.importance);

  if (qualitativeFacts.length === 0) return null;

  const checkedCount = qualitativeFacts.filter((f) => f.recurringWeekday || f.specificDates?.length).length;

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div>
          <div className="text-sm font-semibold text-ink">What we learned about you</div>
          <p className="mt-0.5 hidden text-xs text-ink-faint sm:block">
            {qualitativeFacts.length} thing{qualitativeFacts.length === 1 ? "" : "s"} from your interview that
            {qualitativeFacts.length === 1 ? " isn't a slider or score of its own" : " aren't a slider or score of their own"}, but{" "}
            {qualitativeFacts.length === 1 ? "is" : "are"} still worth knowing
            {checkedCount > 0 &&
              (qualitativeFacts.length === 1
                ? " — it's checked against each line's calendar below, and lines that conflict rank lower"
                : ` — ${checkedCount === 1 ? "one of them is" : `${checkedCount} of them are`} checked against each line's calendar below, and lines that conflict rank lower`)}
            .
          </p>
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <ul className="mt-4 space-y-2.5 border-t border-border pt-4">
          {qualitativeFacts.map((f) => (
            <li key={f.id} className="flex gap-2 text-sm text-ink-muted">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
              <span>
                {f.statement}
                {f.recurringWeekday && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    Checked against every line&rsquo;s {weekdayPlural(f.recurringWeekday)}
                  </span>
                )}
                {f.severity === "dealbreaker" && (!!f.recurringWeekday || !!f.specificDates?.length) && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">
                    Dealbreaker
                  </span>
                )}
                {!f.recurringWeekday && f.specificDates && f.specificDates.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    Checked against every line&rsquo;s calendar
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
