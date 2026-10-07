"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { EASE } from "@/lib/motion-tokens";
import type { PreferenceFact } from "@/types/interview-session";

interface StoryReviewStepProps {
  facts: PreferenceFact[];
  onRemove: (factId: string) => void;
  onRestore: (facts: PreferenceFact[]) => void;
  onConfirm: () => void;
  onEdit: () => void;
  eyebrow?: string;
}

const TITLE = "Here's what I took from your story.";

const WEEKDAY_NAMES: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The small labels under a statement — what kind of thing the interview took it as, in a pilot's terms. */
function tagsFor(f: PreferenceFact): string[] {
  const tags: string[] = [];
  if (f.severity === "dealbreaker") tags.push("Hard line");
  if (f.recurringWeekday) tags.push(`Every ${WEEKDAY_NAMES[f.recurringWeekday] ?? f.recurringWeekday}`);
  if (f.specificDates?.length) tags.push(f.specificDates.length > 3 ? `${shortDate(f.specificDates[0])} – ${shortDate(f.specificDates.at(-1)!)}` : f.specificDates.map(shortDate).join(", "));
  if (f.measurable?.type === "city-sentiment") tags.push(`${f.measurable.sentiment === "love" ? "Loves" : "Avoids"} ${f.measurable.code}`);
  if (f.measurable?.type === "explicit-target") {
    const role = f.measurable.rangeRole === "min" ? "At least" : f.measurable.rangeRole === "max" ? "At most" : "Aim";
    tags.push(`${role} ${f.measurable.value}`);
  }
  if (f.measurable && f.measurable.type !== "city-sentiment" && f.measurable.type !== "explicit-target" && f.importance === 0) tags.push("Not a factor");
  return tags;
}

/** Where each fact is shown — the things that act hardest on the ranking first. */
function groupOf(f: PreferenceFact): "hard" | "calendar" | "cities" | "matters" | "not" {
  if (f.severity === "dealbreaker") return "hard";
  if (f.recurringWeekday || f.specificDates?.length) return "calendar";
  if (f.measurable?.type === "city-sentiment" || f.cityReason) return "cities";
  if (f.measurable && f.measurable.type !== "explicit-target" && f.importance === 0) return "not";
  return "matters";
}

const GROUPS: { id: ReturnType<typeof groupOf>; label: string }[] = [
  { id: "hard", label: "Hard lines" },
  { id: "calendar", label: "Dates and weekly commitments" },
  { id: "matters", label: "What matters to you" },
  { id: "cities", label: "Cities" },
  { id: "not", label: "Not a factor for you" },
];

/**
 * Right after the bidding story is read: everything the interview took from
 * it, said back in the pilot's own words, before a single question builds on
 * it. A misread caught here costs one tap; caught later, it's a ranking the
 * pilot can't trust. Removing something doesn't argue with them — the
 * interview simply asks about it properly instead.
 */
export function StoryReviewStep({ facts, onRemove, onRestore, onConfirm, onEdit, eyebrow }: StoryReviewStepProps) {
  const reduce = useReducedMotion();
  // Each removal is the group of facts one card stood for, so Undo and the count match what the pilot tapped.
  const [removed, setRemoved] = useState<PreferenceFact[][]>([]);

  function remove(group: PreferenceFact[]) {
    setRemoved((r) => [...r, group]);
    for (const f of group) onRemove(f.id);
  }

  let index = 0;
  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={TITLE}
        help="Anything I got wrong, take it off — I'll ask you about it properly instead. Everything here shapes your ranking and the questions that follow."
      />
      <RevealControls title={TITLE} className="mt-6 space-y-6">
        {GROUPS.map((g) => {
          // One sentence can carry more than one number ("at least 15, ideally 16 or 17" is a
          // floor and an aim) — it reads once, with both tags, rather than as a repeated card.
          const items = Object.values(
            facts
              .filter((f) => groupOf(f) === g.id)
              .reduce<Record<string, PreferenceFact[]>>((acc, f) => {
                (acc[f.statement.trim().toLowerCase()] ??= []).push(f);
                return acc;
              }, {})
          );
          if (items.length === 0) return null;
          return (
            <section key={g.id} aria-label={g.label}>
              <h3 className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-faint">{g.label}</h3>
              <ul className="space-y-1.5">
                {items.map((cluster) => {
                  const f = cluster[0];
                  const tags = [...new Set(cluster.flatMap(tagsFor))];
                  const delay = reduce ? 0 : Math.min(0.6, index++ * 0.04);
                  return (
                    <motion.li
                      key={f.id}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay, duration: 0.3, ease: EASE.emphasized }}
                      className={`group flex items-start gap-3 rounded-lg border px-3.5 py-2.5 ${
                        g.id === "hard" ? "border-danger/35 bg-danger-soft/40" : "border-hairline bg-canvas/40"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-relaxed ${g.id === "not" ? "text-ink-muted" : "text-ink"}`}>{f.statement}</p>
                        {tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {tags.map((t) => (
                              <span key={t} className="rounded border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(cluster)}
                        aria-label={`Remove: ${f.statement}`}
                        title="Not right — take it off"
                        className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
                          <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {removed.length > 0 && (
          <p className="text-sm text-ink-muted" aria-live="polite">
            Took off {removed.length} {removed.length === 1 ? "item" : "items"} — I&rsquo;ll ask about {removed.length === 1 ? "it" : "them"} instead.{" "}
            <button
              type="button"
              onClick={() => {
                onRestore(removed.flat());
                setRemoved([]);
              }}
              className="font-medium text-accent underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              Undo
            </button>
          </p>
        )}

        <div className="flex flex-col-reverse items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onEdit}
            className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            Edit my story instead
          </button>
          <Button type="button" onClick={onConfirm} className="sm:px-7">
            {facts.length === 0 ? "Continue" : "That's right — continue"}
          </Button>
        </div>
      </RevealControls>
    </div>
  );
}
