"use client";

import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { MicButton } from "@/components/ui/MicButton";
import { STORY_TOPICS, storyDepth, storyTopicsMentioned } from "@/lib/interview-display";
import { useDictation } from "@/lib/use-speech-to-text";

interface BiddingStoryStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  busy: boolean;
  error: string | null;
  maxLength: number;
  eyebrow?: string;
}

const TITLE = "Walk us through your whole bidding process, start to finish.";

/**
 * The one open-ended question the rest of the interview is built around —
 * asked right after seniority, before commute status or anything else.
 * Everything real in here gets read once, closely, and folded into the
 * running profile before the adaptive loop's first question is even
 * chosen (see `runBiddingStoryExtraction` in `interview-turn-service.ts`)
 * — a topic this narrative already covers won't get asked about again from
 * scratch, and the pilot's own words here keep shaping how every later
 * question gets phrased for the rest of this interview.
 *
 * The area chips under the box light up as the story touches each one, by
 * plain keyword — encouragement to cover more ground, not extraction — and
 * the meter beside them fills by length and breadth together, slowly: the
 * stories that rank best run a page or so (see `storyDepth`).
 */
export function BiddingStoryStep({ value, onChange, onSubmit, onSkip, busy, error, maxLength, eyebrow }: BiddingStoryStepProps) {
  const reduce = useReducedMotion();
  const remaining = maxLength - value.length;
  const dictation = useDictation(value, (next) => onChange(next.slice(0, maxLength)));
  const mentioned = useMemo(() => storyTopicsMentioned(value), [value]);
  const depth = storyDepth(value);
  const area = useRef<HTMLTextAreaElement>(null);

  // Grows with the story, so a long answer reads as a page rather than a scroll box.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 224), 448)}px`;
  }, [value]);

  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={TITLE}
        help={
          <>
            What do you actually look for, in whatever order you think about it &mdash; days off, trips, legs, report times,
            layovers, pay, your commute, deadheads, your life outside the schedule &mdash; and what you&rsquo;d trade for what.
            Write it the way you&rsquo;d explain it to another pilot.{" "}
            <span className="font-medium text-accent">A page or so is not too much: everything here sharpens your ranking.</span>
          </>
        }
      />

      <RevealControls title={TITLE} className="mt-6">
        <div className="relative overflow-hidden rounded-xl border border-hairline bg-canvas/60 transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:shadow-[0_0_0_4px_var(--glow-soft)]">
          <textarea
            ref={area}
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
            disabled={busy}
            aria-label="Your bidding process, in your own words"
            placeholder="First thing I look at is how many days off a line has, and how they fall… (or tap the mic and just say it)"
            className="block w-full resize-none bg-transparent px-4 py-4 pr-14 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-70"
          />
          {dictation.supported && (
            <MicButton listening={dictation.listening} onClick={dictation.toggle} className="absolute right-3 top-3" />
          )}
          {/* While the story is being read: a read head passing over it. */}
          {busy && !reduce && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-[var(--glow-soft)] to-transparent"
              initial={{ top: "-15%" }}
              animate={{ top: "105%" }}
              transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
            />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2" aria-live="polite">
          <div className="flex items-center gap-2.5">
            <span className="flex gap-0.5" aria-hidden>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className={`h-1.5 w-5 rounded-full transition-colors duration-500 ${n <= depth.level ? "bg-accent" : "bg-border-strong"}`} />
              ))}
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">{depth.label || "Your story"}</span>
          </div>
          <span className="font-mono text-[10.5px] text-ink-faint">
            {depth.areas} of {STORY_TOPICS.length} areas
            {remaining < 500 && <> · {remaining.toLocaleString()} characters left</>}
          </span>
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Areas your story covers so far">
          {STORY_TOPICS.map((t) => {
            const on = mentioned.has(t.id);
            return (
              <li
                key={t.id}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-all duration-300 ${
                  on ? "border-accent/50 bg-accent-soft text-accent" : "border-hairline text-ink-faint"
                }`}
              >
                {on && <span aria-hidden>✓ </span>}
                {t.label}
                <span className="sr-only">{on ? " — covered" : " — not yet"}</span>
              </li>
            );
          })}
        </ul>
        {dictation.error && <p className="mt-2 text-xs text-danger">{dictation.error}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-8 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted disabled:opacity-60"
          >
            Skip &mdash; I&rsquo;ll answer as I go
          </button>
          <Button type="button" onClick={onSubmit} disabled={busy || value.trim().length === 0} className="sm:px-7">
            {busy ? "Reading your story…" : "Continue"}
          </Button>
        </div>
        {value.trim().length === 0 && !busy && (
          <p className="mt-2 text-xs text-ink-faint">Skipping still works &mdash; you&rsquo;ll just get a more generic interview from here.</p>
        )}
      </RevealControls>
    </div>
  );
}
