"use client";

import { useState } from "react";
import { StarIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";

function ScaleRow({ stars, label, colorClass }: { stars: number; label: string; colorClass: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`inline-flex shrink-0 gap-0.5 ${colorClass}`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <StarIcon key={i} className={`h-3 w-3 ${i <= stars ? "fill-current" : "fill-none opacity-35"}`} />
        ))}
      </span>
      <span className="text-sm text-ink-muted">{label}</span>
    </div>
  );
}

/** A small, clickable explainer for the circadian star rating — a hover-only tooltip on each star isn't discoverable (especially on mobile, or for a scale a pilot has never seen before), so this gives it a real, findable explanation once per section instead of leaving it to be guessed at trip by trip. */
export function CircadianInfo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
      >
        <StarIcon className="h-2.5 w-2.5" />
        What do the circadian stars mean?
      </button>

      {open && (
        <Modal title="Circadian disruption score" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
            <p>
              A separate 1-5 rating from the 0-100 match score &mdash; this
              one&rsquo;s about how much a trip is likely to mess with your
              sleep and body clock, regardless of how well it otherwise fits
              what you asked for.
            </p>

            <div className="rounded-lg border border-border bg-canvas p-3">
              <ScaleRow stars={5} label="Minimal disruption" colorClass="text-good" />
              <ScaleRow stars={4} label="Slight disruption" colorClass="text-good" />
              <ScaleRow stars={3} label="Moderate — one real factor present" colorClass="text-ink-muted" />
              <ScaleRow stars={2} label="Significant" colorClass="text-warn" />
              <ScaleRow stars={1} label="Severe — multiple factors stack up" colorClass="text-danger" />
            </div>

            <div>
              <div className="font-medium text-ink">What actually drives the score:</div>
              <ul className="mt-1.5 space-y-2">
                <li>
                  <span className="font-medium text-ink">Which direction you cross time zones, not just how many.</span>{" "}
                  Your body&rsquo;s clock naturally runs a little longer than 24
                  hours, so it&rsquo;s easier to stay up later (a westward
                  shift) than to force sleep and wake earlier (an eastward
                  one). Flying six zones west is genuinely easier on you than
                  flying six zones east — this uses the real local and GMT
                  times printed in your own bid pack to work out which
                  direction each trip actually is, not a generic zone count.
                </li>
                <li>
                  <span className="font-medium text-ink">Report times in the middle of the night.</span>{" "}
                  02:00-05:59 is the Window of Circadian Low — the stretch
                  when your body&rsquo;s alertness and core temperature
                  naturally bottom out, no matter how rested you feel
                  otherwise. It&rsquo;s a real, named fatigue flag in actual
                  airline fatigue risk management, not something specific to
                  this app.
                </li>
                <li>
                  <span className="font-medium text-ink">Layovers under 10 hours.</span>{" "}
                  That&rsquo;s the FAA&rsquo;s own minimum rest floor, set
                  specifically because that&rsquo;s what it takes to
                  realistically get 8 hours of sleep once the ride to the
                  hotel, a meal, and winding down are accounted for.
                </li>
              </ul>
            </div>

            <p className="text-xs text-ink-faint">
              What this can&rsquo;t know: how well you personally adapt, how
              you actually sleep on the road, or anything about your own
              schedule before or after this trip. Treat it as a real,
              science-based flag worth factoring in — not a verdict.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
