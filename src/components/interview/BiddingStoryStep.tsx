"use client";

import { Heading } from "@/components/ui/Heading";

interface BiddingStoryStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  busy: boolean;
  error: string | null;
  maxLength: number;
}

/**
 * The one open-ended question the rest of the interview is built around —
 * asked right after seniority, before commute status or anything else.
 * Everything real in here gets read once, closely, and folded into the
 * running profile before the adaptive loop's first question is even
 * chosen (see `runBiddingStoryExtraction` in `interview-turn-service.ts`)
 * — a topic this narrative already covers won't get asked about again from
 * scratch, and the pilot's own words here keep shaping how every later
 * question gets phrased for the rest of this interview.
 */
export function BiddingStoryStep({ value, onChange, onSubmit, onSkip, busy, error, maxLength }: BiddingStoryStepProps) {
  const remaining = maxLength - value.length;
  return (
    <div>
      <Heading as="h2" className="text-xl text-ink sm:text-2xl">
        Walk us through your whole bidding process, start to finish.
      </Heading>
      <p className="mt-1.5 text-sm text-ink-muted">
        What do you actually look for, in whatever order you actually think about it — days off, trip length, layovers,
        pay, your commute, your life outside the schedule, all of it. Write it the way you&rsquo;d explain it to another
        pilot, not a form.
      </p>
      <p className="mt-2 text-sm font-medium text-brand">
        The more detail you give here, the better the rest of this interview &mdash; and your results &mdash; will be.
      </p>

      <div className="mt-6">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          disabled={busy}
          rows={10}
          placeholder="I usually start by looking at how many days off a line has, then..."
          className="w-full rounded-lg border border-border bg-canvas px-3.5 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:opacity-60"
        />
        <div className="mt-1.5 flex items-center justify-between text-xs text-ink-faint">
          <span>{value.trim().length === 0 ? "" : `${value.trim().length.toLocaleString()} characters`}</span>
          {remaining < 500 && <span>{remaining.toLocaleString()} left</span>}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted disabled:opacity-60"
        >
          Skip &mdash; I&rsquo;ll answer as I go instead
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || value.trim().length === 0}
          className="rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {busy ? "Reading through this…" : "Continue"}
        </button>
      </div>
      {value.trim().length === 0 && !busy && (
        <p className="mt-2 text-xs text-ink-faint">Skipping still works &mdash; you&rsquo;ll just get a more generic interview from here.</p>
      )}
    </div>
  );
}
