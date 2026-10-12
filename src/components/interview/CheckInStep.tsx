"use client";

import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { MicButton } from "@/components/ui/MicButton";
import { describeModel } from "@/lib/brain/describe";
import { useDictation } from "@/lib/use-speech-to-text";
import type { PilotModel } from "@/types/pilot-model";

function Box({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const dictation = useDictation(value, onChange);
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <p className="mb-2 text-xs text-ink-muted">{hint}</p>
      <div className="relative">
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder="Optional — type or tap the mic"
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 pr-11 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
        {dictation.supported && <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />}
      </div>
      {dictation.error && <p className="mt-1 text-xs text-danger">{dictation.error}</p>}
    </div>
  );
}

interface CheckInStepProps {
  model: PilotModel;
  /** "Oct 25 – Nov 21" — the new bid period, so dates are easy to give. */
  periodLabel: string;
  eyebrow?: string;
  onContinue: (changed: string, dates: string) => void;
  onStartOver: () => void;
}

/**
 * A new month for a pilot the brain already knows: what it knows about them,
 * at a glance, and the two things a new month usually brings — something
 * that's changed, and dates they need off. Everything else carries over.
 */
export function CheckInStep({ model, periodLabel, eyebrow, onContinue, onStartOver }: CheckInStepProps) {
  const [changed, setChanged] = useState("");
  const [dates, setDates] = useState("");
  const top = describeModel(model).slice(0, 5);
  const title = "New month. Anything different?";
  return (
    <div>
      <QuestionPrompt eyebrow={eyebrow} title={title} help="Everything you told us last time carries over. Tell us what's new and we'll ask a few questions about this month's pack." />
      <RevealControls title={title} className="mt-6">
        <div className="rounded-xl border border-hairline bg-canvas/60 px-4 py-3">
          <p className="text-[15px] leading-relaxed text-ink">{model.synopsis}</p>
          <ol className="mt-3 space-y-1 text-sm text-ink-muted">
            {top.map((c, i) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="mr-2 font-mono text-xs text-ink-faint">{i + 1}</span>
                  {c.label}
                </span>
                <span className="shrink-0 font-mono text-xs text-accent">{Math.round(c.influence)}%</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-5 space-y-4">
          <Box id="checkin-changed" label="Has anything changed?" hint="A move, a new commute, kids' schedules, what you're after this month…" value={changed} onChange={setChanged} />
          <Box id="checkin-dates" label={`Dates you need off (${periodLabel})`} hint="A trip, an appointment, a family event — and how firm each one is." value={dates} onChange={setDates} />
        </div>
        <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={onStartOver} className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Start the full interview over instead
          </button>
          <Button type="button" onClick={() => onContinue(changed.trim(), dates.trim())} className="sm:px-6">
            {changed.trim() || dates.trim() ? "Continue" : "Nothing's changed — continue"}
          </Button>
        </div>
      </RevealControls>
    </div>
  );
}
