"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { swapKeyboardCoordinates } from "@/lib/swap-keyboard";
import { motion, useReducedMotion } from "motion/react";
import { BidOrderExport, type BidOrderEntry } from "@/components/results/BidOrderExport";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PreferenceMicroPrompt } from "@/components/results/PreferenceMicroPrompt";
import { FilterBlameList, ResultsFilterBar } from "@/components/results/ResultsFilterBar";
import { SkeletonCards } from "@/components/ui/SkeletonCards";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heading } from "@/components/ui/Heading";
import { Spinner } from "@/components/ui/Spinner";
import { CarryInLineNote, CarryInPanel } from "@/components/results/CarryInPanel";
import { LineCard } from "@/components/results/LineCard";
import { AskPackPanel } from "@/components/results/AskPackPanel";
import { FirstVisitTour } from "@/components/results/FirstVisitTour";
import { WheelsDown } from "@/components/results/WheelsDown";
import { ResultsStatusPanel } from "@/components/results/ResultsStatusPanel";
import { ScoreRing } from "@/components/results/ScoreRing";
import { BidPackHeader, StripKey, StripViewToggle, stripLayout } from "@/components/results/BidPackStrip";
import { useStripView } from "@/lib/strip-view-storage";
import { useMeasuredWidth } from "@/components/results/LegBars";
import { packColumnCount, packColumns } from "@/lib/bidpack-row";
import { monthLine } from "@/lib/bid-month";
import { bidMonthOf, cityMarks } from "@/lib/city-ratings";
import { monthDepartureOptions } from "@/lib/month-detail";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { cachedFlightAnswers, lookUpFlights } from "@/lib/flights/client";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { scoreTripsV2 } from "@/lib/scoring-v2/trip-score";
import { rankingPack } from "@/lib/scoring-v2/adapter";
import { fetchAllHotelQualityData, settledHotelQualityData } from "@/lib/hotel-client";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { useBidForecast } from "@/lib/forecast/use-bid-forecast";
import { loadPreviousPeriodSnapshot, saveBidPeriodSnapshot, summarizeBidPeriodChange } from "@/lib/bid-period-history";
import { assessProfileRichness } from "@/lib/interview-engine";
import { computeFilterOptions } from "@/lib/line-filter-options";
import { collectLayoverCities, collectTouchedCities, EMPTY_FILTERS, filtersActive, filtersKey, lineMatchesFilters, type FilterContext, type LineFilters } from "@/lib/line-filters";
import { useCommuteCheck } from "@/lib/use-commute-check";
import { loadTopLinesSnapshot, saveTopLinesSnapshot } from "@/lib/line-history-storage";
import { buildLineFactChips, lineFactsText } from "@/lib/line-summary";
import { loadLineMarks, saveLineMarks } from "@/lib/line-marks-storage";
import { PHRASES } from "@/lib/preference-summary";
import {
  PAGE_SIZE,
  hideLine,
  matchesLineSearch,
  nextVisibleCount,
  pruneMarks,
  restoreLine,
  toggleStar,
  type LineMarks,
} from "@/lib/results-list";
import {
  learnFromReorder,
  type DimensionUpdate,
  type PairwiseJudgment,
} from "@/lib/rank-learning";
import { addDragChoices, answerSwap, choicesFromSwap, describeChanges, withModel, withoutDrag, type SwapReply } from "@/lib/brain/profile-model";
import { describeSwap, explainSwap } from "@/lib/brain/explain-swap";
import { pickSwapQuestion, reasonOptions, untrackedFactor, type AskState, type SwapQuestion } from "@/lib/brain/swap-question";
import type { ReasonOption } from "@/lib/brain/swap-reason";
import { shareChanges } from "@/lib/brain/fit-choices";
import { SwapQuestionCard } from "@/components/results/SwapQuestionCard";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import { withPrintedLines } from "@/lib/phase-in";
import { useCarryIn } from "@/lib/use-carry-in";
import { SortMenu, SortNote } from "@/components/results/SortMenu";
import { useLineSort } from "@/lib/use-line-sort";
import { applyPlacements, loadPlacements, placementFromDrag, prunePlacements, savePlacements, type Placement } from "@/lib/line-placements";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankLines, type HotelQualityData, type LineScore } from "@/lib/scoring";
import { lineHasHotel, type HotelFilter } from "@/lib/hotel-filter";
import { useProgressiveCount } from "@/lib/use-progressive-count";
import { FlipText } from "@/components/ui/FlipText";
import { PillHighlight } from "@/components/ui/PillHighlight";
import { setRankingSnapshot } from "@/lib/ranking-snapshot";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";

const LineComparisonModal = dynamic(() => import("@/components/results/LineComparisonModal").then((m) => m.LineComparisonModal));

/** The pieces a card only shows when opened, fetched while the pilot is still reading the list, so opening one never waits. */
function warmUpDetails() {
  void import("@/components/results/TripList");
  void import("@/components/results/RouteMap");
  void import("@/components/results/LineComparisonModal");
}

/** 0-1: below this, the model already basically expected the outcome — update quietly. Above it, the drag contradicted what the model currently believes, which is worth surfacing. */
const SURPRISE_THRESHOLD = 0.55;
/** Never more than this many clarifying prompts in one sitting — the feature has to stay optional and rare or pilots learn to dismiss it on reflex. */
const MAX_PROMPTS_PER_SESSION = 6;

function phraseFor(update: DimensionUpdate): string {
  if (update.isImplicit) return update.label;
  const magnitudeOnly = update.id.startsWith("hotel");
  const leansPositive = magnitudeOnly ? update.weightAfter >= update.weightBefore : update.weightAfter >= 0;
  const key = update.id as keyof PreferenceWeights;
  return leansPositive ? PHRASES[key].positive : PHRASES[key].negative;
}

