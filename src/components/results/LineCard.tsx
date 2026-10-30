"use client";

import dynamic from "next/dynamic";
import { memo, useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CategoryBars } from "@/components/results/CategoryBars";
import { CircadianInfo } from "@/components/results/CircadianInfo";
import { DealbreakerBanner } from "@/components/results/DealbreakerBanner";
import { LineInsightBadge } from "@/components/results/LineInsightBadge";
import { MatchBar } from "@/components/results/MatchBar";
import { ForecastChip } from "@/components/results/ForecastBanner";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import { RecurringCommitmentBanner } from "@/components/results/RecurringCommitmentBanner";
import { TripNumberStrip } from "@/components/results/TripNumberStrip";
import { BidPackStrip, type PackRanges, type StripLayout } from "@/components/results/BidPackStrip";
import { ChevronDownIcon, GripIcon, StarIcon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/Tabs";
import { buildPackRow, type PackColumn } from "@/lib/bidpack-row";
import { buildLineTimeline } from "@/lib/line-timeline";
import type { StripViewMode } from "@/lib/strip-view-storage";
import { cityMarks } from "@/lib/city-ratings";
import { monthDepartureOptions } from "@/lib/month-detail";
import { groupDepartures } from "@/lib/metrics/departures";
import { CreditHours } from "@/components/results/TripMarks";
import { buildLineFeatures, type LineFactChip } from "@/lib/line-summary";
import { topImplicitContributions } from "@/lib/rank-learning";
import type { LineScore } from "@/lib/scoring";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import type { LineForecast } from "@/lib/forecast/forecast";
import type { TripScore } from "@/lib/scoring-v2/trip-score";
import type { PreferenceProfile } from "@/types/preferences";

// Shown only once a card's details are opened — loaded then (and warmed up in idle time by ResultsView), not with the
// list itself.
const TripList = dynamic(() => import("@/components/results/TripList").then((m) => m.TripList), {
  loading: () => <div className="skeleton-pulse h-40 rounded-lg bg-border/60" aria-hidden />,
});
const RouteMap = dynamic(() => import("@/components/results/RouteMap").then((m) => m.RouteMap), {
  loading: () => <div className="skeleton-pulse aspect-[16/9] rounded-lg bg-border/60" aria-hidden />,
});

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
type DetailTab = "calendar" | "breakdown" | "circadian" | "route" | "reviews";

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
  /** This pilot's chance at the line, when they've given a seniority number and the pack lists the pilots bidding. */
  forecast?: LineForecast | null;
  /** The bid pack's own home base code, e.g. "MEM" — the one fixed point every trip on this line starts and ends at, for the Route tab's map. */
  homeBase: string;
  /** A commuter's looked-up airline flights, shown on the line's trips. */
  flights?: FlightAnswers | null;
  /** Every trip's own score for this pilot (see `lib/scoring-v2/trip-score.ts`), shown on its trips. */
  tripScores?: Map<string, TripScore> | null;
  /** The pack's day columns and how the list lays its strips out — the same for every line, so they line up. */
  packColumns: PackColumn[];
  stripLayout: StripLayout;
  /** Which strip the list draws, and the pack's range of each number for the timeline's meters. */
  stripView: StripViewMode;
  packRanges: PackRanges;
  /** Whether everything about the line is showing under its strip. */
  open: boolean;
  onToggleOpen: () => void;
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
  forecast,
  homeBase,
  flights,
  tripScores,
  packColumns,
  stripLayout,
  stripView,
  packRanges,
  open,
  onToggleOpen,
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
    recurringCommitmentConflicts,
    dateCommitmentConflicts,
    commitmentPenalty,
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

  const chips = useMemo(() => buildLineFeatures(line, profile, lineScore.criterionResults), [line, profile, lineScore.criterionResults]);
  const marks = useMemo(() => cityMarks(profile.cityRatings, profile.cityPreferences), [profile.cityRatings, profile.cityPreferences]);
  const departureOptions = useMemo(() => monthDepartureOptions(homeBase, profile, flights), [homeBase, profile, flights]);
  // Times the pilot leaves home: trips flown back to back, never home between, count once — as the calendar's summary counts them.
  const departureGroups = useMemo(() => groupDepartures(line.trips, { bidPeriodStart, base: departureOptions.base }, departureOptions).map((d) => d.trips), [line.trips, bidPeriodStart, departureOptions]);
  const departures = departureGroups.length;
  const view = useMemo(
    () =>
      stripView === "pack"
        ? ({ kind: "pack", days: buildPackRow(line, bidPeriodStart, bidPeriodDays, packColumns.length) } as const)
        : ({ kind: "timeline", timeline: buildLineTimeline(line, { bidPeriodStart, bidPeriodDays, base: homeBase }, packColumns.length), ranges: packRanges } as const),
    [stripView, line, bidPeriodStart, bidPeriodDays, homeBase, packColumns.length, packRanges]
  );
  const grip = draggable ? (
    <button
      ref={setDragRef}
      type="button"
      {...attributes}
      {...listeners}
      title="Drag onto another line to swap ranks"
      aria-label="Drag onto another line to swap ranks — teaches the app your preferences"
      className="flex h-9 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded text-ink-faint transition-colors hover:bg-accent-soft/40 hover:text-accent active:cursor-grabbing print:hidden"
    >
      <GripIcon className="h-4 w-4" />
    </button>
  ) : null;

  if (hidden) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-hairline bg-canvas/30 px-4 py-2.5 text-sm text-ink-faint print:hidden">
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
      className={`panel-glass hover-lift overflow-hidden transition-[box-shadow,opacity,border-color] duration-150 ${
        isTopPick ? "top-pick-glow !border-accent/50 ring-1 ring-accent/20" : "hover:!border-border-strong"
      } ${isDragging ? "opacity-40" : ""} ${isOver ? "ring-2 ring-accent" : ""}`}
    >
      <BidPackStrip
        line={line}
        score={score}
        capped={violatedDealbreakers.length > 0}
        columns={packColumns}
        view={view}
        layout={stripLayout}
        grip={grip}
        open={open}
        onToggle={onToggleOpen}
      />

      {/* Everything else about the line, under its strip when it's opened. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="line-open"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-hairline"
          >
      {isTopPick && (
        <div className="flex items-center gap-1.5 border-b border-accent/20 bg-gradient-to-r from-accent-soft to-transparent px-5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent sm:px-6">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden>
            <path d="M12 2l2.6 6.5 7 .5-5.3 4.5 1.7 6.9L12 16.9 5.9 20.4l1.7-6.9L2.4 9l7-.5L12 2z" />
          </svg>
          Top pick
        </div>
      )}
      <DealbreakerBanner violations={violatedDealbreakers} />
      <RecurringCommitmentBanner
        conflicts={recurringCommitmentConflicts}
        dateConflicts={dateCommitmentConflicts}
        penalty={commitmentPenalty}
      />
      <div>
        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs font-semibold text-ink-faint">#{rank}</span>
                <span className="font-display text-lg font-semibold tracking-tight text-ink">Line {line.lineNumber}</span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.03em] text-ink-muted sm:text-[11.5px] sm:tracking-[0.08em]">
                <CreditHours hours={line.totalCreditHours} className="whitespace-nowrap" />
                {" · "}
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
                  <span className="whitespace-nowrap">
                    {departures} departure{departures !== 1 ? "s" : ""}
                  </span>
                )}
                {" · "}
                <span className="whitespace-nowrap">
                  {line.totalLandings} landing{line.totalLandings === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            <div className="-my-1.5 -mr-1.5 flex shrink-0 items-center gap-0.5 print:hidden">
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

          {forecast && <div className="mt-2.5"><ForecastChip forecast={forecast} /></div>}

          {!lineScore.estimated && <TripNumberStrip trips={line.trips} departures={departureGroups} />}

          {/* The month calendar takes the card's full width: each day lists its flights, and they need the room to read. */}
          <div className="mt-3 grid gap-4">
            <div>
              {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Features</span>
                  <ul className="contents" aria-label="This line's best features for you">
                    {chips.map((chip, i) => (
                      <FactChip key={i} chip={chip} />
                    ))}
                  </ul>
                </div>
              )}

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
                  className={`inline-flex items-center rounded-md print:hidden border px-3 py-1.5 text-sm font-medium transition-colors ${
                    isComparing
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-hairline text-ink-muted hover:border-border-strong hover:text-ink"
                  }`}
                >
                  {isComparing ? "Comparing" : "Compare"}
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  className="inline-flex items-center gap-1.5 rounded-md border print:hidden border-hairline px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
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
                cityPreferences={marks}
                departureOptions={departureOptions}
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
            className="overflow-hidden border-t border-hairline"
          >
            <div className="px-4 pt-2 sm:px-5">
              <Tabs
                tabs={[
                  { id: "calendar", label: "Calendar" },
                  { id: "breakdown", label: "Score Breakdown" },
                  { id: "circadian", label: "Circadian", badge: !!cumulativeCircadian?.hasCompoundingRisk },
                  { id: "route", label: "Route" },
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
                    Days off, credit, and landings above are exact — read straight from the
                    bid pack&rsquo;s own line totals.
                  </div>
                ) : (
                  <TripList trips={line.trips} homeBaseOffsetMinutes={homeBaseOffsetMinutes} bidPeriodStart={bidPeriodStart} cityPreferences={marks} flights={flights} base={homeBase} tripScores={tripScores} carryOverCreditHours={line.carryOverCreditHours} />
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

              {activeTab === "route" && <RouteMap homeBase={homeBase} line={line} />}

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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

const CHIP_TONE: Record<LineFactChip["tone"], string> = {
  good: "border-good/40 bg-good-soft text-good",
  warn: "border-warn/40 bg-warn-soft text-warn",
  neutral: "border-hairline bg-canvas/50 text-ink",
};

function FactChip({ chip }: { chip: LineFactChip }) {
  return (
    <li className={`inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-[13px] ${CHIP_TONE[chip.tone]}`}>
      <span className="font-semibold">{chip.main}</span>
      {chip.note && <span className="font-normal opacity-90">{chip.note}</span>}
    </li>
  );
}
