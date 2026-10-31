"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { bodyClockFactorsExplained } from "@/lib/body-clock-score";

function ScaleRow({ range, label, colorClass }: { range: string; label: string; colorClass: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className={`w-16 shrink-0 font-mono text-xs font-semibold tabular-nums ${colorClass}`}>{range}</span>
      <span className="text-sm text-ink-muted">{label}</span>
    </div>
  );
}

/** A small, clickable explainer for the body-clock score — a hover-only tooltip isn't discoverable (especially on a phone), so this gives it a real, findable explanation once per section. */
export function CircadianInfo() {
  const [open, setOpen] = useState(false);
  const factors = bodyClockFactorsExplained();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
      >
        What&rsquo;s in the body-clock score?
      </button>

      {open && (
        <Modal title="Body-clock score" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
            <p>
              A health-facing score from 1 to 100 &mdash; 100 is the gentlest on your body clock &mdash; separate from how well a
              line fits what you asked for. Every line and every trip has one; tap it to see exactly what cost points, and why.
            </p>

            <div className="rounded-lg border border-border bg-canvas p-3">
              <ScaleRow range="70–100" label="Gentle — little to answer for" colorClass="text-good" />
              <ScaleRow range="45–69" label="Some real disruption" colorClass="text-ink" />
              <ScaleRow range="25–44" label="Hard on the body clock" colorClass="text-warn" />
              <ScaleRow range="1–24" label="Several disruptions stacking up" colorClass="text-danger" />
            </div>

            <div>
              <div className="font-medium text-ink">What costs points, and the research behind it:</div>
              <ul className="mt-1.5 space-y-2">
                {factors.map((f) => (
                  <li key={f.label}>
                    <span className="font-medium text-ink">{f.label}.</span> {f.science}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-ink-faint">
              Everything is worked out on your body&rsquo;s clock, not the wall clock: it starts on home time and shifts toward
              local time only about an hour a day on a layover &mdash; the same model the layover sleep plans use, from the real
              local and GMT times printed in your bid pack. If you&rsquo;ve told the interview how many nights in a row you can
              handle, each one past that costs more. What it can&rsquo;t know is how well you personally sleep on the road: treat
              it as a science-based guide, not a verdict.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
