"use client";

import { memo, useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CategoryBars } from "@/components/results/CategoryBars";
import { CircadianInfo } from "@/components/results/CircadianInfo";
import { DealbreakerBanner } from "@/components/results/DealbreakerBanner";
import { LineInsightBadge } from "@/components/results/LineInsightBadge";
import { MatchBar } from "@/components/results/MatchBar";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import { ScoreRing } from "@/components/results/ScoreRing";
import { TripList } from "@/components/results/TripList";
import { CalendarIcon, ChevronDownIcon, ClockIcon, CoinIcon, GripIcon, PlaneIcon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/Tabs";
import { topImplicitContributions } from "@/lib/rank-learning";
import type { LineScore } from "@/lib/scoring";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The expanded detail view used to be one continuous scroll (trip schedule
 * -> satisfaction breakdown -> a nested "why this score?" toggle -> every
 * dimension -> implicit factors) that kept growing as more features
 * accumulated onto a single line. Split into tabs instead — a pilot lands on
 * Calendar by default and deliberately switches to the others, rather than
 * scrolling past everything to find one thing. New features from here on
 * should earn their way into whichever tab (or the always-visible header)
 * fits, not just get appended to the bottom of one.
 */
type DetailTab = "calendar" | "breakdown" | "circadian" | "reviews";

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
  /** The bid pack's own real start date and period length — see `BidPack.bidPeriodStart`'s doc comment. Threaded down to the mini month calendar. */
  bidPeriodStart: string | null;
  bidPeriodDays: number;
  /** Whether this line is currently one of the (at most two) picked for the side-by-side comparison view — see `LineComparisonModal`. */
  isComparing: boolean;
  onToggleCompare: () => void;
}

