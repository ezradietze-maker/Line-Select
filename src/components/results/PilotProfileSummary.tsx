"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { PreferenceProfile } from "@/types/preferences";

interface PilotProfileSummaryProps {
  profile: PreferenceProfile;
}

/**
 * "Here's what we learned about you" — the qualitative half of the
 * adaptive interview's output, as distinct from the measurable half
 * (which, once wired into scoring, already surfaces through each line's
 * own match bars and explanation text — see scoring.ts). A qualitative
 * fact never moves a score; this is the only place it's shown at all, so
 * it lives once, page-level, rather than per-line — genuinely different
 * from LineCard's own "Also factored in" panel, which is specifically
 * about why *one line* scored the way it did.
 *
 * Renders nothing for a profile with no qualitative facts (the legacy
 * static interview, or an adaptive interview that never surfaced anything
 * qualitative) rather than showing an empty shell.
 */
export function PilotProfileSummary({ profile }: PilotProfileSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const qualitativeFacts = [...profile.discoveredFacts]
    .filter((f) => f.kind === "qualitative")
    .sort((a, b) => b.importance - a.importance);

  if (qualitativeFacts.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div>
          <div className="text-sm font-semibold text-ink">What we learned about you</div>
          <p className="mt-0.5 text-xs text-ink-faint">
            {qualitativeFacts.length} thing{qualitativeFacts.length === 1 ? "" : "s"} from your interview that
            {qualitativeFacts.length === 1 ? " doesn't" : " don't"} show up as a number on any line, but are
            still worth knowing.
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
              <span>{f.statement}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
