"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MatchBar } from "@/components/results/MatchBar";
import { ScoreRing } from "@/components/results/ScoreRing";
import { TripList } from "@/components/results/TripList";
import { CalendarIcon, ClockIcon, CoinIcon, GripIcon, PlaneIcon } from "@/components/ui/icons";
import type { LineScore } from "@/lib/scoring";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

interface LineCardProps {
  rank: number;
  lineScore: LineScore;
}

export function LineCard({ rank, lineScore }: LineCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { line, score, explanation, dimensions } = lineScore;
  const isTopPick = rank === 1;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`overflow-hidden rounded-xl border bg-surface transition-shadow hover:shadow-elevated ${
        isTopPick ? "border-good/40 ring-1 ring-good/20" : "border-border"
      } ${isDragging ? "relative z-10 opacity-60 shadow-elevated-lg" : ""}`}
    >
      {isTopPick && (
        <div className="flex items-center gap-1.5 bg-good-soft px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-good sm:px-6">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
            <path d="M12 2l2.6 6.5 7 .5-5.3 4.5 1.7 6.9L12 16.9 5.9 20.4l1.7-6.9L2.4 9l7-.5L12 2z" />
          </svg>
          Top pick
        </div>
      )}
      <div className="flex items-stretch">
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Drag to tell the app this line should rank differently"
          aria-label="Drag to reorder — moving this line teaches the app your preferences"
          className="flex shrink-0 touch-none cursor-grab items-center justify-center border-r border-border px-2.5 text-ink-faint hover:bg-black/[0.05] hover:text-ink active:cursor-grabbing"
        >
          <GripIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex flex-1 flex-col gap-4 p-5 text-left sm:flex-row sm:items-center sm:p-6"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-4 sm:w-56 sm:shrink-0">
            <ScoreRing score={score} />
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                #{rank} &middot; Line {line.lineNumber}
              </div>
              {lineScore.estimated ? (
                <div
                  className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-warn"
                  title="This line's calendar entries couldn't be confidently matched to a specific pairing, so its trip shape is estimated from monthly totals rather than verified."
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                  </svg>
                  Estimated trip
                </div>
              ) : (
                <div className="mt-0.5 text-sm text-ink-muted">
                  {line.trips.length} trip{line.trips.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>

          <p className="flex-1 text-sm leading-relaxed text-ink">{explanation}</p>

          <div className="hidden shrink-0 items-center gap-4 font-mono text-xs text-ink-muted sm:flex">
            <Stat icon={<CalendarIcon />} label="Days off" value={String(line.daysOff)} />
            <Stat icon={<CoinIcon />} label="Credit" value={formatHours(line.totalCreditHours)} />
            <Stat icon={<ClockIcon />} label="TAFB" value={formatHours(line.totalTafbHours)} />
            <Stat icon={<PlaneIcon />} label="Ldgs" value={String(line.totalLandings)} />
          </div>

          <svg
            className={`h-5 w-5 shrink-0 text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <div className="flex gap-4 border-t border-border px-5 py-3 font-mono text-xs text-ink-muted sm:hidden">
        <Stat icon={<CalendarIcon />} label="Days off" value={String(line.daysOff)} />
        <Stat icon={<CoinIcon />} label="Credit" value={formatHours(line.totalCreditHours)} />
        <Stat icon={<ClockIcon />} label="TAFB" value={formatHours(line.totalTafbHours)} />
        <Stat icon={<PlaneIcon />} label="Ldgs" value={String(line.totalLandings)} />
      </div>

      {expanded && (
        <div className="animate-fade-in border-t border-border p-5 sm:p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Per-dimension match
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {dimensions.map((d) => (
              <MatchBar key={d.key} dimension={d} />
            ))}
          </div>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Trip by trip
          </h3>
          {lineScore.estimated ? (
            <div className="mt-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
              This line&rsquo;s calendar entries couldn&rsquo;t be confidently matched to a
              specific pairing, so there&rsquo;s no verified trip-by-trip breakdown to show.
              Days off, credit, TAFB, and landings above are exact — read straight from the
              bid pack&rsquo;s own line totals.
            </div>
          ) : (
            <div className="mt-2">
              <TripList trips={line.trips} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-ink-faint">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-tabular text-ink">{value}</div>
    </div>
  );
}
