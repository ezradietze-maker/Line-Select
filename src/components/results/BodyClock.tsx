"use client";

import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { BodyClockScore } from "@/lib/body-clock-score";

/**
 * The body-clock score (1–100, 100 the gentlest — `lib/body-clock-score.ts`) wherever a line or trip shows it: a badge
 * that opens the reasons, and the reasons themselves — each thing that cost points, how many, the line's or trip's own
 * specifics, and one line of the research behind it.
 */

/** Same good / middling / harder / hard colors as the other scores, so there's no new color language to learn. */
export function bodyClockTone(score: number): string {
  if (score >= 70) return "text-good";
  if (score >= 45) return "text-ink";
  if (score >= 25) return "text-warn";
  return "text-danger";
}

/** "64/100", colored — and, with `onClick`, a button that opens the reasons (the chevron says which way). */
export function BodyClockBadge({ result, open, onClick, label = "Body clock" }: { result: BodyClockScore; open?: boolean; onClick?: () => void; label?: string }) {
  const body = (
    <>
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={`font-mono text-xs font-semibold tabular-nums ${bodyClockTone(result.score)}`}>
        {result.score}
        <span className="font-normal text-ink-faint">/100</span>
      </span>
      {onClick && <ChevronDownIcon className={`h-3 w-3 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />}
    </>
  );
  const title = `Body-clock score ${result.score}/100 — 100 is the gentlest on your body clock`;
  return onClick ? (
    <button type="button" onClick={onClick} aria-expanded={open} title={title} className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-canvas/60 px-2 py-0.5 transition-colors hover:border-border-strong">
      {body}
    </button>
  ) : (
    <span title={title} className="inline-flex items-center gap-1.5">
      {body}
    </span>
  );
}

/**
 * Why the score is what it is: `facts` first (the line's or trip's own times — earliest report, latest landing), then
 * every factor that cost points, most first.
 */
export function BodyClockReasons({ result, facts }: { result: BodyClockScore; facts?: ReactNode }) {
  return (
    <div className="space-y-2">
      {facts && <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-readout">{facts}</div>}
      {result.factors.length === 0 ? (
        <p className="text-xs text-ink-muted">Nothing here disrupts the body clock: no night work, early reports, short sleeps, flips or time-zone shifts.</p>
      ) : (
        <ul className="space-y-1.5">
          {result.factors.map((f) => (
            <li key={f.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2">
              <span className={`text-right font-mono text-xs font-semibold tabular-nums ${f.points >= 15 ? "text-danger" : f.points >= 6 ? "text-warn" : "text-ink-muted"}`}>−{f.points}</span>
              <span className="min-w-0">
                <span className="text-xs font-medium text-ink">{f.label}</span>
                <span className="text-xs text-ink-muted"> · {f.detail}</span>
                <span className="block text-[11px] leading-snug text-ink-faint">{f.science}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-ink-faint">
        Scored on your body clock — home time, shifting about an hour a day toward local time on layovers — from 100, the gentlest. The points lost add up to 100 minus the score.
      </p>
    </div>
  );
}

/** A labeled fact for the reasons' first row: "Earliest duty start 02:15 (L)". */
export function BodyClockFact({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-sans text-[10px] uppercase tracking-wide text-ink-faint">{label} </span>
      <span className={tone}>{value}</span>
    </span>
  );
}
