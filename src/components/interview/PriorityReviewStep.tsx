"use client";

import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { describeModel } from "@/lib/brain/describe";
import type { PriorityVerdict } from "@/lib/brain/review";
import type { PilotModel } from "@/types/pilot-model";

const VERDICTS: { v: PriorityVerdict; label: string; tone: string }[] = [
  { v: "right", label: "Right", tone: "border-good bg-good-soft text-good" },
  { v: "more", label: "Count more", tone: "border-warn bg-warn-soft text-warn" },
  { v: "less", label: "Count less", tone: "border-warn bg-warn-soft text-warn" },
  { v: "drop", label: "Doesn’t matter", tone: "border-danger bg-danger-soft text-danger" },
];

interface PriorityReviewStepProps {
  model: PilotModel;
  eyebrow?: string;
  onConfirm: (verdicts: Record<string, PriorityVerdict | undefined>) => void;
  busy?: boolean;
}

/**
 * The readback, in the app: everything the interview heard, as the
 * priorities that will rank every line — each with its share of the score,
 * how it's measured on their pack, and the words it came from. The pilot
 * marks anything off before it counts.
 */
export function PriorityReviewStep({ model, eyebrow, onConfirm, busy }: PriorityReviewStepProps) {
  const [verdicts, setVerdicts] = useState<Record<string, PriorityVerdict | undefined>>({});
  const items = describeModel(model);
  const title = "Here's what we heard. Is it right?";
  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={title}
        help="These priorities, in this order, will rank every line in your pack. Mark anything that's off — the rest stays as it is."
      />
      <RevealControls title={title} className="mt-6">
        <p className="rounded-xl border border-hairline bg-canvas/60 px-4 py-3 text-[15px] leading-relaxed text-ink">{model.synopsis}</p>
        <ol className="mt-5 space-y-3">
          {items.map((c, i) => (
            <li key={c.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 font-medium text-ink">
                  <span className="mr-2 font-mono text-sm text-ink-faint">{i + 1}</span>
                  {c.label}
                </p>
                <span className="shrink-0 font-mono text-xs text-accent">{Math.round(c.influence)}%</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-accent-soft">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, c.influence * 2)}%` }} />
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {c.measuredAs} · {c.shape}
              </p>
              {c.dealbreaker && <p className="mt-1 text-xs font-medium text-danger">{c.dealbreaker}</p>}
              {c.quotes[0] && <p className="mt-1 text-xs italic text-ink-faint">You said: &ldquo;{c.quotes[0]}&rdquo;</p>}
              <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`Is "${c.label}" right?`}>
                {VERDICTS.map((x) => {
                  const on = verdicts[c.id] === x.v;
                  return (
                    <button
                      key={x.v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setVerdicts((p) => ({ ...p, [c.id]: on ? undefined : x.v }))}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? x.tone : "border-border text-ink-muted hover:border-border-strong"}`}
                    >
                      {x.label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
        {model.notMeasurable.length > 0 && (
          <div className="mt-5 rounded-xl border border-hairline bg-canvas/40 px-4 py-3">
            <p className="text-sm font-medium text-ink">Things you said a bid pack can&rsquo;t show</p>
            <p className="text-xs text-ink-muted">Kept with your profile; they don&rsquo;t move the ranking.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {model.notMeasurable.map((n, i) => (
                <li key={i}>{n.statement}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 flex justify-end">
          <Button type="button" onClick={() => onConfirm(verdicts)} disabled={busy} className="sm:px-6">
            {busy ? "Ranking your lines…" : "Looks right — rank my lines"}
          </Button>
        </div>
      </RevealControls>
    </div>
  );
}