function describeLearn(updates: DimensionUpdate[]): string {
  const phrases = updates.slice(0, 2).map(phraseFor);
  const joined = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}` : phrases[0];
  const extra = updates.length > 2 ? ` (and ${updates.length - 2} other small factor${updates.length - 2 > 1 ? "s" : ""})` : "";
  return `Got it — weighting ${joined} more heavily from here on${extra}.`;
}

/**
 * The floating preview shown under the pointer while dragging — deliberately
 * a compact chip, not a clone of the full card. DragOverlay's wrapper has no
 * defined width of its own, so a `w-full` child (the original approach)
 * silently collapses to almost nothing instead of the full card width; a
 * fixed width sidesteps that entirely and reads better as something meant
 * to float freely, rather than a heavy card following the cursor around.
 */
function DragPreview({ lineScore }: { lineScore: LineScore }) {
  return (
    <div className="flex w-64 cursor-grabbing items-center gap-3 rounded-xl border border-accent bg-surface-raised px-4 py-3 shadow-elevated-lg">
      <ScoreRing score={lineScore.score} />
      <span className="text-sm font-semibold text-ink">Line {lineScore.line.lineNumber}</span>
    </div>
  );
}

/** Whether the pilot expressed any opinion at all about their layover hotel — gates fetching hotel quality data at all, so a pilot who left every hotel slider at 0 doesn't pay for network calls that can't affect their score. */
/** A pilot who chose "Stop asking" on the question after a swap isn't asked again on this device. */
const STOP_ASKING_KEY = "line-select:swap-questions-off:v1";

function readStopAsking(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STOP_ASKING_KEY) === "1";
  } catch {
    return false;
  }
}

/** Runs `fn` once the browser has drawn the next frame — after whatever the current update shows. */
function afterPaint(fn: () => void) {
  requestAnimationFrame(() => setTimeout(fn, 0));
}

function caresAboutLayoverQuality(profile: PreferenceProfile): boolean {
  const { hotelFood, hotelGym, hotelGrocery, hotelQuiet, hotelQuality } = profile.weights;
  return [hotelFood, hotelGym, hotelGrocery, hotelQuiet, hotelQuality].some((w) => Math.abs(w) > 0);
}

/**
 * Every pairwise judgment implied by one drag gesture — dropping a line
 * three spots up doesn't just teach the model "A beats whatever it landed
 * on," it teaches "A now outranks everything it jumped over" (Section 5.1).
 */
function buildJudgments(ranked: LineScore[], fromIndex: number, toIndex: number): PairwiseJudgment[] {
  const moved = ranked[fromIndex];
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  const draggedUp = toIndex < fromIndex;

  const judgments: PairwiseJudgment[] = [];
  for (let i = start; i <= end; i++) {
    if (i === fromIndex) continue;
    const other = ranked[i];
    judgments.push(draggedUp ? { favored: moved, overtaken: other } : { favored: other, overtaken: moved });
  }
  return judgments;
}

/** How long to hold the list back waiting on hotel reviews before showing it anyway. Hotel data changes scores, so showing the list first and then reshuffling it under a pilot who's already reading is worse than a short wait. */
const HOTEL_WAIT_MS = 6000;

/** The chosen one of All lines / Shortlist / Realistic: a lit pad that slides between them. */
const VIEW_PILL = "absolute inset-0 bg-accent-soft";

interface ResultsViewProps {
  bidPack: BidPack;
  profile: PreferenceProfile;
  onStartOver: () => void;
  /** Lets the "Start over" confirmation offer the milder thing most pilots actually mean — a new month's bid pack, keeping their preferences. */
  onUploadNewPack: () => void;
  /** Opens the (editable) Preferences page. */
  onEditPreferences: () => void;
  onUpdateProfile: (profile: PreferenceProfile) => void;
  /** Identifies which pilot's remembered prior-cycle top lines to read/write (see `line-history-storage.ts`) — null for a guest. */
  userId: string | null;
  /** Arrived from a Hotel Ratings card — start with the list narrowed to lines that stay at this hotel. */
  initialHotelFilter?: HotelFilter | null;
  /** A line number to bring into view and light up (from the ⌘K palette) — handed back through `onFocusHandled` once done. */
  focusLine?: string | null;
  onFocusHandled?: () => void;
}

export function ResultsView({
  bidPack,
  profile,
  onStartOver,
  onUploadNewPack,
  onEditPreferences,
  onUpdateProfile,
  userId,
  initialHotelFilter = null,
  focusLine = null,
  onFocusHandled,
}: ResultsViewProps) {
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [hotelQualityData, setHotelQualityData] = useState<HotelQualityData>(() => settledHotelQualityData(bidPack) ?? {});
  const [hotelDone, setHotelDone] = useState(() => !!settledHotelQualityData(bidPack));
  const [hotelTimedOut, setHotelTimedOut] = useState(false);
  const [learnMessage, setLearnMessage] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Cards animate into their new places after a drag-to-swap — but tracking every card's layout costs a measurement
  // pass per card as the list mounts, so it's switched on only once a pilot actually starts dragging.
  const [layoutArmed, setLayoutArmed] = useState(false);
  const [promptJudgment, setPromptJudgment] = useState<PairwiseJudgment | null>(null);
  const [promptCount, setPromptCount] = useState(0);
  const [askedPairIds, setAskedPairIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<LineFilters>(EMPTY_FILTERS);
  // At most two at a time — picking a third drops the oldest rather than growing unbounded, since the comparison view only ever shows two side by side.
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [hotelFilter, setHotelFilter] = useState<HotelFilter | null>(initialHotelFilter);
  const [view, setView] = useState<"all" | "shortlist" | "realistic">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [marks, setMarks] = useState<LineMarks>(() => loadLineMarks(userId, bidPack.id));
  // Lines the pilot swapped by hand stay where they put them (see `lib/line-placements.ts`).
  const [placements, setPlacements] = useState<Placement[]>(() => loadPlacements(userId, bidPack.id));
  // The latest swap, with the profile from just before it and just after: undoing it while nothing else has changed
  // puts back exactly what the pilot had.
  const [lastSwap, setLastSwap] = useState<{ id: string; before: PreferenceProfile; after: PreferenceProfile } | null>(null);
  // The one question after an unclear swap, and how often it's been asked this visit (see `lib/brain/swap-question.ts`).
  const [swapQuestion, setSwapQuestion] = useState<{ question: SwapQuestion; options: { priorities: ReasonOption[]; measures: ReasonOption[] } } | null>(null);
  const askRef = useRef<AskState>({ swapsSince: 0, asked: 0, askedPairs: new Set(), stopped: readStopAsking() });
  const [pageState, setPageState] = useState({ key: "", shown: PAGE_SIZE });
  // Which lines are open under their strips — as many as the pilot likes, to read side by side.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggleOpen = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const caresAboutHotel = caresAboutLayoverQuality(profile);
  const reduceMotion = useReducedMotion();

  // A pack swap (new upload) can leave filters referencing cities or
  // constraints that don't exist in the new pack — reset rather than risk a
  // silently-empty results list. Adjusted during render (React's documented
  // pattern for resetting state on prop change) rather than in an effect, so
  // it takes effect before the filtered-out first paint rather than after.
  const [filtersForBidPackId, setFiltersForBidPackId] = useState(bidPack.id);
  if (bidPack.id !== filtersForBidPackId) {
    setFiltersForBidPackId(bidPack.id);
    setFilters(EMPTY_FILTERS);
    setSearch("");
    setHotelFilter(null);
    setView("all");
  }
  // Stars and hidden lines are the pilot's own: reloaded for a new pack, and when the session check finds an account
  // after the app first showed this device's guest data — else the guest's marks would be saved over the account's.
  const marksKey = `${userId}|${bidPack.id}`;
  const [marksFor, setMarksFor] = useState(marksKey);
  if (marksKey !== marksFor) {
    setMarksFor(marksKey);
    setMarks(loadLineMarks(userId, bidPack.id));
    setPlacements(loadPlacements(userId, bidPack.id));
    setLastSwap(null);
  }

  useEffect(() => {
    if (!caresAboutHotel) return;
    // Already looked up this visit: the state started from it.
    const known = settledHotelQualityData(bidPack);
    if (known) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHotelQualityData(known);
      setHotelDone(true);
      return;
    }
    let cancelled = false;
    // Deliberately reset here: a different pack must wait for its own hotel data, not inherit "done" from the last one.
    setHotelDone(false);
    setHotelTimedOut(false);
    fetchAllHotelQualityData(bidPack).then((data) => {
      if (cancelled) return;
      setHotelQualityData(data);
      setHotelDone(true);
    });
    const timer = setTimeout(() => {
      if (!cancelled) setHotelTimedOut(true);
    }, HOTEL_WAIT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Only the bid pack's identity and whether the pilot cares at all should
    // re-trigger this — re-fetching on every profile tweak (a slider nudge
    // elsewhere) would be wasted, cached network calls for data that hasn't
    // changed.
  }, [bidPack, caresAboutHotel]);

  // A commuter's real airline flights: kept on the device from an earlier lookup (usually started during the interview),
  // or looked up now. Like hotel reviews, ones that land within a moment shape the first ranking; a lookup that takes
  // longer is offered as an update rather than reshuffling the list under the pilot's eyes.
  const pilotModel = profile.pilotModel;
  const [flights, setFlights] = useState<FlightAnswers | null>(() => (typeof window === "undefined" ? null : cachedFlightAnswers(bidPack, pilotModel)));
  const [flightsWaiting, setFlightsWaiting] = useState<FlightAnswers | null>(null);
  const [flightsLooking, setFlightsLooking] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const mountedAt = Date.now();
    // A different pack or pilot starts from what's kept for it.
    const had = cachedFlightAnswers(bidPack, pilotModel);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlights(had);
    setFlightsWaiting(null);
    setFlightsLooking(true);
    lookUpFlights(bidPack, pilotModel).then((a) => {
      if (cancelled) return;
      setFlightsLooking(false);
      if (!a) return;
      if (had && Object.keys(a).length === Object.keys(had).length) return;
      if (!had && Date.now() - mountedAt < HOTEL_WAIT_MS) setFlights(a);
      else setFlightsWaiting(a);
    });
    return () => {
      cancelled = true;
    };
  }, [bidPack, pilotModel]);

  // The list is held back until hotel data lands (or the wait runs out) so
  // the ranking a pilot starts reading is the ranking they keep — hotel
  // reviews move scores, and a top-3 that reshuffles a few seconds in reads
  // as the app changing its mind.
  const hotelsSettled = !caresAboutHotel || hotelDone || hotelTimedOut;
  const hotelsArrivedLate = caresAboutHotel && hotelTimedOut && hotelDone;

  // The implicit taxonomy's normalized per-line values only depend on the
  // bid pack's own trip data, never on the pilot's weights — computed once
  // per bid pack and reused both by scoring below and by every drag
  // judgment, rather than recomputed per use.
  const implicitValuesByLine = useMemo(() => computeImplicitLineValues(bidPack), [bidPack]);

  // A legacy static-interview profile has no discoveredFacts at all — its
  // richness genuinely can't be assessed from facts that don't exist, so it
  // stays unlabeled (null) rather than reading as artificially "thin".
  const profileRichness = useMemo(
    () => (profile.discoveredFacts.length > 0 ? assessProfileRichness(profile) : undefined),
    [profile]
  );

  // Loaded once per pilot rather than memoized against `ranked` itself — this
  // is deliberately last cycle's snapshot, read once, not something that
  // should silently update mid-session as `ranked` (and the save effect
  // below) recomputes.
  const [priorTopLines] = useState(() => loadTopLinesSnapshot(userId, bidPack.month));

  // Same "read once" posture as `priorTopLines` above, and for the same
  // reason — this is deliberately last bid period's own record, not
  // something that should shift mid-session as the save effect below
  // keeps this period's entry current.
  const [previousPeriodSnapshot] = useState(() => loadPreviousPeriodSnapshot(userId, bidPack.month));

  const carry = useCarryIn(bidPack, userId);
  const scoredLines = useMemo(
    () => withPrintedLines(rankLines(carry.flown.pack, profile, hotelQualityData, implicitValuesByLine, profileRichness, priorTopLines, flights ?? undefined), bidPack, carry.flown.pack),
    [bidPack, carry.flown.pack, profile, hotelQualityData, implicitValuesByLine, profileRichness, priorTopLines, flights]
  );
  // Placements for lines that no longer exist never leak in, as with marks.
  const validPlacements = useMemo(() => prunePlacements(placements, new Set(bidPack.lines.map((l) => l.id))), [placements, bidPack]);
  // The pilot's order: the brain's ranking with every swap they made kept where they made it. Rank numbers, the bid
  // order and the forecast all follow it — it's what they'll bid.
  const ranked = useMemo(() => applyPlacements(scoredLines, validPlacements, (r) => r.line.id), [scoredLines, validPlacements]);
  // Both lines of every swap the pilot made: tagged "Your order", since their scores can now read out of order.
  const swappedIds = useMemo(() => new Set(validPlacements.flatMap((p) => [p.order[0], p.order[p.order.length - 1]])), [validPlacements]);
  const rankedIds = useMemo(() => ranked.map((r) => r.line.id), [ranked]);
  // Every trip's own score, from the same priorities that rank the lines — shown on each trip in a line's trip list.
  // On the ranking's own measured pack, so a refit re-scores trips without re-measuring them.
  const tripScores = useMemo(
    () => (pilotModel ? scoreTripsV2(bidPack, pilotModel, { flights: flights ?? undefined, onLineScale: true, pack: rankingPack(bidPack, flights ?? undefined) }) : null),
    [bidPack, pilotModel, flights]
  );

  const updateMarks = useCallback(
    (fn: (m: LineMarks) => LineMarks) => {
      setMarks((prev) => {
        const next = fn(prev);
        saveLineMarks(userId, bidPack.id, next);
        return next;
      });
    },
    [userId, bidPack.id]
  );

  // The newest profile and placements, for learning that runs after a swap has painted (see `handleDragEnd`).
  const profileRef = useRef(profile);
  const placementsRef = useRef(placements);
  useLayoutEffect(() => {
    profileRef.current = profile;
    placementsRef.current = placements;
  }, [profile, placements]);

  const updatePlacements = useCallback(
    (fn: (p: Placement[]) => Placement[]) => {
      setPlacements((prev) => {
        const next = fn(prev);
        savePlacements(userId, bidPack.id, next);
        placementsRef.current = next;
        return next;
      });
    },
    [userId, bidPack.id]
  );

  // Marks for lines that no longer exist (an older pack under the same id) never leak into counts.
  const validMarks = useMemo(() => pruneMarks(marks, new Set(bidPack.lines.map((l) => l.id))), [marks, bidPack]);
  const starredSet = useMemo(() => new Set(validMarks.starred), [validMarks]);
  const hiddenSet = useMemo(() => new Set(validMarks.hidden), [validMarks]);

  function toggleCompare(lineId: string) {
    setCompareIds((prev) => {
      if (prev.includes(lineId)) return prev.filter((id) => id !== lineId);
      return prev.length < 2 ? [...prev, lineId] : [prev[1], lineId];
    });
  }
  const compareLineScores = compareIds
    .map((id) => ranked.find((r) => r.line.id === id))
    .filter((r): r is LineScore => !!r);

  // Keeps this cycle's own top lines current in storage as the pilot
  // refines their ranking (drag-to-swap, preference nudges), so whatever was
  // true the last time they looked at results is what a future cycle's
  // "historically preferred" comparison reads — not just a one-time snapshot
  // from the moment they first landed here.
  useEffect(() => {
    if (!hotelsSettled) return;
    saveTopLinesSnapshot(userId, bidPack.month, ranked);
    saveBidPeriodSnapshot(userId, bidPack.month, ranked);
  }, [userId, ranked, hotelsSettled, bidPack.month]);

  const bidPeriodChange = useMemo(
    () => summarizeBidPeriodChange(previousPeriodSnapshot, ranked),
    [previousPeriodSnapshot, ranked]
  );

  // Global rank survives filtering — a filtered card or export entry always
  // shows its true position in the full ranking, not a renumbered index into
  // whatever subset currently matches the filters.
  const rankById = useMemo(() => new Map(ranked.map((r, i) => [r.line.id, i + 1] as const)), [ranked]);
  useEffect(() => {
    if (!hotelsSettled) return;
    setRankingSnapshot({ bidPackId: bidPack.id, byLineId: new Map(ranked.map((r, i) => [r.line.id, { rank: i + 1, score: r.score }])) });
  }, [ranked, hotelsSettled, bidPack.id]);

  // The pilot's chance at every line, given where their seniority number puts them in bid order — held until the ranking has settled, since it's a forecast of *this* ranking.
  const rankingLineIds = useMemo(() => ranked.map((r) => r.line.id), [ranked]);
  const forecast = useBidForecast({
    bidPack,
    rankingLineIds: hotelsSettled ? rankingLineIds : [],
    implicitValuesByLine,
    seniorityNumber: profile.seniorityNumber,
    userId,
    enabled: hotelsSettled,
  });
  const forecastLines = forecast.result?.forecast.lines ?? null;
  const realisticIds = useMemo(
    () => new Set(forecastLines ? Object.values(forecastLines).filter((l) => l.pAvailable >= 0.2).map((l) => l.lineId) : []),
    [forecastLines]
  );

  const commute = useCommuteCheck(bidPack, profile, filters.commuteOnly);
  const filterCtx = useMemo<FilterContext>(() => ({ bidPeriodStart: bidPack.bidPeriodStart, commute: commute.statuses }), [bidPack.bidPeriodStart, commute.statuses]);
  const matching = useMemo(
    () =>
      ranked.filter(
        (r) =>
          lineMatchesFilters(r.line, filters, filterCtx) &&
          matchesLineSearch(r.line, search) &&
          (!hotelFilter || lineHasHotel(r.line, hotelFilter))
      ),
    [ranked, filters, filterCtx, search, hotelFilter]
  );
  const hiddenMatchingCount = matching.filter((r) => hiddenSet.has(r.line.id)).length;
  const listable = useMemo(
    () => matching.filter((r) => (showHidden || !hiddenSet.has(r.line.id)) &&
        (view === "all" || (view === "shortlist" ? starredSet.has(r.line.id) : realisticIds.has(r.line.id)))
    ),
    [matching, showHidden, hiddenSet, view, starredSet, realisticIds]
  );
  // Departures counted as each card counts them: the times the pilot leaves home.
  const departureOptions = useMemo(() => monthDepartureOptions(bidPack.base, profile, flights), [bidPack.base, profile, flights]);
  const lineSort = useLineSort(userId, bidPack, profile, flights, departureOptions);
  const applyLineSort = lineSort.apply;
  const sorted = useMemo(() => applyLineSort(listable), [applyLineSort, listable]);

  // Back to the first page whenever what's being listed changes — landing on
  // "page 4 of a different list" would show a scrolled-past-nothing view.
  const listKey = `${lineSort.key}|${search}|${hotelFilter?.city}|${hotelFilter?.hotelName}|${view}|${showHidden}|${filtersKey(filters)}|${ranked.length}`;
  if (pageState.key !== listKey) setPageState({ key: listKey, shown: PAGE_SIZE });
  const shown = pageState.key === listKey ? pageState.shown : PAGE_SIZE;
  const displayed = sorted.slice(0, shown);
  // The cards themselves mount a few at a time, so the top of the list paints fast on a phone; `displayed` stays the page's real contents for counts and paging.
  // A phone shows one card at a time, so it paints the first two and builds the rest in idle time.
  const [firstBatch] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 2 : 6));
  const mountedCount = useProgressiveCount(displayed.length, 6, firstBatch);

  // Which cards changed place since the last render: only those animate into their new place. Measuring every card's
  // layout on each re-rank was much of the freeze after a swap on a big pack. Adjusted during render, React's documented
  // pattern for state derived from a change.
  const orderKey = displayed.map((r) => r.line.id).join(",");
  const [order, setOrder] = useState({ key: orderKey, moved: new Set<string>() });
  if (order.key !== orderKey) {
    const before = new Map(order.key.split(",").map((id, i) => [id, i] as const));
    setOrder({ key: orderKey, moved: new Set(displayed.flatMap((r, i) => (before.has(r.line.id) && before.get(r.line.id) !== i ? [r.line.id] : []))) });
  }

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warmUpDetails, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warmUpDetails, 1500);
    return () => window.clearTimeout(id);
  }, []);

  // A line asked for by number: make sure it's listed (clearing whatever filter or view hides it, and paging far enough
  // down), wait for its card to mount, then scroll to it and light it up.
  const [flashId, setFlashId] = useState<string | null>(null);
  // The ask already answered, while the address catches up — so more cards mounting doesn't scroll back to it.
  const focusDone = useRef<string | null>(null);
  const focusTarget = focusLine && hotelsSettled ? ranked.find((r) => r.line.lineNumber === focusLine) ?? null : null;
  const focusIndex = focusTarget ? sorted.indexOf(focusTarget) : -1;
  useEffect(() => {
    if (!focusLine) focusDone.current = null;
    if (!focusLine || !hotelsSettled || focusDone.current === focusLine) return;
    if (!focusTarget) {
      onFocusHandled?.();
      return;
    }
    if (focusIndex === -1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters(EMPTY_FILTERS);
      setSearch("");
      setHotelFilter(null);
      setView("all");
      if (hiddenSet.has(focusTarget.line.id)) setShowHidden(true);
      return;
    }
    if (focusIndex >= shown) {
      setPageState({ key: listKey, shown: focusIndex + 1 });
      return;
    }
    const el = document.getElementById(`line-${focusTarget.line.id}`);
    if (!el) return; // still mounting — runs again as more cards mount
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    setOpenIds((prev) => (prev.has(focusTarget.line.id) ? prev : new Set(prev).add(focusTarget.line.id)));
    setFlashId(focusTarget.line.id);
    focusDone.current = focusLine;
    onFocusHandled?.();
  }, [focusLine, hotelsSettled, focusTarget, focusIndex, shown, listKey, mountedCount, hiddenSet, reduceMotion, onFocusHandled]);
  // Every line's strip has the pack's day columns, laid out the same at the list's width, so they line up under one header.
  const columns = useMemo(() => packColumns(bidPack.bidPeriodStart, bidPack.bidPeriodDays, packColumnCount(bidPack)), [bidPack]);
  const [listRef, listWidth] = useMeasuredWidth<HTMLDivElement>(768);
  const layout = useMemo(() => stripLayout(listWidth, columns.length), [listWidth, columns.length]);
  const [stripView, setStripView] = useStripView();
  // Keys for working down the list at a desk: j / k move between lines, o opens one, s shortlists, c compares, ? shows the keys.
  const [keyIndex, setKeyIndex] = useState<number | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const keyedId = keyIndex !== null ? displayed[Math.min(keyIndex, mountedCount - 1)]?.line.id ?? null : null;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const count = Math.min(displayed.length, mountedCount);
      if (!count) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = keyIndex === null ? 0 : Math.max(0, Math.min(count - 1, keyIndex + (e.key === "j" ? 1 : -1)));
        setKeyIndex(next);
        document.getElementById(`line-${displayed[next].line.id}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      } else if ((e.key === "o" || e.key === "Enter") && keyedId) {
        if (e.key === "Enter" && t instanceof HTMLElement && t.closest("button, a")) return;
        e.preventDefault();
        toggleOpen(keyedId);
      } else if (e.key === "s" && keyedId) {
        updateMarks((m) => toggleStar(m, keyedId));
      } else if (e.key === "c" && keyedId) {
        toggleCompare(keyedId);
      } else if (e.key === "?") {
        setShowKeys((v) => !v);
      } else if (e.key === "Escape") {
        setKeyIndex(null);
        setShowKeys(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 2400);
    return () => clearTimeout(timer);
  }, [flashId]);

  // Exports follow the pilot's own ranking (best match), among lines they haven't hidden — a sort-by-days-off view is for looking, not for what to bid.
  const exportable = useMemo(() => matching.filter((r) => !hiddenSet.has(r.line.id)), [matching, hiddenSet]);
  const bidOrderEntries = useMemo<BidOrderEntry[]>(
    () =>
      exportable.map((r) => ({
        lineScore: r,
        rank: rankById.get(r.line.id) ?? 0,
        // The bid month, as each card counts it — not with what the last trip flies in the next.
        note: lineFactsText(buildLineFactChips(monthLine(r.line, bidPack), profile, bidMonthOf(bidPack))),
      })),
    [exportable, rankById, profile, bidPack]
  );
  const shortlistEntries = useMemo<BidOrderEntry[]>(
    () => bidOrderEntries.filter((e) => starredSet.has(e.lineScore.line.id)),
    [bidOrderEntries, starredSet]
  );

  // Same value on every line (it describes the pilot's profile, not any one line), so it's said once here instead of on all 283 cards.
  const confidenceLevel = ranked[0]?.confidenceLevel ?? null;

  const availableCities = useMemo(() => collectLayoverCities(bidPack.lines), [bidPack]);
  const touchedCities = useMemo(() => collectTouchedCities(bidPack.lines), [bidPack]);
  const filterOptions = useMemo(() => computeFilterOptions(bidPack.lines, bidPack.bidPeriodStart), [bidPack]);

  // Measured once per pack, for refitting a pilot model to their drags without re-measuring every trip each time.
  const hasPilotModel = !!profile.pilotModel;
  const packFacts = useMemo(() => (hasPilotModel ? prepareMetrics(bidPack) : null), [bidPack, hasPilotModel]);
  // With the pilot's looked-up flights, as the list on screen is scored: a drag learns from the order they saw.
  const packMetrics = useMemo(() => (packFacts && flights ? { ...packFacts, ctx: { ...packFacts.ctx, flights } } : packFacts), [packFacts, flights]);

  // Derived once from the bid pack's own printed times — see lib/circadian.ts.
  const homeBaseOffsetMinutes = useMemo(() => computeHomeBaseOffsetMinutes(bidPack), [bidPack]);

  useEffect(() => {
    if (!learnMessage) return;
    // Long enough to read, and to undo.
    const timer = setTimeout(() => setLearnMessage(null), 10000);
    return () => clearTimeout(timer);
  }, [learnMessage]);

  const sensors = useSensors(
    // A small activation distance so a plain tap/click to expand a card
    // (no real movement) never gets mistaken for the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // From the keyboard, Up and Down jump straight to the line above or below, so Space–arrow–Space swaps like a drop.
    useSensor(KeyboardSensor, { coordinateGetter: swapKeyboardCoordinates })
  );

  // What a screen reader hears while swapping: line numbers and places, never internal ids.
  const swapSpeech = useMemo(() => {
    const where = new Map(sorted.map((r, i) => [r.line.id, { number: r.line.lineNumber, place: i + 1 }]));
    const say = (id: string | number | undefined) => {
      const w = id === undefined ? undefined : where.get(String(id));
      return w ? `line ${w.number}, number ${w.place}` : "a line";
    };
    const announcements: Announcements = {
      onDragStart: ({ active }) => `Picked up ${say(active.id)}. Up and down arrows choose the line to swap with, Space swaps, Escape cancels.`,
      onDragOver: ({ active, over }) => (over && over.id !== active.id ? `Over ${say(over.id)}.` : `Back at ${say(active.id)}.`),
      onDragEnd: ({ active, over }) => (over && over.id !== active.id ? `Swapped ${say(active.id)} with ${say(over.id)}.` : `Put back. ${say(active.id)} hasn't moved.`),
      onDragCancel: ({ active }) => `Cancelled. ${say(active.id)} hasn't moved.`,
    };
    return { announcements, screenReaderInstructions: { draggable: "To swap this line with another, press Space, use the up and down arrows to choose the other line, then press Space again. Escape cancels." } };
  }, [sorted]);

  const activeLineScore = activeId ? ranked.find((r) => r.line.id === activeId) ?? null : null;
  // Drag-to-swap only means something in the pilot's own ranking order — in any other sort the visual order isn't the ranked order the judgment is built from.
  const dragEnabled = lineSort.isRanking;

  function handleDragStart(event: DragStartEvent) {
    setLayoutArmed(true);
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Positions in the list as shown: with filters, a view or hidden lines, a line only jumps over the ones on
    // screen, and the lines the pilot couldn't see say nothing about the move.
    const fromIndex = sorted.findIndex((r) => r.line.id === active.id);
    const toIndex = sorted.findIndex((r) => r.line.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;

    const judgments = buildJudgments(sorted, fromIndex, toIndex);
    // The two lines trade places and stay there, whatever the brain makes of it.
    const swapId = `swap-${Date.now().toString(36)}`;
    const placement = placementFromDrag(sorted.map((r) => r.line.id), fromIndex, toIndex, swapId);
    if (placement) updatePlacements((p) => [...p, placement]);
    const moved = sorted[fromIndex].line.lineNumber;
    const target = sorted[toIndex].line.lineNumber;
    const kept = `Swapped ${moved} and ${target} — they'll stay that way.`;
    const remember = (next: PreferenceProfile) => {
      onUpdateProfile(next);
      setLastSwap({ id: swapId, before: profile, after: next });
    };

    // A pilot ranked by their own model: the drag is a set of line choices, and their priorities refit to them.
    if (profile.pilotModel && placement) {
      const numberOf = new Map(sorted.map((r) => [r.line.id, r.line.lineNumber]));
      const order = placement.order.map((id) => numberOf.get(id)!);
      const higher = order[0];
      const lower = order[order.length - 1];
      // The swap shows at once. Working out why and refitting re-measures the pack — on the biggest pack and a slow
      // phone that's a second or two — so it waits until the swap has painted, and reads the newest profile when it runs
      // (two quick swaps both count), skipping a swap undone in the meantime.
      setLearnMessage(kept);
      afterPaint(() => {
        const current = profileRef.current;
        if (!current.pilotModel || !placementsRef.current.some((p) => p.id === swapId)) return;
        // Why, from the model the pilot was looking at when they swapped.
        // On the score the list shows — trip grades and each line's lean on its worst trip included.
        const before = new Map(rankLinesWithTrips(bidPack, current.pilotModel, { pack: packMetrics ?? undefined }).map((s) => [s.lineNumber, s]));
        const why = before.has(higher) && before.has(lower) ? explainSwap(before.get(higher)!, before.get(lower)!) : null;
        const choices = addDragChoices(current.brainInterview?.choices ?? [], choicesFromSwap(order, swapId, bidPack.id));
        const { profile: next, changes } = withModel(current, bidPack, { choices }, packMetrics ?? undefined);
        profileRef.current = next;
        onUpdateProfile(next);
        setLastSwap({ id: swapId, before: current, after: next });
        const said = why?.verdict === "limit" || why?.verdict === "agreed" ? null : describeChanges(changes);
        setLearnMessage([kept, why ? describeSwap(why, higher, lower) : null, said ? `Now ${said}.` : null].filter(Boolean).join(" "));
        // When the brain can't tell why, and it's time to ask: one question.
        const ask = askRef.current;
        ask.swapsSince += 1;
        if (!why || !packMetrics) return;
        const untracked = why.verdict === "unexplained" ? untrackedFactor(bidPack, packMetrics, current.pilotModel, higher, lower) : null;
        const question = pickSwapQuestion(why, { dragId: swapId, higher, lower }, ask, untracked);
        if (!question) return;
        askRef.current = { ...ask, asked: ask.asked + 1, swapsSince: 0, askedPairs: new Set(ask.askedPairs).add([higher, lower].sort().join("|")) };
        setSwapQuestion({ question, options: reasonOptions(bidPack, packMetrics, current.pilotModel, before, higher, lower) });
      });
      return;
    }

    const result = learnFromReorder(profile, implicitValuesByLine, judgments);

    if (result.updates.length === 0) {
      setLastSwap({ id: swapId, before: profile, after: profile });
      setLearnMessage(`${kept} Those lines look too similar on what I'm tracking to tell what to adjust.`);
      return;
    }

    // The gradient update always applies right away — even a high-surprise
    // judgment already made the model a little smarter before anyone
    // answers anything. The micro-prompt only ever adds a confidence bonus
    // on top, never gates whether learning happened at all (Section 5.2).
    remember({
      ...profile,
      weights: result.weights,
      implicitWeights: result.implicitWeights,
      implicitConfidence: result.implicitConfidence,
    });
    setLearnMessage(`${kept} ${describeLearn(result.updates)}`);

    if (result.mostSurprising && result.maxSurprise >= SURPRISE_THRESHOLD && promptCount < MAX_PROMPTS_PER_SESSION) {
      const pairId = [result.mostSurprising.favored.line.id, result.mostSurprising.overtaken.line.id]
        .sort()
        .join("|");
      if (!askedPairIds.has(pairId)) {
        setPromptJudgment(result.mostSurprising);
        setPromptCount((c) => c + 1);
        setAskedPairIds((prev) => new Set(prev).add(pairId));
      }
    }
  }

  /**
   * Takes back a swap: the lines go back, and so does what the brain learned from it. Right after the swap, with nothing
   * else changed since, the profile goes back exactly; otherwise the swap's line choices come out and the model refits
   * (a profile from the older interview keeps what it learned — its weights carry no record of which drag moved them).
   */
  function undoSwap(id: string) {
    updatePlacements((p) => p.filter((x) => x.id !== id));
    setLearnMessage(null);
    if (lastSwap?.id === id && lastSwap.after === profile) {
      if (lastSwap.before !== profile) onUpdateProfile(lastSwap.before);
    } else if (profile.pilotModel && profile.brainInterview?.choices.some((c) => c.dragId === id)) {
      onUpdateProfile(withModel(profile, bidPack, { choices: withoutDrag(profile.brainInterview.choices, id) }, packMetrics ?? undefined).profile);
    }
    if (lastSwap?.id === id) setLastSwap(null);
    if (swapQuestion?.question.dragId === id) setSwapQuestion(null);
  }

  /** Puts the list back in the brain's order. What it learned from the swaps stays; undo a swap to take that back too. */
  function clearPlacements() {
    updatePlacements(() => []);
    setLastSwap(null);
    setLearnMessage(null);
    setSwapQuestion(null);
  }

  /** The pilot's answer to the question after a swap: into their profile, the model refitted, and said back in a line. */
  function replyToSwap(reply: SwapReply) {
    if (!swapQuestion) return;
    const { question } = swapQuestion;
    const current = profileRef.current;
    const next = answerSwap(current, bidPack, question, reply, packMetrics ?? undefined);
    profileRef.current = next;
    onUpdateProfile(next);
    // Undoing the swap right after still puts back exactly what the pilot had before it, answer and all.
    setLastSwap((prev) => (prev && prev.id === question.dragId ? { ...prev, after: next } : prev));
    setSwapQuestion(null);
    const moved = current.pilotModel && next.pilotModel ? describeChanges(shareChanges(current.pilotModel, next.pilotModel)) : null;
    const said =
      reply.kind === "equal"
        ? `Got it — ${question.higher} stays where you put it, and I won't read anything into that swap.`
        : reply.kind === "note"
          ? "Noted — that's something a bid pack can't show, so it's kept with your priorities as you said it."
          : reply.kind === "limit"
            ? reply.action === "keep"
              ? "Kept as a dealbreaker."
              : reply.action === "drop"
                ? "No longer a dealbreaker — it still counts as one of your priorities."
                : "Limit moved to let that line through."
            : `Thanks${reply.option.criterionId ? "" : ` — added ${reply.option.label.toLowerCase()} to your priorities`}.`;
    setLearnMessage([said, moved ? `Now ${moved}.` : null].filter(Boolean).join(" "));
  }

  function stopAsking() {
    askRef.current = { ...askRef.current, stopped: true };
    setSwapQuestion(null);
    try {
      window.localStorage.setItem(STOP_ASKING_KEY, "1");
    } catch {
      // storage unavailable — it just asks again next visit
    }
  }

  function handlePromptResolved(reinforcedProfile: PreferenceProfile | null) {
    if (reinforcedProfile) onUpdateProfile(reinforcedProfile);
    setPromptJudgment(null);
  }

  const emptyMessage =
    view === "shortlist"
      ? "Nothing shortlisted yet — tap the star on any line to save it here."
      : view === "realistic"
        ? "No line matches the current filters among the ones you could realistically hold. Try clearing one or two."
      : search.trim()
        ? `No line matches “${search.trim()}”.`
        : hotelFilter
          ? `No line matches these filters at ${hotelFilter.hotelName}. Try clearing one or two.`
          : "No lines match the current filters. Try clearing one or two.";

  return (
    <div className="mx-auto w-full max-w-3xl xl:max-w-6xl">
      <div className="flex items-start justify-between gap-3 sm:items-end">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            {bidPack.base} &middot; {bidPack.aircraft} &middot; {bidPack.seat} &middot; {bidPack.month}
          </div>
          <Heading as="h1" className="mt-1.5 text-3xl text-ink sm:text-4xl">
            Your ranked lines
          </Heading>
          <p className="mt-1.5 text-sm text-ink-muted">
            {bidPack.lines.length} lines scored against what you told us
            {lineSort.isRanking ? <span className="hidden sm:inline"> &middot; best match first</span> : null}
          </p>
        </div>
        <Button variant="secondary" onClick={onEditPreferences} className="shrink-0 px-3 sm:px-4 print:hidden">
          <span className="sm:hidden">Edit</span>
          <span className="hidden sm:inline">Edit preferences</span>
        </Button>
      </div>

      <ResultsStatusPanel
        pack={bidPack}
        profile={profile}
        onUpdateProfile={onUpdateProfile}
        confidenceLevel={confidenceLevel}
        onEditPreferences={onEditPreferences}
        bidPeriodChange={bidPeriodChange}
        forecast={{
          hasList: !!bidPack.seniorityList?.length,
          forecast: hotelsSettled ? forecast.result?.forecast ?? null : null,
          response: forecast.result,
          loading: forecast.loading,
          failed: forecast.failed,
          realisticCount: realisticIds.size,
          showingRealistic: view === "realistic",
          onToggleRealistic: () => setView((v) => (v === "realistic" ? "all" : "realistic")),
          canShare: forecast.canShare,
          sharing: forecast.sharing,
          onSharingChange: forecast.setSharing,
        }}
      />
      <CarryInPanel bidPack={bidPack} profile={profile} carry={carry} order={ranked.map((r) => r.line.lineNumber)} />
      <FirstVisitTour ready={hotelsSettled} />
      <WheelsDown />
      <AskPackPanel key={bidPack.id} bidPack={bidPack} profile={profile} rankedIds={rankedIds} packMetrics={packMetrics} />
      {confirmingStartOver && (
        <ConfirmModal
          title="Start over from scratch?"
          confirmLabel="Yes, delete everything"
          destructive
          alternative={{ label: "Upload a new bid pack instead", onClick: onUploadNewPack }}
          onConfirm={onStartOver}
          onCancel={() => setConfirmingStartOver(false)}
        >
          <p>
            This deletes your bid pack <strong className="text-ink">and</strong> your saved preferences &mdash;
            including everything Line Select has learned about you over past months. It can&rsquo;t be undone.
          </p>
          <p>
            Bidding a new month? You don&rsquo;t need to start over &mdash; upload the new bid pack and your
            preferences carry forward.
          </p>
        </ConfirmModal>
      )}

      {learnMessage && !promptJudgment && (
        <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent animate-fade-in">
          <span>{learnMessage}</span>
          {lastSwap && validPlacements.some((p) => p.id === lastSwap.id) && (
            <button type="button" onClick={() => undoSwap(lastSwap.id)} className="shrink-0 font-semibold underline underline-offset-2 hover:text-ink print:hidden">
              Undo
            </button>
          )}
        </div>
      )}

      {promptJudgment && (
        <PreferenceMicroPrompt
          judgment={promptJudgment}
          profile={profile}
          implicitValuesByLine={implicitValuesByLine}
          onResolved={handlePromptResolved}
        />
      )}

      {swapQuestion && (
        <SwapQuestionCard
          key={swapQuestion.question.dragId}
          question={swapQuestion.question}
          options={swapQuestion.options}
          onReply={replyToSwap}
          onDismiss={() => setSwapQuestion(null)}
          onStop={stopAsking}
        />
      )}

      {flightsLooking && !flights && hotelsSettled && (
        <div role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
          <Spinner size="sm" />
          Looking up real airline flights for your top lines&hellip;
        </div>
      )}

      {flightsWaiting && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent">
          <span>Real commute flights for your top lines just came in &mdash; backups, and when you&rsquo;d really get home.</span>
          <Button
            variant="secondary"
            className="!px-3 !py-1.5"
            onClick={() => {
              setFlights(flightsWaiting);
              setFlightsWaiting(null);
            }}
          >
            Update my ranking
          </Button>
        </div>
      )}

      {hotelsArrivedLate && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent">
          Hotel reviews just finished loading &mdash; your ranking was updated to include them.
        </div>
      )}


      {!hotelsSettled ? (
        <div className="mt-6">
          <div role="status" className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
            <Spinner size="sm" />
            Checking layover hotel reviews so your ranking is right the first time&hellip;
          </div>
          <SkeletonCards />
        </div>
      ) : (
        <>
          {hotelFilter && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm text-ink">
              <span>
                Only lines with a layover at <span className="font-semibold">{hotelFilter.hotelName}</span>{" "}
                <span className="text-ink-muted">&middot; {hotelFilter.city}</span>
              </span>
              <button
                type="button"
                onClick={() => setHotelFilter(null)}
                className="shrink-0 font-medium text-brand underline decoration-dotted underline-offset-4 hover:text-brand-strong"
              >
                Show all lines
              </button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
            <div className="relative min-w-[9rem] flex-1 sm:max-w-[14rem]">
              <input
                type="search"
                inputMode="numeric"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Line #"
                aria-label="Find a line by number"
                className="w-full rounded-md border border-hairline bg-canvas/50 px-3 py-2 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </div>
            <SortMenu sort={lineSort} lines={listable} />
            <div className="ml-auto flex overflow-hidden rounded-md border border-hairline text-sm" role="tablist" aria-label="Which lines to show">
              <button
                type="button"
                role="tab"
                aria-selected={view === "all"}
                onClick={() => setView("all")}
                className={`relative px-3 py-2 font-medium transition-colors duration-300 ${view === "all" ? "text-accent" : "text-ink-muted hover:text-ink"}`}
              >
                {view === "all" && <PillHighlight group="results-view" className={VIEW_PILL} />}
                <span className="relative">All lines</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "shortlist"}
                data-shortlist-tab
                onClick={() => setView("shortlist")}
                className={`relative border-l border-hairline px-3 py-2 font-medium transition-colors duration-300 ${view === "shortlist" ? "text-accent" : "text-ink-muted hover:text-ink"}`}
              >
                {view === "shortlist" && <PillHighlight group="results-view" className={VIEW_PILL} />}
                <span className="relative">
                  Shortlist (<FlipText text={String(validMarks.starred.length)} />)
                </span>
              </button>
              {forecastLines && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "realistic"}
                  onClick={() => setView("realistic")}
                  className={`relative border-l border-hairline px-3 py-2 font-medium transition-colors duration-300 ${view === "realistic" ? "text-accent" : "text-ink-muted hover:text-ink"}`}
                >
                  {view === "realistic" && <PillHighlight group="results-view" className={VIEW_PILL} />}
                  <span className="relative">Realistic ({realisticIds.size})</span>
                </button>
              )}
            </div>
          </div>

          <SortNote sort={lineSort} />

          {/* A small staggered beat behind the header above — the page reads as "header settles, then controls, then the list below" instead of everything landing in one flat instant. */}
          <div className="animate-rise-in print:hidden" style={{ animationDelay: "60ms" }}>
            <ResultsFilterBar
              filters={filters}
              onChange={setFilters}
              options={filterOptions}
              availableCities={availableCities}
              touchedCities={touchedCities}
              commute={commute}
              visibleCount={matching.length}
              totalCount={ranked.length}
            />
          </div>

          <div className="animate-rise-in print:hidden" style={{ animationDelay: "120ms" }}>
            <BidOrderExport
              entries={bidOrderEntries}
              shortlistEntries={shortlistEntries}
              bidPeriodStart={bidPack.bidPeriodStart}
              packLabel={[bidPack.month, bidPack.base, bidPack.aircraft, bidPack.seat].join(" · ")}
              leftOut={bidPack.lines.length - exportable.length}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <StripKey view={stripView} />
            <StripViewToggle view={stripView} onChange={setStripView} />
          </div>

          {showKeys && (
            <div role="note" className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-hairline bg-canvas/40 px-3 py-2 font-mono text-[11px] text-ink-muted sm:flex print:hidden">
              {[
                ["j / k", "next / previous line"],
                ["o", "open / close it"],
                ["s", "shortlist"],
                ["c", "compare"],
                ["⌘K", "jump to a line"],
                ["esc", "clear"],
              ].map(([k, what]) => (
                <span key={k}>
                  <kbd className="rounded border border-hairline bg-surface px-1.5 py-0.5 text-ink">{k}</kbd> {what}
                </span>
              ))}
            </div>
          )}

          {dragEnabled && (
            <p className="mt-2 hidden text-xs text-ink-faint sm:block print:hidden">
              Ranked something wrong? Drag a line by its handle onto another to swap them &mdash; they stay where you put
              them, and each swap teaches Line Select what you actually care about. Press{" "}
              <kbd className="rounded border border-hairline px-1 font-mono">?</kbd> for keyboard shortcuts.
            </p>
          )}

          {dragEnabled && validPlacements.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted print:hidden">
              <span>
                {validPlacements.length === 1 ? "1 swap" : `${validPlacements.length} swaps`} of yours kept in this order.
              </span>
              <button type="button" onClick={() => undoSwap(validPlacements[validPlacements.length - 1].id)} className="font-semibold text-accent underline-offset-2 hover:underline">
                Undo last swap
              </button>
              <button type="button" onClick={clearPlacements} className="font-semibold text-accent underline-offset-2 hover:underline">
                Back to Line Select&rsquo;s order
              </button>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            // This is a swap-on-drop interaction, not a live-reordering sortable
            // list — no card moves or resizes until the drop actually happens,
            // so every droppable's rect is still valid for the whole gesture.
            // dnd-kit's default measures every droppable's rect on every pointer
            // move to support layouts that DO reflow mid-drag; measuring once at
            // drag start is correct here and removes that cost entirely.
            measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
            accessibility={swapSpeech}
          >
            <div ref={listRef} className="mt-3 space-y-1.5">
              {displayed.length > 0 && <BidPackHeader columns={columns} layout={layout} />}
              {displayed.length === 0 && filtersActive(filters) && <FilterBlameList lines={bidPack.lines} filters={filters} ctx={filterCtx} onChange={setFilters} />}
              {displayed.length === 0 ? (
                <EmptyState
                  compact
                  description={emptyMessage}
                  {...(view !== "shortlist" && (filtersActive(filters) || search.trim() || hotelFilter)
                    ? {
                        actionLabel: "Clear filters and search",
                        onAction: () => {
                          setFilters(EMPTY_FILTERS);
                          setSearch("");
                          setHotelFilter(null);
                        },
                      }
                    : {})}
                />
              ) : (
                displayed.slice(0, mountedCount).map((lineScore, index) => (
                  <motion.div
                    key={lineScore.line.id}
                    id={`line-${lineScore.line.id}`}
                    className={`scroll-mt-20 md:scroll-mt-6 ${flashId === lineScore.line.id ? "line-flash" : ""} ${keyedId === lineScore.line.id ? "line-keyed" : ""}`}
                    layout={dragEnabled && layoutArmed && order.moved.has(lineScore.line.id) ? "position" : false}
                    initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : {
                            layout: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
                            opacity: { duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: Math.min(index * 0.035, 0.4) },
                            y: { duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: Math.min(index * 0.035, 0.4) },
                          }
                    }
                  >
                    <ErrorBoundary>
                      <LineCard
                        rank={rankById.get(lineScore.line.id) ?? 0}
                        lineScore={lineScore}
                        profile={profile}
                        implicitValuesByLine={implicitValuesByLine}
                        homeBaseOffsetMinutes={homeBaseOffsetMinutes}
                        bidPeriodStart={bidPack.bidPeriodStart}
                        bidPeriodDays={bidPack.bidPeriodDays}
                        isComparing={compareIds.includes(lineScore.line.id)}
                        onToggleCompare={() => toggleCompare(lineScore.line.id)}
                        starred={starredSet.has(lineScore.line.id)}
                        onToggleStar={() => updateMarks((m) => toggleStar(m, lineScore.line.id))}
                        hidden={hiddenSet.has(lineScore.line.id)}
                        onHide={() => updateMarks((m) => hideLine(m, lineScore.line.id))}
                        onRestore={() => updateMarks((m) => restoreLine(m, lineScore.line.id))}
                        draggable={dragEnabled}
                        forecast={forecastLines?.[lineScore.line.id] ?? null}
                        homeBase={bidPack.base}
                        flights={flights}
                        tripScores={tripScores}
                        packColumns={columns}
                        stripLayout={layout}
                        stripView={stripView}
                        open={openIds.has(lineScore.line.id)}
                        onToggleOpen={() => toggleOpen(lineScore.line.id)}
                        placedByYou={dragEnabled && swappedIds.has(lineScore.line.id)}
                        sortedBy={openIds.has(lineScore.line.id) ? lineSort.def.label : undefined}
                        sortedValue={openIds.has(lineScore.line.id) ? lineSort.valueFor(lineScore.line.id) : null}
                      />
                    </ErrorBoundary>
                    <CarryInLineNote flown={carry.flown.lines.get(lineScore.line.id)} />
                  </motion.div>
                ))
              )}
            </div>
            <DragOverlay>{activeLineScore && <DragPreview lineScore={activeLineScore} />}</DragOverlay>
          </DndContext>

          {sorted.length > displayed.length && (
            <div className="panel-glass mt-4 flex flex-col items-center gap-2 px-4 py-4 text-center">
              <p className="text-sm text-ink-muted">
                Showing {displayed.length} of {sorted.length} lines
                {view === "all" && lineSort.isRanking ? " — the best matches first" : ""}.
              </p>
              <div className="flex flex-wrap justify-center gap-2 print:hidden">
                <Button
                  variant="secondary"
                  onClick={() => setPageState({ key: listKey, shown: nextVisibleCount(shown, sorted.length) })}
                >
                  Show {Math.min(PAGE_SIZE, sorted.length - displayed.length)} more
                </Button>
                <Button variant="ghost" onClick={() => setPageState({ key: listKey, shown: sorted.length })}>
                  Show all {sorted.length}
                </Button>
              </div>
            </div>
          )}

          {hiddenMatchingCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="mt-3 text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
            >
              {showHidden ? "Hide the" : "Show the"} {hiddenMatchingCount} line{hiddenMatchingCount === 1 ? "" : "s"} you hid
            </button>
          )}
        </>
      )}

      {compareLineScores.length === 1 && (
        <div
          role="status"
          data-bottom-bar
          className="animate-toast-in fixed bottom-[calc(var(--shell-bottom)+1rem)] left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-accent/40 bg-surface/95 py-2 pl-4 pr-2 text-sm text-ink shadow-elevated-lg backdrop-blur md:left-[calc(50%+var(--shell-left)/2)] print:hidden"
        >
          <span>
            <span className="font-semibold">Line {compareLineScores[0].line.lineNumber}</span>
            <span className="text-ink-muted">
              {" "}
              picked &mdash; <span className="sm:hidden">pick one more</span>
              <span className="hidden sm:inline">choose another to compare</span>
            </span>
          </span>
          <button
            type="button"
            onClick={() => setCompareIds([])}
            className="rounded-full px-3 py-1 text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {compareLineScores.length === 2 && (
        <LineComparisonModal
          lineScores={[compareLineScores[0], compareLineScores[1]]}
          homeBaseOffsetMinutes={homeBaseOffsetMinutes}
          bidPeriodStart={bidPack.bidPeriodStart}
          bidPeriodDays={bidPack.bidPeriodDays}
          cityPreferences={cityMarks(profile.cityRatings, profile.cityPreferences, bidMonthOf(bidPack))}
          departureOptions={monthDepartureOptions(bidPack.base, profile, flights)}
          onClose={() => setCompareIds([])}
        />
      )}

      <div className="mt-10 border-t border-border pt-5 text-center">
        <button
          type="button"
          onClick={() => setConfirmingStartOver(true)}
          className="text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-danger"
        >
          Start over from scratch
        </button>
      </div>
    </div>
  );
}
