"use client";

import { Heading } from "@/components/ui/Heading";
import type { PreferenceFact } from "@/types/interview-session";

/**
 * Shown once, right before the turn loop starts, only when a prior
 * completed profile exists for this pilot — the "don't start from zero"
 * screen. Deliberately not a full re-ask: a short, skimmable list of the
 * prior cycle's highest-confidence facts with one still-true/changed toggle
 * each, plus a single open life-event flag. Facts left "still true" (the
 * default) get folded straight into this cycle's starting context; anything
 * toggled "changed" is handed to the turn loop instead of the model, which
 * asks about it directly in its own voice rather than a hardcoded question
 * here doing that job worse.
 */

const LIFE_EVENT_QUICK_TAGS = ["New baby", "Moved", "New commute", "Second job"];

interface ReturningPilotCheckStepProps {
  topFacts: PreferenceFact[];
  changedFactIds: Set<string>;
  onToggleFact: (factId: string) => void;
  otherFactCount: number;
  lifeEvent: string;
  onLifeEventChange: (text: string) => void;
}

export function ReturningPilotCheckStep({
  topFacts,
  changedFactIds,
  onToggleFact,
  otherFactCount,
  lifeEvent,
  onLifeEventChange,
}: ReturningPilotCheckStepProps) {
  return (
    <div>
      <Heading as="h2" className="text-xl text-ink sm:text-2xl">
        Welcome back — still the same picture?
      </Heading>
      <p className="mt-1.5 text-sm text-ink-muted">
        Quick check on what mattered most last cycle before we get into anything new. Leave
        anything that&rsquo;s still accurate alone &mdash; only flag what&rsquo;s actually changed.
      </p>

      <div className="mt-6 space-y-2">
        {topFacts.map((fact) => {
          const changed = changedFactIds.has(fact.id);
          return (
            <div
              key={fact.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-canvas px-3.5 py-2.5"
            >
              <span className="text-sm text-ink">{fact.statement}</span>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => changed && onToggleFact(fact.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    !changed
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  Still true
                </button>
                <button
                  type="button"
                  onClick={() => !changed && onToggleFact(fact.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    changed
                      ? "border-warn bg-warn-soft text-warn"
                      : "border-border text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  Something&rsquo;s changed
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {otherFactCount > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          Everything else from last cycle carries forward as-is — flag it above only if
          something here needs a second look.
        </p>
      )}

      <div className="mt-6 border-t border-border pt-5">
        <div className="text-sm font-medium text-ink">Anything change since last time?</div>
        <p className="mt-1 text-xs text-ink-muted">
          Optional — a new baby, a move, a different commute, whatever. This helps the
          questions below actually focus on what&rsquo;s relevant now.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {LIFE_EVENT_QUICK_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onLifeEventChange(lifeEvent === tag ? "" : tag)}
              className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-all ${
                lifeEvent === tag
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        <textarea
          value={LIFE_EVENT_QUICK_TAGS.includes(lifeEvent) ? "" : lifeEvent}
          onChange={(e) => onLifeEventChange(e.target.value)}
          placeholder="Or describe it in your own words…"
          rows={2}
          className="mt-3 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
      </div>
    </div>
  );
}