export const LineCard = memo(function LineCard({
  rank,
  lineScore,
  profile,
  implicitValuesByLine,
  homeBaseOffsetMinutes,
  bidPeriodStart,
  bidPeriodDays,
  isComparing,
  onToggleCompare,
}: LineCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("calendar");
  const [showEveryDimension, setShowEveryDimension] = useState(false);
  const reduceMotion = useReducedMotion();
  const {
    line,
    score,
    explanation,
    dimensions,
    categoryScores,
    contributors,
    detractors,
    violatedDealbreakers,
    nearMissDealbreakers,
    qualitativeTieIns,
    counterfactual,
    confidenceLevel,
    historicalNote,
    cumulativeCircadian,
    hotelReviewTieIn,
  } = lineScore;
  const implicitFactors = useMemo(
    () => topImplicitContributions(line.id, implicitValuesByLine, profile, 4),
    [line.id, implicitValuesByLine, profile]
  );
  const isTopPick = rank === 1;
  // Only worth a caveat when the profile is thin/moderate — a "thorough"
  // interview needs no qualifier, and null (richness wasn't computed, e.g. a
  // legacy static-interview profile) stays silent rather than guessing.
  const confidenceNote =
    confidenceLevel === "thin"
      ? "Based on a shorter interview — a few more questions would sharpen this."
      : confidenceLevel === "moderate"
        ? "Based on a moderate-length interview."
        : null;

  function openToTab(tab: DetailTab) {
    setActiveTab(tab);
    setExpanded(true);
  }

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
      <DealbreakerBanner violations={violatedDealbreakers} />
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
          className="flex flex-1 flex-col gap-4 p-5 text-left lg:flex-row lg:items-center lg:p-6"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-4 lg:w-56 lg:shrink-0">
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
              {confidenceNote && (
                <div className="mt-0.5 text-[11px] text-ink-faint" title="How much of your interview this score actually has to go on — more questions answered means a more confident number, not a different scoring method.">
                  {confidenceNote}
                </div>
              )}
            </div>
          </div>

          <p className="flex-1 text-sm leading-relaxed text-ink">{explanation}</p>

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

      <div className="flex items-center gap-4 border-t border-border px-5 py-3 font-mono text-xs text-ink-muted">
        <Stat icon={<CalendarIcon />} label="Days off" value={String(line.daysOff)} />
        <Stat icon={<CoinIcon />} label="Credit" value={formatHours(line.totalCreditHours)} />
        <Stat icon={<ClockIcon />} label="TAFB" value={formatHours(line.totalTafbHours)} />
        <Stat icon={<PlaneIcon />} label="Ldgs" value={String(line.totalLandings)} />
      </div>

      {!lineScore.estimated && (
        <div className="space-y-2.5 border-t border-border px-5 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <LineInsightBadge
              nearMissCount={nearMissDealbreakers.length}
              hasCircadianRisk={!!cumulativeCircadian?.hasCompoundingRisk}
              onClick={() => openToTab(cumulativeCircadian?.hasCompoundingRisk ? "circadian" : "breakdown")}
            />
            <button
              type="button"
              onClick={onToggleCompare}
              className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                isComparing
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border text-ink-faint hover:border-border-strong hover:text-ink-muted"
              }`}
            >
              {isComparing ? "Comparing" : "Compare"}
            </button>
          </div>
          <MiniLinePreview
            line={line}
            homeBaseOffsetMinutes={homeBaseOffsetMinutes}
            bidPeriodStart={bidPeriodStart}
            bidPeriodDays={bidPeriodDays}
          />
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
            <div className="px-4 pt-2 sm:px-5">
              <Tabs
                tabs={[
                  { id: "calendar", label: "Calendar" },
                  { id: "breakdown", label: "Score Breakdown" },
                  { id: "circadian", label: "Circadian", badge: !!cumulativeCircadian?.hasCompoundingRisk },
                  ...(hotelReviewTieIn ? [{ id: "reviews", label: "Reviews" }] : []),
                ]}
                activeId={activeTab}
                onChange={(id) => setActiveTab(id as DetailTab)}
              />
            </div>

            <div className="p-4 sm:p-5">
              {activeTab === "calendar" &&
                (lineScore.estimated ? (
                  <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
                    This line&rsquo;s calendar entries couldn&rsquo;t be confidently matched to a
                    specific pairing, so there&rsquo;s no verified trip-by-trip breakdown to show.
                    Days off, credit, TAFB, and landings above are exact — read straight from the
                    bid pack&rsquo;s own line totals.
                  </div>
                ) : (
                  <TripList trips={line.trips} homeBaseOffsetMinutes={homeBaseOffsetMinutes} />
                ))}

              {activeTab === "breakdown" && (
                <div className="space-y-3">
                  <CategoryBars categoryScores={categoryScores} />

                  {qualitativeTieIns.length > 0 && (
                    <ul className="space-y-1.5">
                      {qualitativeTieIns.map((statement, i) => (
                        <li key={i} className="rounded-md bg-brand-soft/50 px-2.5 py-1.5 text-xs leading-relaxed text-ink">
                          You mentioned: &ldquo;{statement}&rdquo;
                        </li>
                      ))}
                    </ul>
                  )}

                  {historicalNote && (
                    <p className="rounded-md bg-brand-soft/50 px-2.5 py-1.5 text-xs leading-relaxed text-ink">
                      {historicalNote}
                    </p>
                  )}

                  {contributors.length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                        What&rsquo;s working
                      </div>
                      <ul className="mt-1 space-y-1">
                        {contributors.map((f, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                            <span className="text-ink">{f.label}</span>
                            <span className="font-mono text-good">{f.matchPercent}%</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {detractors.length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                        What&rsquo;s not
                      </div>
                      <ul className="mt-1 space-y-1">
                        {detractors.map((f, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                            <span className="text-ink">{f.label}</span>
                            <span className="font-mono text-warn">{f.matchPercent}%</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {nearMissDealbreakers.length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-warn">
                        Close call{nearMissDealbreakers.length > 1 ? "s" : ""}
                      </div>
                      <ul className="mt-1 space-y-1">
                        {nearMissDealbreakers.map((nm, i) => (
                          <li key={i} className="text-xs leading-relaxed text-ink-muted">
                            Doesn&rsquo;t cross the line, but sits close to &ldquo;{nm.statement}&rdquo;
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {counterfactual && (
                    <p className="rounded-md bg-canvas px-2.5 py-1.5 text-xs leading-relaxed text-ink-muted">
                      {counterfactual}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowEveryDimension((v) => !v)}
                    className="flex items-center gap-1.5 text-[10px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
                    aria-expanded={showEveryDimension}
                  >
                    See every dimension
                    <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${showEveryDimension ? "rotate-180" : ""}`} />
                  </button>

                  {showEveryDimension && (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {dimensions.map((d) => (
                        <MatchBar key={d.key} dimension={d} />
                      ))}
                    </div>
                  )}
                  {showEveryDimension && implicitFactors.length > 0 && (
                    <div>
                      <div
                        className="text-[10px] font-medium uppercase tracking-wide text-ink-faint"
                        title="Patterns the model found predict what you pick — either from dragging lines up or down here, or from how you answered the interview."
                      >
                        Also factored in
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
              )}

              {activeTab === "circadian" && (
                <div className="space-y-3">
                  {cumulativeCircadian ? (
                    <p className={`text-sm leading-relaxed ${cumulativeCircadian.hasCompoundingRisk ? "text-warn" : "text-ink-muted"}`}>
                      {cumulativeCircadian.summary}
                    </p>
                  ) : (
                    <p className="text-sm leading-relaxed text-ink-faint">
                      This line&rsquo;s exact calendar dates couldn&rsquo;t be confirmed, so there&rsquo;s no
                      real recovery-gap view between its trips — per-trip circadian stars (visible on the
                      Calendar tab) are still exact.
                    </p>
                  )}
                  <CircadianInfo />
                </div>
              )}

              {activeTab === "reviews" && hotelReviewTieIn && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-faint">
                    You flagged {hotelReviewTieIn.cityCode} partly because of the hotel — here&rsquo;s what
                    reviewers actually say about {hotelReviewTieIn.hotelName}:
                  </p>
                  <p className="rounded-md bg-canvas px-3 py-2 text-sm leading-relaxed text-ink">
                    {hotelReviewTieIn.summary}
                  </p>
                </div>
              )}
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
