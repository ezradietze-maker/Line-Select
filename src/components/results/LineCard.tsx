"use client";

import { memo, useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MatchBar } from "@/components/results/MatchBar";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import { ScoreRing } from "@/components/results/ScoreRing";
import { TripList } from "@/components/results/TripList";
import { CalendarIcon, ChevronDownIcon, ClockIcon, CoinIcon, GripIcon, PlaneIcon } from "@/components/ui/icons";
import { topImplicitContributions } from "@/lib/rank-learning";
import type { LineScore } from "@/lib/scoring";
import type { PreferenceProfile } from "@/types/preferences";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

interface LineCardProps {
  rank: number;
  lineScore: LineScore;
  profile: PreferenceProfile;
  implicitValuesByLine: Record<string, Record<string, number>>;
  /** Real UTC offset derived from the bid pack's own printed times — see lib/circadian.ts. Null when it couldn't be derived (no trip in the pack has a verified schedule departing home base). */
  homeBaseOffsetMinutes: number | null;
}

export const LineCard = memo(function LineCard({
  rank,
  lineScore,
  profile,
  implicitValuesByLine,
  homeBaseOffsetMinutes,
}: LineCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showMatch, setShowMatch] = useState(false);
  const reduceMotion = useReducedMotion();
  const { line, score, explanation, dimensions } = lineScore;
  const implicitFactors = useMemo(
    () => topImplicitContributions(line.id, implicitValuesByLine, profile, 4),
    [line.id, implicitValuesByLine, profile]
  );
  const isTopPick = rank === 1;

  // Two separate dnd-kit roles on the same card: the grip is the drag
  // SOURCE, the whole card is a drop TARGET — dropping one card directly
  // onto another swaps just that pair, nothing else in the list shifts.
  // The dragged card itself stays put and dims; DragOverlay in
  // ResultsView renders the actual floating copy that follows the pointer.
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: line.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: line.id });

  return (
    <div
      ref={setDropRef}
      className={`overflow-hidden rounded-xl border bg-surface transition-[box-shadow,opacity,border-color] duration-150 hover:shadow-elevated ${
        isTopPick ? "border-dispatch/40 ring-1 ring-dispatch/20 hover:border-dispatch/60" : "border-border hover:border-border-strong"
      } ${isDragging ? "opacity-40" : ""} ${isOver ? "ring-2 ring-accent" : ""}`}
    >
      {isTopPick && (
        <div className="flex items-center gap-1.5 bg-dispatch-soft px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-dispatch sm:px-6">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
            <path d="M12 2l2.6 6.5 7 .5-5.3 4.5 1.7 6.9L12 16.9 5.9 20.4l1.7-6.9L2.4 9l7-.5L12 2z" />
          </svg>
          Top pick
        </div>
      )}
      <div className="flex items-stretch">
        <button
          ref={setDragRef}
          type="button"
          {...attributes}
          {...listeners}
          title="Drag onto another line to swap ranks"
          aria-label="Drag onto another line to swap ranks — teaches the app your preferences"
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

      <div className="flex items-center gap-4 border-t border-border px-5 py-3 font-mono text-xs text-ink-muted sm:hidden">
        <Stat icon={<CalendarIcon />} label="Days off" value={String(line.daysOff)} />
        <Stat icon={<CoinIcon />} label="Credit" value={formatHours(line.totalCreditHours)} />
        <Stat icon={<ClockIcon />} label="TAFB" value={formatHours(line.totalTafbHours)} />
        <Stat icon={<PlaneIcon />} label="Ldgs" value={String(line.totalLandings)} />
      </div>

      {!lineScore.estimated && (
        <div className="border-t border-border px-5 py-3 sm:px-6">
          <MiniLinePreview line={line} homeBaseOffsetMinutes={homeBaseOffsetMinutes} />
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="trip-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-border"
          >
            <div className="p-4 sm:p-5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                Trip schedule
              </h3>
              {lineScore.estimated ? (
                <div className="mt-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
                  This line&rsquo;s calendar entries couldn&rsquo;t be confidently matched to a
                  specific pairing, so there&rsquo;s no verified trip-by-trip breakdown to show.
                  Days off, credit, TAFB, and landings above are exact — read straight from the
                  bid pack&rsquo;s own line totals.
                </div>
              ) : (
                <div className="mt-1.5">
                  <TripList trips={line.trips} homeBaseOffsetMinutes={homeBaseOffsetMinutes} />
                </div>
              )}

              <div className="mt-3 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => setShowMatch((v) => !v)}
                  className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint hover:text-ink"
                  aria-expanded={showMatch}
                >
                  Why this score?
                  <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${showMatch ? "rotate-180" : ""}`} />
                </button>
                {showMatch && (
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {dimensions.map((d) => (
                      <MatchBar key={d.key} dimension={d} />
                    ))}
                  </div>
                )}
                {showMatch && implicitFactors.length > 0 && (
                  <div className="mt-3">
                    <div
                      className="text-[10px] font-medium uppercase tracking-wide text-ink-faint"
                      title="Learned entirely from dragging lines up or down — not from anything you answered in the interview."
                    >
                      Also learned from your drags
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {implicitFactors.map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                          <span>{f.label}</span>
                          <span className={f.contribution >= 0 ? "text-good" : "text-danger"}>
                            {f.contribution >= 0 ? "helps" : "hurts"} this line
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

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
