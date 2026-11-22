"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { formatIndex } from "@/lib/satisfaction-index";
import { criterionWeight } from "@/lib/scoring-v2/score";
import { TRIP_LEAN } from "@/lib/scoring-v2/trip-score";
import type { PilotModel } from "@/types/pilot-model";

/** The priorities named in the breakdown before "and N more". */
const SHOWN_PRIORITIES = 8;

/**
 * Over the ranked list: what the two numbers beside each line are, and, a tap away, how a line's Satisfaction Index is
 * worked out from what the pilot told us (`lib/satisfaction-index.ts`, `scoring-v2/score.ts`).
 */
export function SatisfactionIndexKey({ model, lines, best, worst }: { model: PilotModel | null | undefined; lines: number; best: number | null; worst: number | null }) {
  const [open, setOpen] = useState(false);
  const criteria = (model?.criteria ?? []).map((c) => ({ c, w: criterionWeight(c) })).sort((a, b) => b.w - a.w);
  const total = criteria.reduce((a, x) => a + x.w, 0) || 1;
  const limits = criteria.filter((x) => x.c.hardLimit);
  return (
    <div className="mt-3 rounded-lg border border-hairline print:hidden" data-satisfaction-key>
      {/* Wraps where the words and "How it's scored" won't both fit (320px at 150% text and up): beside it, the words were
          squeezed to nothing and ran under it. */}
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left">
        <span className="min-w-0 flex-1 basis-24 text-xs text-ink-muted">
          <span className="font-semibold text-ink">Satisfaction Index</span> &middot; how well each line fits you, 1 to 100
          <span className="hidden sm:inline">
            {" "}
            &middot; <span className="font-mono text-accent">#</span> is its place in your order, 1 to {lines}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
          {open ? "Hide" : "How it's scored"}
          <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-hairline px-3 py-3 text-xs leading-relaxed text-ink-muted">
          <div className="space-y-1">
            <p>
              <span className="font-medium text-ink">The two numbers.</span> The score box is the line&rsquo;s Satisfaction Index. The{" "}
              <span className="font-mono text-accent">#</span> beside it is where it sits in your order, #1 to #{lines}: the order you&rsquo;ll bid, with
              your own moves kept. Two lines that score the same still have their own place.
            </p>
            <p>
              <span className="font-medium text-ink">The scale.</span> Your best line reads in the high 90s
              {best !== null ? ` (${formatIndex(best)} this month)` : ""}, and the rest fall away from it by how far short of it they come
              {worst !== null ? `, down to ${formatIndex(worst)}` : ""}. It&rsquo;s worked out for this pack, so a 90 here is a line close to your best,
              not a grade against other months. One decimal, so lines a whole number apart don&rsquo;t read as a tie. Green is a strong fit, amber a
              weak one.
            </p>
          </div>

          {criteria.length > 0 && (
            <div>
              <p className="font-medium text-ink">What it&rsquo;s made of: your priorities, and how much each counts</p>
              <ul className="mt-1 space-y-1">
                {criteria.slice(0, SHOWN_PRIORITIES).map(({ c, w }) => {
                  const share = Math.round((100 * w) / total);
                  return (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="w-9 shrink-0 text-right font-mono tabular-nums text-ink">{share}%</span>
                      <span aria-hidden className="h-1.5 shrink-0 rounded-full bg-accent/70" style={{ width: `${Math.max(4, share * 1.2)}px` }} />
                      <span className="min-w-0">{c.label}</span>
                    </li>
                  );
                })}
              </ul>
              {criteria.length > SHOWN_PRIORITIES && <p className="mt-1 text-ink-faint">And {criteria.length - SHOWN_PRIORITIES} smaller ones.</p>}
            </div>
          )}

          <ul className="list-disc space-y-1 pl-4">
            <li>Each line is measured on every one of those priorities and scored on how close it comes to what you want.</li>
            <li>A big miss on something that matters most costs a line more than several small wins can buy back.</li>
            {limits.length > 0 && (
              <li>
                A line that breaks a limit you set ({limits.map((x) => x.c.label).join("; ")}) is held down, with a red bar under its score.
              </li>
            )}
            <li>Once you&rsquo;ve graded trips, each line also leans on its worst trip, about {Math.round(TRIP_LEAN * 100)}% of its score.</li>
            <li>Your carry-in and vacation are taken off first, so each line is scored as you&rsquo;ll fly it.</li>
            <li>Open a line to see what lifted it and what held it back.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
