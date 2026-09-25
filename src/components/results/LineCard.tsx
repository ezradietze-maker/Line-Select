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
import { TripNumberStrip } from "@/components/results/TripNumberStrip";
import { ScoreRing } from "@/components/results/ScoreRing";
import { TripList } from "@/components/results/TripList";
import { ChevronDownIcon, GripIcon, StarIcon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/Tabs";
import { buildLineFactChips, type LineFactChip } from "@/lib/line-summary";
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
  /** Shortlisted by the pilot. */
  starred: boolean;
  onToggleStar: () => void;
  /** Hidden by the pilot — rendered as a one-line placeholder with a restore button, only ever reached when "show hidden lines" is on. */
  hidden: boolean;
  onHide: () => void;
  onRestore: () => void;
  /** Whether the drag handle is offered — drag-to-swap only means something when the list is in the pilot's own ranking order. */
  draggable: boolean;
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
  starred,
  onToggleStar,
  hidden,
  onHide,
  onRestore,
  draggable,
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
    historicalNote,
    cumulativeCircadian,
    hotelReviewTieIn,
  } = lineScore;
  const implicitFactors = useMemo(
    () => topImplicitContributions(line.id, implicitValuesByLine, profile, 4),
    [line.id, implicitValuesByLine, profile]
  );
  const isTopPick = rank === 1;
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

  const chips = useMemo(() => buildLineFactChips(line, profile), [line, profile]);

  if (hidden) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-surface px-4 py-2.5 text-sm text-ink-faint">
        <span>
          Line {line.lineNumber} <span className="text-ink-faint">&middot; hidden</span>
        </span>
        <button
          type="button"
          onClick={onRestore}
          className="font-medium text-brand underline decoration-dotted underline-offset-4 hover:text-brand-strong"
        >
          Restore
        </button>
      </div>
    );
  }

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
        {draggable && (
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
        )}

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <ScoreRing score={score} size={48} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                #{rank} &middot; Line {line.lineNumber}
              </div>
              <div className="mt-0.5 text-sm text-ink-muted">
                {lineScore.estimated ? (
                  <span
                    className="inline-flex items-center gap-1 font-medium text-warn"
                    title="This line's calendar entries couldn't be confidently matched to a specific pairing, so its trip shape is estimated from monthly totals rather than verified."
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                    </svg>
                    Estimated trips
                  </span>
                ) : (
                  <>
                    {line.trips.length} trip{line.trips.length !== 1 ? "s" : ""}
                  </>
                )}
                {" · "}TAFB {formatHours(line.totalTafbHours)} &middot; {line.totalLandings} landing{line.totalLandings === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={onToggleStar}
                aria-pressed={starred}
                aria-label={starred ? "Remove from shortlist" : "Add to shortlist"}
                title={starred ? "On your shortlist" : "Shortlist this line"}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-black/[0.05] ${
                  starred ? "text-warn" : "text-ink-faint hover:text-ink"
                }`}
              >
                <StarIcon filled={starred} className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={onHide}
                aria-label="Hide this line"
                title="Hide this line"
                className="flex h-9 w-9 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
                  <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {!lineScore.estimated && <TripNumberStrip trips={line.trips} />}

          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_15.5rem] lg:items-start">
            <div>
              <ul className="flex flex-wrap gap-1.5" aria-label="Key facts for this line">
                {chips.map((chip, i) => (
                  <FactChip key={i} chip={chip} />
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!lineScore.estimated && (
                  <LineInsightBadge
                    nearMissCount={nearMissDealbreakers.length}
                    hasCircadianRisk={!!cumulativeCircadian?.hasCompoundingRisk}
                    onClick={() => openToTab(cumulativeCircadian?.hasCompoundingRisk ? "circadian" : "breakdown")}
                  />
                )}
                <button
                  type="button"
                  onClick={onToggleCompare}
                  className={`inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    isComparing
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border text-ink-muted hover:border-border-strong hover:text-ink"
                  }`}
                >
                  {isComparing ? "Comparing" : "Compare"}
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
                >
                  {expanded ? "Hide details" : "Details"}
                  <ChevronDownIcon className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
              </div>
            </div>

            {!lineScore.estimated && (
              <MiniLinePreview
                line={line}
                homeBaseOffsetMinutes={homeBaseOffsetMinutes}
                bidPeriodStart={bidPeriodStart}
                bidPeriodDays={bidPeriodDays}
                showLegend={false}
              />
            )}
          </div>
        </div>
      </div>

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
                  {explanation && <p className="text-sm leading-relaxed text-ink">{explanation}</p>}
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
                      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
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
                      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
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
                      <div className="text-[11px] font-medium uppercase tracking-wide text-warn">
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
                    className="flex items-center gap-1.5 text-[11px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
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
                        className="text-[11px] font-medium uppercase tracking-wide text-ink-faint"
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

const CHIP_TONE: Record<LineFactChip["tone"], string> = {
  good: "border-good/40 bg-good-soft text-good",
  warn: "border-warn/40 bg-warn-soft text-warn",
  neutral: "border-border bg-canvas text-ink",
};

function FactChip({ chip }: { chip: LineFactChip }) {
  return (
    <li className={`inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-[13px] ${CHIP_TONE[chip.tone]}`}>
      <span className="font-semibold">{chip.main}</span>
      {chip.note && <span className="font-normal opacity-90">{chip.note}</span>}
    </li>
  );
}
