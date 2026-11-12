"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { QuickStartNote } from "@/components/results/QuickStartNote";
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
import { VacationChoicePanel } from "@/components/results/VacationChoicePanel";
import { LineCard, type LineCardActions } from "@/components/results/LineCard";
import { AskPackPanel } from "@/components/results/AskPackPanel";
import { FirstVisitTour } from "@/components/results/FirstVisitTour";
import { WheelsDown } from "@/components/results/WheelsDown";
import { ResultsStatusPanel } from "@/components/results/ResultsStatusPanel";
import { ScoreRing } from "@/components/results/ScoreRing";
import { BidPackHeader, StripKey, StripViewToggle, stripLayout } from "@/components/results/BidPackStrip";
import { stripViewFor, useStripView, type StripViewMode } from "@/lib/strip-view-storage";
import { useMeasuredWidth } from "@/components/results/LegBars";
import { packColumns } from "@/lib/bidpack-row";
import { monthLine } from "@/lib/bid-month";
import { bidMonthOf, cityMarks } from "@/lib/city-ratings";
import { monthDepartureOptions } from "@/lib/month-detail";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { cachedFlightAnswers, lookUpFlights } from "@/lib/flights/client";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { scoreTripsV2, type TripScore } from "@/lib/scoring-v2/trip-score";
import { measuredPack, rankingPack } from "@/lib/scoring-v2/adapter";
import { columnCountOf, layoverCitiesOf, touchedCitiesOf, useRankingWarmUp } from "@/lib/ranking-warm-up";
import { fetchAllHotelQualityData, settledHotelQualityData } from "@/lib/hotel-client";
import { implicitLineValuesFor } from "@/lib/implicit-dimensions";
import { useBidForecast } from "@/lib/forecast/use-bid-forecast";
import { useHeldBy } from "@/lib/use-held-by";
import { loadPreviousPeriodSnapshot, saveBidPeriodSnapshot, summarizeBidPeriodChange } from "@/lib/bid-period-history";
import { assessProfileRichness } from "@/lib/interview-engine";
import { filterOptionsFor } from "@/lib/line-filter-options";
import { EMPTY_FILTERS, filtersActive, filtersKey, lineMatchesFilters, type FilterContext, type LineFilters } from "@/lib/line-filters";
import { useCommuteCheck } from "@/lib/use-commute-check";
import { loadTopLinesSnapshot, saveTopLinesSnapshot } from "@/lib/line-history-storage";
import { buildLineFactChips, lineFactsText } from "@/lib/line-summary";
import { lineMarksStore, marksKey } from "@/lib/line-marks-storage";
import { useSharedList } from "@/lib/shared-store";
import { useWindowedRows } from "@/lib/use-windowed-rows";
import { PHRASES } from "@/lib/preference-summary";
import {
  PAGE_SIZE,
  bidOrderLines,
  hideLine,
  leftOutPhrase,
  matchesLineSearch,
  nextVisibleCount,
  pruneMarks,
  restoreLine,
  stepCursor,
  toggleStar,
  EMPTY_MARKS,
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
import { rankedAsFlown } from "@/lib/vacation-lines";
import { useCarryIn } from "@/lib/use-carry-in";
import { SortMenu, SortNote } from "@/components/results/SortMenu";
import { TierBar, TierHeadingRow, TierMoveRow, useCardPressProps } from "@/components/results/TierBar";
import { tierHeadings } from "@/lib/line-tiers";
import { useLineSort } from "@/lib/use-line-sort";
import { useLineTiers, type TeachTiers } from "@/lib/use-line-tiers";
import { applyPlacements, placementFromDrag, placementsKey, placementsStore, prunePlacements, type Placement } from "@/lib/line-placements";
import { EMPTY_ORDER_HISTORY, dropSwaps, recordStep, takeRedo, takeUndo, type OrderHistory } from "@/lib/order-history";
import type { LineChoice } from "@/types/pilot-model";
import type { PackMetrics } from "@/lib/metrics/compute";
import { rankLines, type HotelQualityData, type LineScore } from "@/lib/scoring";
import { lineHasHotel, type HotelFilter } from "@/lib/hotel-filter";
import { FlipText } from "@/components/ui/FlipText";
import { PillHighlight } from "@/components/ui/PillHighlight";
import { setRankingSnapshot } from "@/lib/ranking-snapshot";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";

/**
 * Compare's dialog, loaded apart from the page and drawn only once it's here. Not `next/dynamic`: its lazy component
 * suspends on its first render however early the code was fetched, and React holds a fallback it has shown for 300 ms,
 * so the first Compare took a third of a second longer than every one after. Fetched when the page goes idle, and
 * again (a no-op by then) when the pilot picks a first line to compare.
 */
type ComparisonModal = typeof import("@/components/results/LineComparisonModal").LineComparisonModal;
let comparisonModal: ComparisonModal | null = null;
let comparisonLoad: Promise<ComparisonModal> | null = null;
function loadComparisonModal(): Promise<ComparisonModal> {
  comparisonLoad ??= import("@/components/results/LineComparisonModal").then((m) => (comparisonModal = m.LineComparisonModal));
  // A failed fetch (offline for a moment) is tried again next time rather than remembered.
  comparisonLoad.catch(() => (comparisonLoad = null));
  return comparisonLoad;
}

/** The pieces a card only shows when opened, fetched while the pilot is still reading the list, so opening one never waits. */
function warmUpDetails() {
  void import("@/components/results/TripList");
  void import("@/components/results/RouteMap");
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

/**
 * A line not drawn yet, off the screen: its room in the list, and its number, so the list reads in order to a screen
 * reader, Find in page finds the line, and a link or a key can scroll to it. Drawn in full once it's near the screen.
 */
function LineStandIn({ id, lineNumber, height }: { id: string; lineNumber: string; height: number }) {
  return (
    <div id={`line-${id}`} className="panel-glass scroll-mt-20 px-4 py-3 font-mono text-[12px] font-semibold leading-[14px] tracking-wide text-ink-faint md:scroll-mt-6" style={{ height }}>
      LINE {lineNumber}
    </div>
  );
}

/** Each line's note for "Copy with notes", worked out when first asked for and kept. */
function lineNotes(bidPack: BidPack, profile: PreferenceProfile): (line: LineScore["line"]) => string {
  const notes = new Map<string, string>();
  return (line) => {
    const kept = notes.get(line.id);
    if (kept !== undefined) return kept;
    const made = lineFactsText(buildLineFactChips(monthLine(line, bidPack), profile, bidMonthOf(bidPack)));
    notes.set(line.id, made);
    return made;
  };
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

/**
 * A swap in the undo history: its placement and, once it's been undone, what a redo needs to put back what the brain
 * learned from it — the profile itself when nothing has changed since, or else the line choices it taught.
 */
interface SwapStep {
  placement: Placement;
  lesson?: LineChoice[];
  exact?: { before: PreferenceProfile; after: PreferenceProfile };
}

/** How long to hold the list back waiting on hotel reviews before showing it anyway. Hotel data changes scores, so showing the list first and then reshuffling it under a pilot who's already reading is worse than a short wait. */
const HOTEL_WAIT_MS = 6000;

const NO_PLACEMENTS: Placement[] = [];
const NO_IMPLICIT_VALUES: Record<string, Record<string, number>> = {};
const NO_CITIES: string[] = [];
const NO_COLUMNS: ReturnType<typeof packColumns> = [];

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
  // pass per card as the list mounts, so it's switched on only once a pilot actually starts dragging. Once on it stays
  // on: switching a card's layout tracking off and on again each swap left a listener behind every time, holding that
  // render's whole list (about 3 MB a swap); which cards it measures is said by `layoutDependency` instead.
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
  // Stars and hidden lines, and the lines the pilot swapped by hand, which stay where they put them (see
  // `lib/line-placements.ts`). The pilot's own, per pack: reloaded for a new pack, and when the session check finds an
  // account after the app first showed this device's guest data. Shared with the pack's other tabs, so a star or a
  // swap made in one isn't written over by another (see `lib/shared-store.ts`).
  const marksList = useSharedList<LineMarks>(marksKey(userId, bidPack.id), lineMarksStore(userId, bidPack.id), EMPTY_MARKS);
  const marks = marksList.value;
  const placementsList = useSharedList<Placement[]>(placementsKey(userId, bidPack.id), placementsStore(userId, bidPack.id), NO_PLACEMENTS);
  const placements = placementsList.value;
  // The latest swap, with the profile from just before it and just after: undoing it while nothing else has changed
  // puts back exactly what the pilot had.
  const [lastSwap, setLastSwap] = useState<{ id: string; before: PreferenceProfile; after: PreferenceProfile } | null>(null);
  // ⌘Z, Undo and Redo: one history, newest first, across tier changes and swaps (see `lib/order-history.ts`). Kept for
  // one pilot and pack, as the tiers' own is; mirrored in a ref, so two quick presses each take the step the one
  // before left.
  const historyOwner = `${userId}|${bidPack.id}`;
  const [orderHistoryState, setOrderHistoryState] = useState<{ owner: string; history: OrderHistory<SwapStep> }>({ owner: historyOwner, history: EMPTY_ORDER_HISTORY });
  const orderHistoryRef = useRef(orderHistoryState);
  const orderHistory = orderHistoryState.owner === historyOwner ? orderHistoryState.history : EMPTY_ORDER_HISTORY;
  /** The newest history, for a key or a button pressed before the last change has rendered. */
  const heldHistory = useCallback(() => (orderHistoryRef.current.owner === historyOwner ? orderHistoryRef.current.history : EMPTY_ORDER_HISTORY), [historyOwner]);
  const setOrderHistory = useCallback(
    (change: (h: OrderHistory<SwapStep>) => OrderHistory<SwapStep>) => {
      orderHistoryRef.current = { owner: historyOwner, history: change(heldHistory()) };
      setOrderHistoryState(orderHistoryRef.current);
    },
    [historyOwner, heldHistory]
  );
  const recordTierStep = useCallback(() => setOrderHistory((h) => recordStep(h, { kind: "tier" })), [setOrderHistory]);
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
  // The last swap is the last pilot's and pack's (their marks and swaps reload themselves, above).
  const marksOwner = `${userId}|${bidPack.id}`;
  const [marksFor, setMarksFor] = useState(marksOwner);
  if (marksOwner !== marksFor) {
    setMarksFor(marksOwner);
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
  // `lookedUp`: the flights as they come in. The page ranks with `flights` (below): the same, once they're measured.
  const [lookedUp, setFlights] = useState<FlightAnswers | null>(() => (typeof window === "undefined" ? null : cachedFlightAnswers(bidPack, pilotModel)));
  const [flightsWaiting, setFlightsWaiting] = useState<FlightAnswers | null>(null);
  const [flightsLooking, setFlightsLooking] = useState(false);

  // The list is held back until hotel data lands (or the wait runs out) so
  // the ranking a pilot starts reading is the ranking they keep — hotel
  // reviews move scores, and a top-3 that reshuffles a few seconds in reads
  // as the app changing its mind.
  const hotelsSettled = !caresAboutHotel || hotelDone || hotelTimedOut;
  const hotelsArrivedLate = caresAboutHotel && hotelTimedOut && hotelDone;


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

  const carry = useCarryIn(bidPack, userId, profile);
  // The first ranking's slow part — every trip's body-clock points and facts, each measure on every line — worked out a
  // slice at a time first, while the page says it's ranking, instead of freezing it for seconds (see
  // `lib/ranking-warm-up.ts`). Flights that land later are measured the same way before the ranking takes them.
  const circadianTolerance = typeof profile.explicitTargets.circadianTolerance === "number" ? profile.explicitTargets.circadianTolerance : null;
  const warmUp = useRankingWarmUp(bidPack, carry.flown.pack, pilotModel, circadianTolerance, lookedUp);
  const flights = warmUp.flights;
  // Looked up once the ranking's work is done: picking the lines to look up ranks the pack too, and done first it was
  // the same multi-second stall, before the page could say anything.
  const lookUpReady = warmUp.ready;
  useEffect(() => {
    if (!lookUpReady) return;
    let cancelled = false;
    const mountedAt = Date.now();
    // A different pack or pilot starts from what's kept for it.
    const had = cachedFlightAnswers(bidPack, pilotModel);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlights(had);
    setFlightsWaiting(null);
    setFlightsLooking(true);
    // In a task of its own, after the ranking that just rendered has painted (picking the lines to look up ranks too).
    const start = window.setTimeout(() =>
      lookUpFlights(bidPack, pilotModel).then((a) => {
        if (cancelled) return;
        setFlightsLooking(false);
        if (!a) return;
        if (had && Object.keys(a).length === Object.keys(had).length) return;
        if (!had && Date.now() - mountedAt < HOTEL_WAIT_MS) setFlights(a);
        else setFlightsWaiting(a);
      })
    );
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [bidPack, pilotModel, lookUpReady]);
  // The list shows once it's ranked and, for a pilot who cares about hotels, their reviews are in.
  const listReady = warmUp.ready && hotelsSettled;

  // The implicit taxonomy's normalized per-line values only depend on the
  // bid pack's own trip data, never on the pilot's weights — computed once
  // per bid pack (with the warm-up, and kept with the pack) and reused both
  // by scoring below and by every drag judgment, rather than recomputed per use.
  const implicitValuesByLine = useMemo(() => (warmUp.ready ? implicitLineValuesFor(bidPack) : NO_IMPLICIT_VALUES), [bidPack, warmUp.ready]);
  const scoredLines = useMemo(
    () => (warmUp.ready ? rankedAsFlown(rankLines(carry.flown.pack, profile, hotelQualityData, implicitValuesByLine, profileRichness, priorTopLines, flights ?? undefined), bidPack, carry.flown) : []),
    [warmUp.ready, bidPack, carry.flown, profile, hotelQualityData, implicitValuesByLine, profileRichness, priorTopLines, flights]
  );
  // Placements for lines that no longer exist never leak in, as with marks.
  const validPlacements = useMemo(() => prunePlacements(placements, new Set(bidPack.lines.map((l) => l.id))), [placements, bidPack]);
  // The pilot's order: the brain's ranking with every swap they made kept where they made it. Rank numbers, the bid
  // order and the forecast all follow it — it's what they'll bid.
  const placed = useMemo(() => applyPlacements(scoredLines, validPlacements, (r) => r.line.id), [scoredLines, validPlacements]);
  // The pilot's tiers on top of that (see `lib/line-tiers.ts`); a pilot who never uses them gets the same list back.
  const teachTiersRef = useRef<TeachTiers | null>(null);
  const packLineIds = useMemo(() => bidPack.lines.map((l) => l.id), [bidPack]);
  const tiers = useLineTiers(userId, bidPack.id, packLineIds, placed, teachTiersRef, recordTierStep);
  const orderByTier = tiers.order;
  const ranked = useMemo(() => orderByTier(placed), [orderByTier, placed]);
  // Both lines of every swap the pilot made: tagged "Your order", since their scores can now read out of order.
  const swappedIds = useMemo(() => new Set(validPlacements.flatMap((p) => [p.order[0], p.order[p.order.length - 1]])), [validPlacements]);
  const rankedIds = useMemo(() => ranked.map((r) => r.line.id), [ranked]);
  // Every trip's own score, from the same priorities that rank the lines — shown on each trip in an opened line's trip
  // list. On the ranking's own measured pack, so a refit re-scores trips without re-measuring them. Only an open line
  // shows them, so with none open they're worked out when the page goes idle, not inside the ranking's own render.
  const scoreTrips = useCallback(
    (model: NonNullable<typeof pilotModel>) => scoreTripsV2(bidPack, model, { flights: flights ?? undefined, onLineScale: true, pack: rankingPack(bidPack, flights ?? undefined) }),
    [bidPack, flights]
  );
  const [idleTripScores, setIdleTripScores] = useState<{ model: typeof pilotModel; score: typeof scoreTrips; scores: Map<string, TripScore> } | null>(null);
  const tripScoresHeld = !!pilotModel && idleTripScores?.model === pilotModel && idleTripScores.score === scoreTrips;
  useEffect(() => {
    if (!pilotModel || !listReady || tripScoresHeld) return;
    const work = () => setIdleTripScores({ model: pilotModel, score: scoreTrips, scores: scoreTrips(pilotModel) });
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(work, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(work, 300);
    return () => window.clearTimeout(id);
  }, [pilotModel, listReady, tripScoresHeld, scoreTrips]);
  const anyOpen = openIds.size > 0;
  const tripScores = useMemo(
    () => (tripScoresHeld ? idleTripScores!.scores : pilotModel && anyOpen ? scoreTrips(pilotModel) : null),
    [tripScoresHeld, idleTripScores, pilotModel, anyOpen, scoreTrips]
  );

  const updateMarks = marksList.update;

  // The newest profile, for learning that runs after a swap has painted (see `handleDragEnd`). The newest placements
  // are `placementsList.current()`.
  const profileRef = useRef(profile);
  const packMetricsRef = useRef<PackMetrics | null>(null);
  useLayoutEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // What a tier move teaches goes the way a swap's does: after it's painted, on the newest profile.
  useEffect(() => {
    teachTiersRef.current = (add, retract) => {
      // Read now, before the learning below runs: what each retracted move taught, for an undo to give back.
      const held = profileRef.current.brainInterview?.choices ?? [];
      const removed = Object.fromEntries(retract.map((id) => [id, held.filter((c) => c.dragId === id)]));
      afterPaint(() => {
        const current = profileRef.current;
        if (!current.pilotModel) return;
        let choices = current.brainInterview?.choices ?? [];
        for (const id of retract) choices = withoutDrag(choices, id);
        if (add.length) choices = addDragChoices(choices, add);
        const { profile: next } = withModel(current, bidPack, { choices }, packMetricsRef.current ?? undefined);
        profileRef.current = next;
        onUpdateProfile(next);
      });
      return removed;
    };
  }, [bidPack, onUpdateProfile]);

  const updatePlacements = placementsList.update;

  // Marks for lines that no longer exist (an older pack under the same id) never leak into counts.
  const validMarks = useMemo(() => pruneMarks(marks, new Set(bidPack.lines.map((l) => l.id))), [marks, bidPack]);
  const starredSet = useMemo(() => new Set(validMarks.starred), [validMarks]);
  const hiddenSet = useMemo(() => new Set(validMarks.hidden), [validMarks]);

  // Compare's dialog once its code is here; until then a second pick waits for it, with the first line still picked.
  const [Comparison, setComparison] = useState<ComparisonModal | null>(() => comparisonModal);
  const toggleCompare = useCallback((lineId: string) => {
    if (!comparisonModal) void loadComparisonModal().then((c) => setComparison(() => c), () => {});
    setCompareIds((prev) => {
      if (prev.includes(lineId)) return prev.filter((id) => id !== lineId);
      return prev.length < 2 ? [...prev, lineId] : [prev[1], lineId];
    });
  }, []);
  // What every card does, made once: a card re-renders only when what it shows changes (see `LineCardActions`).
  const cardActions = useMemo<LineCardActions>(
    () => ({
      toggleOpen,
      toggleCompare,
      toggleStar: (id) => updateMarks((m) => toggleStar(m, id)),
      hide: (id) => updateMarks((m) => hideLine(m, id)),
      restore: (id) => updateMarks((m) => restoreLine(m, id)),
    }),
    [toggleOpen, toggleCompare, updateMarks]
  );
  const compareLineScores = compareIds
    .map((id) => ranked.find((r) => r.line.id === id))
    .filter((r): r is LineScore => !!r);

  // Keeps this cycle's own top lines current in storage as the pilot
  // refines their ranking (drag-to-swap, preference nudges), so whatever was
  // true the last time they looked at results is what a future cycle's
  // "historically preferred" comparison reads — not just a one-time snapshot
  // from the moment they first landed here.
  useEffect(() => {
    if (!listReady) return;
    saveTopLinesSnapshot(userId, bidPack.month, ranked);
    saveBidPeriodSnapshot(userId, bidPack.month, ranked);
  }, [userId, ranked, listReady, bidPack.month]);

  const bidPeriodChange = useMemo(
    () => summarizeBidPeriodChange(previousPeriodSnapshot, ranked),
    [previousPeriodSnapshot, ranked]
  );

  // Global rank survives filtering — a filtered card or export entry always
  // shows its true position in the full ranking, not a renumbered index into
  // whatever subset currently matches the filters.
  const rankById = useMemo(() => new Map(ranked.map((r, i) => [r.line.id, i + 1] as const)), [ranked]);
  useEffect(() => {
    if (!listReady) return;
    setRankingSnapshot({ bidPackId: bidPack.id, byLineId: new Map(ranked.map((r, i) => [r.line.id, { rank: i + 1, score: r.score }])) });
  }, [ranked, listReady, bidPack.id]);

  // The pilot's chance at every line, given where their seniority number puts them in bid order — held until the ranking has settled, since it's a forecast of *this* ranking.
  const rankingLineIds = useMemo(() => ranked.map((r) => r.line.id), [ranked]);
  const forecast = useBidForecast({
    bidPack,
    rankingLineIds: listReady ? rankingLineIds : [],
    implicitValuesByLine,
    seniorityNumber: profile.seniorityNumber,
    userId,
    enabled: listReady,
  });
  const forecastLines = forecast.result?.forecast.lines ?? null;
  const heldByNotes = useHeldBy(bidPack, userId, profile.seniorityNumber);
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
    () => matching.filter((r) => (showHidden || !hiddenSet.has(r.line.id)) && !tiers.setAside.has(r.line.id) &&
        (view === "all" || (view === "shortlist" ? starredSet.has(r.line.id) : realisticIds.has(r.line.id)))
    ),
    [matching, showHidden, hiddenSet, tiers.setAside, view, starredSet, realisticIds]
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
  const displayed = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
  const listedIds = useMemo(() => sorted.map((r) => r.line.id), [sorted]);
  const headings = useMemo(() => (lineSort.isRanking ? tierHeadings(listedIds, tiers.state) : new Map()), [lineSort.isRanking, listedIds, tiers.state]);
  const displayedIds = useMemo(() => displayed.map((r) => r.line.id), [displayed]);

  // Which cards changed place since the last render: only those animate into their new place. Measuring every card's
  // layout on each re-rank was much of the freeze after a swap on a big pack. Adjusted during render, React's documented
  // pattern for state derived from a change. `turn` counts the changes: a moved card's layout is measured once per move.
  const orderKey = displayedIds.join(",");
  const [order, setOrder] = useState({ key: orderKey, moved: new Set<string>(), turn: 0 });
  if (order.key !== orderKey) {
    const before = new Map(order.key.split(",").map((id, i) => [id, i] as const));
    setOrder({ key: orderKey, moved: new Set(displayed.flatMap((r, i) => (before.has(r.line.id) && before.get(r.line.id) !== i ? [r.line.id] : []))), turn: order.turn + 1 });
  }

  useEffect(() => {
    let live = true;
    const warmUp = () => {
      warmUpDetails();
      loadComparisonModal().then(
        (c) => live && setComparison(() => c),
        () => {}
      );
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warmUp, { timeout: 3000 });
      return () => {
        live = false;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(warmUp, 1500);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, []);

  // A line asked for by number: make sure it's listed (clearing whatever filter or view hides it, and paging far enough
  // down), then scroll to it and light it up. Its row is there from the first render, drawn or standing in.
  const [flashId, setFlashId] = useState<string | null>(null);
  // The ask already answered, while the address catches up — so more cards mounting doesn't scroll back to it.
  const focusDone = useRef<string | null>(null);
  // Filters are cleared once per ask: cleared on every pass, a line they couldn't bring back kept wiping each new one.
  const focusCleared = useRef<string | null>(null);
  const focusTarget = focusLine && listReady ? ranked.find((r) => r.line.lineNumber === focusLine) ?? null : null;
  const focusIndex = focusTarget ? sorted.indexOf(focusTarget) : -1;
  useEffect(() => {
    if (!focusLine) focusDone.current = null;
    if (!focusLine || !listReady || focusDone.current === focusLine) return;
    if (!focusTarget) {
      onFocusHandled?.();
      return;
    }
    if (focusIndex === -1) {
      // A line set aside is never listed: asked for by name, it comes back.
      if (tiers.setAside.has(focusTarget.line.id)) {
        tiers.unpark([focusTarget.line.id]);
        return;
      }
      if (focusCleared.current === focusLine) {
        focusDone.current = focusLine;
        onFocusHandled?.();
        return;
      }
      focusCleared.current = focusLine;
      setFilters(EMPTY_FILTERS);
      setSearch("");
      setHotelFilter(null);
      setView("all");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (hiddenSet.has(focusTarget.line.id)) setShowHidden(true);
      return;
    }
    if (focusIndex >= shown) {
      setPageState({ key: listKey, shown: focusIndex + 1 });
      return;
    }
    const el = document.getElementById(`line-${focusTarget.line.id}`);
    if (!el) return; // the page grown to it isn't drawn yet — runs again once it is
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    setOpenIds((prev) => (prev.has(focusTarget.line.id) ? prev : new Set(prev).add(focusTarget.line.id)));
    setFlashId(focusTarget.line.id);
    focusDone.current = focusLine;
    onFocusHandled?.();
  }, [focusLine, listReady, focusTarget, focusIndex, shown, listKey, displayedIds, hiddenSet, reduceMotion, onFocusHandled, tiers]);
  // Every line's strip has the pack's day columns, laid out the same at the list's width, so they line up under one header.
  // Counted with the ranking's warm-up: the strips only show once the list does.
  const columns = useMemo(() => (warmUp.ready ? packColumns(bidPack.bidPeriodStart, bidPack.bidPeriodDays, columnCountOf(bidPack)) : NO_COLUMNS), [bidPack, warmUp.ready]);
  const [listRef, listWidth] = useMeasuredWidth<HTMLDivElement>(768);
  const layout = useMemo(() => stripLayout(listWidth, columns.length), [listWidth, columns.length]);
  const [chosenStripView, setStripView] = useStripView();
  // What's drawn: the pilot's choice, or the Bid pack row on a pack with no dates to lay a timeline on. Said so when
  // they pick Timeline there, so the switch doesn't look broken.
  const stripView = stripViewFor(chosenStripView, bidPack);
  const [noTimelineSaid, setNoTimelineSaid] = useState(false);
  const chooseStripView = (next: StripViewMode) => {
    setStripView(next);
    setNoTimelineSaid(next === "timeline" && stripViewFor(next, bidPack) !== next);
  };
  // Only the cards near the screen are drawn in full (see `lib/use-windowed-rows.ts`); the page paints its top fast on a
  // phone, and showing all of a big pack costs no more than showing a page of it. Everything is drawn to print.
  const [firstBatch] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 2 : 6));
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  // Held still while a line is dragged: the cards it can land on stay drawn where they were measured.
  const rows = useWindowedRows(listRef, displayedIds, firstBatch, printing, `${stripView}|${listWidth}`, activeId !== null);
  // The first cards rise in one after another as the list first shows; cards drawn after that just fade in.
  const [revealing, setRevealing] = useState(true);
  useEffect(() => {
    if (!listReady) return;
    const timer = setTimeout(() => setRevealing(false), 1200);
    return () => clearTimeout(timer);
  }, [listReady]);
  const pressPropsFor = useCardPressProps(tiers, listedIds);
  const activeIndex = activeId ? displayedIds.indexOf(activeId) : -1;
  // Keys for working down the list at a desk: j / k move between lines, o opens one, s shortlists, c compares, ? shows the keys.
  // The cursor is a line, not a place in the list: a tier key moves the line, and the cursor goes with it.
  const [keyId, setKeyId] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  // Every listed line, drawn or not: j and k scroll the next one into view, which draws it.
  const keyableIds = displayedIds;
  const keyedId = keyId !== null && keyableIds.includes(keyId) ? keyId : null;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (!keyableIds.length) return;
      // The line the keys act on: the one with the keyboard's focus in it (a pilot who tabbed to a card), else the j / k cursor.
      const focusedId = t instanceof HTMLElement ? t.closest<HTMLElement>("[data-line-id]")?.dataset.lineId : undefined;
      const onId = focusedId && keyableIds.includes(focusedId) ? focusedId : keyedId;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = stepCursor(keyableIds, keyedId, e.key === "j" ? 1 : -1);
        if (!next) return;
        setKeyId(next);
        document.getElementById(`line-${next}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      } else if ((e.key === "o" || e.key === "Enter") && onId) {
        if (e.key === "Enter" && t instanceof HTMLElement && t.closest("button, a")) return;
        e.preventDefault();
        toggleOpen(onId);
      } else if (e.key === "s" && onId) {
        // The star changes without a sound, so the change is said: a screen reader user can't see it.
        const number = displayed.find((r) => r.line.id === onId)?.line.lineNumber ?? "";
        tiers.say(starredSet.has(onId) ? `Line ${number} removed from shortlist` : `Line ${number} shortlisted`);
        updateMarks((m) => toggleStar(m, onId));
      } else if (e.key === "c" && onId) {
        toggleCompare(onId);
      } else if (e.key === "x" && onId) {
        tiers.toggleSelected(onId);
      } else if (/^[0-9]$/.test(e.key) && onId) {
        // 1–9 move the line (or the selection it's in) to that tier; 0 takes it out of any.
        const tier = e.key === "0" ? null : tiers.state.tiers[Number(e.key) - 1]?.id;
        if (tier === undefined) return;
        e.preventDefault();
        tiers.move(tiers.selected.has(onId) ? [...tiers.selected] : [onId], tier);
      } else if (e.key === "?") {
        setShowKeys((v) => !v);
      } else if (e.key === "Escape") {
        setKeyId(null);
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

  // Exports follow the pilot's own ranking and tiers, among lines they haven't hidden or marked Not bid: a sort by days
  // off, a search or a filter is for looking, not for what to bid (see `bidOrderLines`).
  const exportable = useMemo(() => bidOrderLines(ranked, hiddenSet, tiers.notBid), [ranked, hiddenSet, tiers.notBid]);
  // Each line's note for "Copy with notes": the bid month, as each card counts it — not with what the last trip flies in
  // the next. Only read when copied, so it's worked out then, once per line until the profile changes, rather than for
  // every line of the pack on every swap.
  const noteOf = useMemo(() => lineNotes(bidPack, profile), [profile, bidPack]);
  const bidOrderEntries = useMemo<BidOrderEntry[]>(
    () =>
      exportable.lines.map((r) => ({
        lineScore: r,
        rank: rankById.get(r.line.id) ?? 0,
        get note() {
          return noteOf(r.line);
        },
      })),
    [exportable, rankById, noteOf]
  );
  const shortlistEntries = useMemo<BidOrderEntry[]>(
    () => bidOrderEntries.filter((e) => starredSet.has(e.lineScore.line.id)),
    [bidOrderEntries, starredSet]
  );

  // Same value on every line (it describes the pilot's profile, not any one line), so it's said once here instead of on all 283 cards.
  const confidenceLevel = ranked[0]?.confidenceLevel ?? null;

  const availableCities = useMemo(() => (warmUp.ready ? layoverCitiesOf(bidPack) : NO_CITIES), [bidPack, warmUp.ready]);
  const touchedCities = useMemo(() => (warmUp.ready ? touchedCitiesOf(bidPack) : NO_CITIES), [bidPack, warmUp.ready]);
  // Worked out with the ranking's warm-up (see `lib/ranking-warm-up.ts`), not in the page's first render.
  const filterOptions = useMemo(() => (warmUp.ready ? filterOptionsFor(bidPack.lines, bidPack.bidPeriodStart) : null), [bidPack, warmUp.ready]);

  // Measured once per pack, for refitting a pilot model to their drags without re-measuring every trip each time — the
  // pack the ranking measured, not measured again for this.
  const hasPilotModel = !!profile.pilotModel;
  const packFacts = useMemo(() => (hasPilotModel && warmUp.ready ? measuredPack(bidPack) : null), [bidPack, hasPilotModel, warmUp.ready]);
  // With the pilot's looked-up flights (or none), as the list on screen is scored: a drag learns from the order they saw.
  // A copy with flights of its own: the ranking's pack has whatever flights the last ranking set.
  const packMetrics = useMemo(() => (packFacts ? { ...packFacts, ctx: { ...packFacts.ctx, flights: flights ?? undefined } } : null), [packFacts, flights]);
  useEffect(() => {
    packMetricsRef.current = packMetrics;
  }, [packMetrics]);

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
    // Onto a line in another tier: the two trade tiers, and each stays in score order in its new one.
    if (tiers.tierOf(String(active.id)) !== tiers.tierOf(String(over.id))) {
      tiers.swap(String(active.id), String(over.id));
      return;
    }

    const judgments = buildJudgments(sorted, fromIndex, toIndex);
    // The two lines trade places and stay there, whatever the brain makes of it.
    const swapId = `swap-${Date.now().toString(36)}`;
    const placement = placementFromDrag(sorted.map((r) => r.line.id), fromIndex, toIndex, swapId);
    if (placement) {
      updatePlacements((p) => [...p, placement]);
      setOrderHistory((h) => recordStep(h, { kind: "swap", swap: { placement } }));
    }
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
        if (!current.pilotModel || !placementsList.current().some((p) => p.id === swapId)) return;
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
  function takeBackSwap(id: string): SwapStep | null {
    const placement = placementsList.current().find((x) => x.id === id);
    if (!placement) return null;
    const current = profileRef.current;
    // What it taught, as first taught (whether a later swap set one aside is worked out again when it's given back).
    const lesson = (current.brainInterview?.choices ?? [])
      .filter((c) => c.dragId === id)
      .map((c) => {
        const back = { ...c };
        delete back.supersededBy;
        return back;
      });
    const exact: SwapStep["exact"] = lastSwap?.id === id && lastSwap.after === current ? { before: lastSwap.before, after: lastSwap.after } : undefined;
    updatePlacements((p) => p.filter((x) => x.id !== id));
    setLearnMessage(null);
    if (lastSwap?.id === id) setLastSwap(null);
    if (swapQuestion?.question.dragId === id) setSwapQuestion(null);
    // The lines go back at once; what the swap taught comes out once that's painted, as a swap's learning goes in (a
    // profile put back re-ranks every line, which on the biggest pack and a slow phone was half a second of nothing
    // happening after the press). Skipped if the swap was put back again in the meantime.
    afterPaint(() => {
      if (placementsList.current().some((x) => x.id === id)) return;
      const now = profileRef.current;
      let next: PreferenceProfile | null = null;
      if (exact && now === exact.after) next = exact.before;
      else if (now.pilotModel && lesson.length) next = withModel(now, bidPack, { choices: withoutDrag(now.brainInterview?.choices ?? [], id) }, packMetricsRef.current ?? undefined).profile;
      if (next && next !== now) {
        profileRef.current = next;
        onUpdateProfile(next);
      }
    });
    return { placement, lesson, exact };
  }

  /** The swap back where the pilot had put it, and what it taught back with it — that, as with a swap, once it's painted. */
  function putBackSwap(step: SwapStep) {
    const { placement, lesson = [], exact } = step;
    updatePlacements((p) => [...p.filter((x) => x.id !== placement.id), placement]);
    const numberOf = (lineId: string) => bidPack.lines.find((l) => l.id === lineId)?.lineNumber ?? "";
    setLearnMessage(`Swapped ${numberOf(placement.order[0])} and ${numberOf(placement.order[placement.order.length - 1])} again.`);
    afterPaint(() => {
      if (!placementsList.current().some((x) => x.id === placement.id)) return;
      const current = profileRef.current;
      let next: PreferenceProfile | null = null;
      if (exact && current === exact.before) next = exact.after;
      else if (current.pilotModel && lesson.length) next = withModel(current, bidPack, { choices: addDragChoices(current.brainInterview?.choices ?? [], lesson) }, packMetricsRef.current ?? undefined).profile;
      if (next && next !== current) {
        profileRef.current = next;
        onUpdateProfile(next);
      }
      setLastSwap({ id: placement.id, before: current, after: next ?? current });
    });
  }

  /** ⌘Z and Undo: the newest change, tier or swap. A swap's lesson goes with it, as a tier move's does. */
  function undoOrder() {
    const r = takeUndo(heldHistory());
    if (!r) return;
    if (r.step.kind === "tier") {
      setOrderHistory(() => r.history);
      tiers.undo();
      return;
    }
    const back = takeBackSwap(r.step.swap.placement.id);
    // A swap that's already gone (put back some other way) just leaves the history.
    setOrderHistory(() => (back ? { past: r.history.past, future: [{ kind: "swap", swap: back }, ...r.history.future.slice(1)] } : { ...r.history, future: r.history.future.slice(1) }));
  }

  function redoOrder() {
    const r = takeRedo(heldHistory());
    if (!r) return;
    setOrderHistory(() => r.history);
    if (r.step.kind === "tier") tiers.redo();
    else putBackSwap(r.step.swap);
  }

  /**
   * Takes back one swap: the "Undo" beside what a swap taught, and "Undo last swap". The newest change is undone as ⌘Z
   * would (redo puts it back); an older swap is taken out on its own and leaves the history.
   */
  function undoSwap(id: string) {
    const top = heldHistory().past.at(-1);
    if (top?.kind === "swap" && top.swap.placement.id === id) return undoOrder();
    takeBackSwap(id);
    setOrderHistory((h) => dropSwaps(h, (s) => s.placement.id === id));
  }

  /** Puts the list back in the brain's order. What it learned from the swaps stays; undo a swap to take that back too. */
  function clearPlacements() {
    updatePlacements(() => []);
    setOrderHistory((h) => dropSwaps(h, () => true));
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
              ? "Kept as a limit."
              : reply.action === "drop"
                ? "No longer a limit — it still counts as one of your priorities."
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

      <QuickStartNote bidPack={bidPack} profile={profile} />
      <ResultsStatusPanel
        pack={bidPack}
        profile={profile}
        onUpdateProfile={onUpdateProfile}
        confidenceLevel={confidenceLevel}
        onEditPreferences={onEditPreferences}
        bidPeriodChange={bidPeriodChange}
        forecast={{
          hasList: !!bidPack.seniorityList?.length,
          forecast: listReady ? forecast.result?.forecast ?? null : null,
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
      <VacationChoicePanel bidPack={bidPack} carry={carry} order={ranked.map((r) => r.line.lineNumber)} />
      <FirstVisitTour ready={listReady} />
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

      {flightsLooking && !flights && listReady && (
        <div role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
          <Spinner size="sm" />
          Looking up real airline flights for your top lines&hellip;
        </div>
      )}

      {flightsWaiting && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent">
          <span>Real commute flights for your top lines just came in &mdash; other flights you could take, and when you&rsquo;d really get home.</span>
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


      {!listReady ? (
        <div className="mt-6">
          {!warmUp.ready ? (
            // How far along is shown, not said: a screen reader hears the line once, not a number every moment.
            <div role="status" className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
              <Spinner size="sm" />
              Ranking your {bidPack.lines.length} lines&hellip;
              <span aria-hidden className="font-mono tabular-nums text-ink-faint">{Math.round(warmUp.share * 100)}%</span>
            </div>
          ) : (
            <div role="status" className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
              <Spinner size="sm" />
              Checking layover hotel reviews so your ranking is right the first time&hellip;
            </div>
          )}
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
                className="w-full rounded-md border border-field-edge bg-canvas/50 px-3 py-2 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </div>
            <SortMenu sort={lineSort} lines={listable} />
            {/* Buttons that say which one is on, not tabs: tabs promised arrow keys and a panel of their own, and the list below is the same list filtered.
                Their focus ring is drawn inside: the rounded box clips anything outside it. */}
            <div className="ml-auto flex overflow-hidden rounded-md border border-hairline text-sm" role="group" aria-label="Which lines to show">
              <button
                type="button"
                aria-pressed={view === "all"}
                onClick={() => setView("all")}
                className={`relative px-3 py-2 font-medium transition-colors duration-300 focus-visible:-outline-offset-2 ${view === "all" ? "text-accent" : "text-ink-muted hover:text-ink"}`}
              >
                {view === "all" && <PillHighlight group="results-view" className={VIEW_PILL} />}
                <span className="relative z-10">All lines</span>
              </button>
              <button
                type="button"
                aria-pressed={view === "shortlist"}
                data-shortlist-tab
                onClick={() => setView("shortlist")}
                className={`relative border-l border-hairline px-3 py-2 font-medium transition-colors duration-300 focus-visible:-outline-offset-2 ${view === "shortlist" ? "text-accent" : "text-ink-muted hover:text-ink"}`}
              >
                {view === "shortlist" && <PillHighlight group="results-view" className={VIEW_PILL} />}
                <span className="relative z-10">
                  Shortlist (<FlipText text={String(validMarks.starred.length)} />)
                </span>
              </button>
              {forecastLines && (
                <button
                  type="button"
                  aria-pressed={view === "realistic"}
                  onClick={() => setView("realistic")}
                  className={`relative border-l border-hairline px-3 py-2 font-medium transition-colors duration-300 focus-visible:-outline-offset-2 ${view === "realistic" ? "text-accent" : "text-ink-muted hover:text-ink"}`}
                >
                  {view === "realistic" && <PillHighlight group="results-view" className={VIEW_PILL} />}
                  <span className="relative z-10">Realistic ({realisticIds.size})</span>
                </button>
              )}
            </div>
          </div>

          <SortNote sort={lineSort} />
          <TierBar tiers={tiers} lines={placed} history={{ undo: undoOrder, redo: redoOrder, canUndo: orderHistory.past.length > 0, canRedo: orderHistory.future.length > 0 }} />

          {/* A small staggered beat behind the header above — the page reads as "header settles, then controls, then the list below" instead of everything landing in one flat instant. */}
          <div className="animate-rise-in print:hidden" style={{ animationDelay: "60ms" }}>
            {filterOptions && (
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
            )}
          </div>

          <div className="animate-rise-in print:hidden" style={{ animationDelay: "120ms" }}>
            <BidOrderExport
              entries={bidOrderEntries}
              shortlistEntries={shortlistEntries}
              bidPeriodStart={bidPack.bidPeriodStart}
              bidMonth={bidPack.month}
              packLabel={[bidPack.month, bidPack.base, bidPack.aircraft, bidPack.seat].join(" · ")}
              leftOut={bidPack.lines.length - exportable.lines.length}
              leftOutWhy={leftOutPhrase(exportable.hidden, exportable.notBid)}
              presend={{ bidPack, profile, rankedForecast: forecast.result?.forecast ?? null, rankedIds: rankingLineIds }}
              topLineNumber={exportable.lines[0]?.line.lineNumber ?? null}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <StripKey view={stripView} />
            <StripViewToggle view={stripView} onChange={chooseStripView} />
          </div>
          {noTimelineSaid && stripView !== chosenStripView && (
            <p role="status" className="mt-1.5 text-right text-xs text-ink-muted print:hidden">
              This pack prints no bid period dates, so there&rsquo;s no timeline to put its trips on. Lines show as the bid pack prints them.
            </p>
          )}

          {showKeys && (
            <div role="note" className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-hairline bg-canvas/40 px-3 py-2 font-mono text-[11px] text-ink-muted sm:flex print:hidden">
              {[
                ["j / k", "next / previous line"],
                ["o", "open / close it"],
                ["s", "shortlist"],
                ["c", "compare"],
                ["x", "select"],
                ["1–5", "move to a tier"],
                ["⌘Z", "undo"],
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
                displayed.map((lineScore, index) => {
                  const id = lineScore.line.id;
                  const heading = headings.get(id);
                  const open = openIds.has(id);
                  const rank = rankById.get(id) ?? 0;
                  // Drawn: near the screen, or open, being dragged (and the lines either side of it, which a keyboard
                  // swap lands on) or just asked for — they're kept, wherever the page is.
                  const drawn = rows.drawn(index) || open || (activeIndex !== -1 && Math.abs(index - activeIndex) <= 1) || id === flashId;
                  return (
                    <div key={id} data-row className="space-y-1.5">
                      {heading && <TierHeadingRow heading={heading} />}
                      {drawn ? (
                        <motion.div
                          ref={rows.measure(id)}
                          id={`line-${id}`}
                          data-line-id={id}
                          {...pressPropsFor(id)}
                          className={`scroll-mt-20 md:scroll-mt-6 ${flashId === id ? "line-flash" : ""} ${keyedId === id ? "line-keyed" : ""} ${tiers.selected.has(id) ? "rounded-xl ring-2 ring-accent" : ""}`}
                          layout={layoutArmed ? "position" : false}
                          layoutDependency={dragEnabled && order.moved.has(id) ? order.turn : 0}
                          // The list's first cards rise in one after another; a card drawn later, as the pilot scrolls
                          // to it, fades straight in where it stands.
                          initial={reduceMotion ? false : revealing ? { opacity: 0, y: 10 } : { opacity: 0 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={
                            reduceMotion
                              ? { duration: 0 }
                              : {
                                  layout: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
                                  opacity: { duration: revealing ? 0.35 : 0.2, ease: [0.16, 1, 0.3, 1], delay: revealing ? Math.min(index * 0.035, 0.4) : 0 },
                                  y: { duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: Math.min(index * 0.035, 0.4) },
                                }
                          }
                        >
                          <ErrorBoundary>
                            <LineCard
                              line={lineScore.line}
                              score={lineScore.score}
                              capped={lineScore.violatedDealbreakers.length > 0}
                              topPick={rank === 1}
                              bidPeriodStart={bidPack.bidPeriodStart}
                              bidPeriodDays={bidPack.bidPeriodDays}
                              homeBase={bidPack.base}
                              hidden={hiddenSet.has(id)}
                              draggable={dragEnabled}
                              packColumns={columns}
                              stripLayout={layout}
                              stripView={stripView}
                              open={open}
                              placedByYou={dragEnabled && swappedIds.has(id)}
                              actions={cardActions}
                              details={
                                open
                                  ? {
                                      rank,
                                      lineScore,
                                      profile,
                                      implicitValuesByLine,
                                      homeBaseOffsetMinutes,
                                      isComparing: compareIds.includes(id),
                                      starred: starredSet.has(id),
                                      forecast: forecastLines?.[id] ?? null,
                                      heldBy: heldByNotes(lineScore.line.lineNumber),
                                      flights,
                                      tripScores,
                                      sortedBy: lineSort.def.label,
                                      sortedValue: lineSort.valueFor(id),
                                      openExtra: <TierMoveRow tiers={tiers} lineId={id} />,
                                    }
                                  : null
                              }
                            />
                          </ErrorBoundary>
                          <CarryInLineNote flown={carry.flown.lines.get(id)} vacation={carry.flown.vacationLines.get(id)} />
                        </motion.div>
                      ) : (
                        <LineStandIn id={id} lineNumber={lineScore.line.lineNumber} height={rows.heightOf(id)} />
                      )}
                    </div>
                  );
                })
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

      {compareLineScores.length === 2 && Comparison && (
        <Comparison
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
