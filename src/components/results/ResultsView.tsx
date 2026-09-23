"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { motion, useReducedMotion } from "motion/react";
import { BidOrderExport, type BidOrderEntry } from "@/components/results/BidOrderExport";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PreferenceMicroPrompt } from "@/components/results/PreferenceMicroPrompt";
import { ResultsFilterBar } from "@/components/results/ResultsFilterBar";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heading } from "@/components/ui/Heading";
import { Spinner } from "@/components/ui/Spinner";
import { LineCard } from "@/components/results/LineCard";
import { LineComparisonModal } from "@/components/results/LineComparisonModal";
import { MonthLegend } from "@/components/results/MiniLinePreview";
import { PilotProfileSummary } from "@/components/results/PilotProfileSummary";
import { ScoreRing } from "@/components/results/ScoreRing";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { fetchAllHotelQualityData } from "@/lib/hotel-client";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { assessProfileRichness } from "@/lib/interview-engine";
import { computeFilterOptions } from "@/lib/line-filter-options";
import { collectLayoverCities, EMPTY_FILTERS, lineMatchesFilters, type LineFilters } from "@/lib/line-filters";
import { loadTopLinesSnapshot, saveTopLinesSnapshot } from "@/lib/line-history-storage";
import { buildLineFactChips, lineFactsText } from "@/lib/line-summary";
import { loadLineMarks, saveLineMarks } from "@/lib/line-marks-storage";
import { PHRASES } from "@/lib/preference-summary";
import {
  PAGE_SIZE,
  SORT_OPTIONS,
  hideLine,
  matchesLineSearch,
  nextVisibleCount,
  pruneMarks,
  restoreLine,
  sortLineScores,
  toggleStar,
  type LineMarks,
  type SortMode,
} from "@/lib/results-list";
import {
  learnFromReorder,
  type DimensionUpdate,
  type PairwiseJudgment,
} from "@/lib/rank-learning";
import { rankLines, type HotelQualityData, type LineScore } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";

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
}

export function ResultsView({
  bidPack,
  profile,
  onStartOver,
  onUploadNewPack,
  onEditPreferences,
  onUpdateProfile,
  userId,
}: ResultsViewProps) {
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [hotelQualityData, setHotelQualityData] = useState<HotelQualityData>({});
  const [hotelDone, setHotelDone] = useState(false);
  const [hotelTimedOut, setHotelTimedOut] = useState(false);
  const [learnMessage, setLearnMessage] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [promptJudgment, setPromptJudgment] = useState<PairwiseJudgment | null>(null);
  const [promptCount, setPromptCount] = useState(0);
  const [askedPairIds, setAskedPairIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<LineFilters>(EMPTY_FILTERS);
  // At most two at a time — picking a third drops the oldest rather than growing unbounded, since the comparison view only ever shows two side by side.
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("match");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "shortlist">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [marks, setMarks] = useState<LineMarks>(() => loadLineMarks(userId, bidPack.id));
  const [pageState, setPageState] = useState({ key: "", shown: PAGE_SIZE });
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
    setMarks(loadLineMarks(userId, bidPack.id));
    setSearch("");
    setView("all");
  }

  useEffect(() => {
    if (!caresAboutHotel) return;
    let cancelled = false;
    // Deliberately reset here: a different pack (or a returning visit) must wait for its own hotel data, not inherit "done" from the last one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const [priorTopLines] = useState(() => loadTopLinesSnapshot(userId));

  const ranked = useMemo(
    () => rankLines(bidPack, profile, hotelQualityData, implicitValuesByLine, profileRichness, priorTopLines),
    [bidPack, profile, hotelQualityData, implicitValuesByLine, profileRichness, priorTopLines]
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
    saveTopLinesSnapshot(userId, ranked);
  }, [userId, ranked, hotelsSettled]);

  // Global rank survives filtering — a filtered card or export entry always
  // shows its true position in the full ranking, not a renumbered index into
  // whatever subset currently matches the filters.
  const rankById = useMemo(() => new Map(ranked.map((r, i) => [r.line.id, i + 1] as const)), [ranked]);

  const matching = useMemo(
    () => ranked.filter((r) => lineMatchesFilters(r.line, filters) && matchesLineSearch(r.line, search)),
    [ranked, filters, search]
  );
  const hiddenMatchingCount = matching.filter((r) => hiddenSet.has(r.line.id)).length;
  const listable = useMemo(
    () => matching.filter((r) => (showHidden || !hiddenSet.has(r.line.id)) && (view === "all" || starredSet.has(r.line.id))),
    [matching, showHidden, hiddenSet, view, starredSet]
  );
  const sorted = useMemo(() => sortLineScores(listable, sortMode), [listable, sortMode]);

  // Back to the first page whenever what's being listed changes — landing on
  // "page 4 of a different list" would show a scrolled-past-nothing view.
  const listKey = `${sortMode}|${search}|${view}|${showHidden}|${filtersKey(filters)}|${ranked.length}`;
  if (pageState.key !== listKey) setPageState({ key: listKey, shown: PAGE_SIZE });
  const shown = pageState.key === listKey ? pageState.shown : PAGE_SIZE;
  const displayed = sorted.slice(0, shown);

  // Exports follow the pilot's own ranking (best match), among lines they haven't hidden — a sort-by-days-off view is for looking, not for what to bid.
  const exportable = useMemo(() => matching.filter((r) => !hiddenSet.has(r.line.id)), [matching, hiddenSet]);
  const bidOrderEntries = useMemo<BidOrderEntry[]>(
    () =>
      exportable.map((r) => ({
        lineScore: r,
        rank: rankById.get(r.line.id) ?? 0,
        note: lineFactsText(buildLineFactChips(r.line, profile)),
      })),
    [exportable, rankById, profile]
  );
  const shortlistEntries = useMemo<BidOrderEntry[]>(
    () => bidOrderEntries.filter((e) => starredSet.has(e.lineScore.line.id)),
    [bidOrderEntries, starredSet]
  );

  // Same value on every line (it describes the pilot's profile, not any one line), so it's said once here instead of on all 283 cards.
  const confidenceLevel = ranked[0]?.confidenceLevel ?? null;

  const availableCities = useMemo(() => collectLayoverCities(bidPack.lines), [bidPack]);
  const filterOptions = useMemo(() => computeFilterOptions(bidPack.lines), [bidPack]);

  // Derived once from the bid pack's own printed times — see lib/circadian.ts.
  const homeBaseOffsetMinutes = useMemo(() => computeHomeBaseOffsetMinutes(bidPack), [bidPack]);

  useEffect(() => {
    if (!learnMessage) return;
    const timer = setTimeout(() => setLearnMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [learnMessage]);

  const sensors = useSensors(
    // A small activation distance so a plain tap/click to expand a card
    // (no real movement) never gets mistaken for the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const activeLineScore = activeId ? ranked.find((r) => r.line.id === activeId) ?? null : null;
  // Drag-to-swap only means something in the pilot's own ranking order — in any other sort the visual order isn't the ranked order the judgment is built from.
  const dragEnabled = sortMode === "match";

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = ranked.findIndex((r) => r.line.id === active.id);
    const toIndex = ranked.findIndex((r) => r.line.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;

    const judgments = buildJudgments(ranked, fromIndex, toIndex);
    const result = learnFromReorder(profile, implicitValuesByLine, judgments);

    if (result.updates.length === 0) {
      setLearnMessage(
        "Noted — but those lines look too similar on what I'm tracking to tell what to adjust. Try a few more corrections."
      );
      return;
    }

    // The gradient update always applies right away — even a high-surprise
    // judgment already made the model a little smarter before anyone
    // answers anything. The micro-prompt only ever adds a confidence bonus
    // on top, never gates whether learning happened at all (Section 5.2).
    onUpdateProfile({
      ...profile,
      weights: result.weights,
      implicitWeights: result.implicitWeights,
      implicitConfidence: result.implicitConfidence,
    });
    setLearnMessage(describeLearn(result.updates));

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

  function handlePromptResolved(reinforcedProfile: PreferenceProfile | null) {
    if (reinforcedProfile) onUpdateProfile(reinforcedProfile);
    setPromptJudgment(null);
  }

  const emptyMessage =
    view === "shortlist"
      ? "Nothing shortlisted yet — tap the star on any line to save it here."
      : search.trim()
        ? `No line matches “${search.trim()}”.`
        : "No lines match the current filters. Try clearing one or two.";

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <div className="flex items-start justify-between gap-3 sm:items-end">
        <div>
          <Heading as="h1" className="text-2xl text-ink sm:text-3xl">
            Your ranked lines
          </Heading>
          <p className="mt-1.5 text-sm text-ink-muted">
            {bidPack.base} {bidPack.aircraft} {bidPack.seat} &middot; {bidPack.month}{" "}
            &middot; {bidPack.lines.length} lines<span className="hidden sm:inline"> scored against your preferences</span>
            {profile.deepRoundCompleted && (
              <span className="ml-2 inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                Deep interview
              </span>
            )}
          </p>
        </div>
        <Button variant="secondary" onClick={onEditPreferences} className="shrink-0 px-3 sm:px-4">
          Edit<span className="hidden sm:inline">&nbsp;preferences</span>
        </Button>
      </div>

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
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent animate-fade-in">
          {learnMessage}
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

      {hotelsArrivedLate && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent">
          Hotel reviews just finished loading &mdash; your ranking was updated to include them.
        </div>
      )}

      {(confidenceLevel === "thin" || confidenceLevel === "moderate") && (
        <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-ink-muted">
          These rankings are based on a{confidenceLevel === "thin" ? " shorter" : " moderate-length"} interview
          {confidenceLevel === "thin" ? ", so treat them as a first cut" : ""}.{" "}
          <button
            type="button"
            onClick={onEditPreferences}
            className="font-medium text-brand underline decoration-dotted underline-offset-4 hover:text-brand-strong"
          >
            Add detail on your Preferences page
          </button>{" "}
          to sharpen them.
        </div>
      )}

      <div className="mt-5">
        <PilotProfileSummary profile={profile} />
      </div>

      {!hotelsSettled ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-14 text-center">
          <Spinner size="md" />
          <p className="text-sm text-ink-muted">Checking layover hotel reviews so your ranking is right the first time&hellip;</p>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[9rem] flex-1 sm:max-w-[14rem]">
              <input
                type="search"
                inputMode="numeric"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a line number"
                aria-label="Find a line by number"
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <span className="sr-only sm:not-sr-only">Sort</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="rounded-md border border-border-strong bg-surface px-2.5 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="ml-auto flex overflow-hidden rounded-md border border-border-strong text-sm" role="tablist" aria-label="Which lines to show">
              <button
                type="button"
                role="tab"
                aria-selected={view === "all"}
                onClick={() => setView("all")}
                className={`px-3 py-2 font-medium transition-colors ${view === "all" ? "bg-brand-soft text-brand" : "text-ink-muted hover:text-ink"}`}
              >
                All lines
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "shortlist"}
                onClick={() => setView("shortlist")}
                className={`border-l border-border-strong px-3 py-2 font-medium transition-colors ${view === "shortlist" ? "bg-brand-soft text-brand" : "text-ink-muted hover:text-ink"}`}
              >
                Shortlist ({validMarks.starred.length})
              </button>
            </div>
          </div>

          <ResultsFilterBar
            filters={filters}
            onChange={setFilters}
            options={filterOptions}
            availableCities={availableCities}
            visibleCount={matching.length}
            totalCount={ranked.length}
          />

          <BidOrderExport
            entries={bidOrderEntries}
            shortlistEntries={shortlistEntries}
            bidPeriodStart={bidPack.bidPeriodStart}
          />

          <MonthLegend className="mt-3" />

          {dragEnabled && (
            <p className="mt-2 hidden text-xs text-ink-faint sm:block">
              Ranked something wrong? Drag a line by its handle onto another to swap &mdash; each swap teaches Line
              Select what you actually care about.
            </p>
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
          >
            <div className="mt-3 space-y-3">
              {displayed.length === 0 ? (
                <EmptyState compact description={emptyMessage} />
              ) : (
                displayed.map((lineScore) => (
                  <motion.div
                    key={lineScore.line.id}
                    layout={dragEnabled ? "position" : false}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }
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
                      />
                    </ErrorBoundary>
                  </motion.div>
                ))
              )}
            </div>
            <DragOverlay>{activeLineScore && <DragPreview lineScore={activeLineScore} />}</DragOverlay>
          </DndContext>

          {sorted.length > displayed.length && (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-4 py-4 text-center">
              <p className="text-sm text-ink-muted">
                Showing {displayed.length} of {sorted.length} lines
                {view === "all" && sortMode === "match" ? " — the best matches first" : ""}.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
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

      {compareLineScores.length === 2 && (
        <LineComparisonModal
          lineScores={[compareLineScores[0], compareLineScores[1]]}
          homeBaseOffsetMinutes={homeBaseOffsetMinutes}
          bidPeriodStart={bidPack.bidPeriodStart}
          bidPeriodDays={bidPack.bidPeriodDays}
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

/** A stable string for "what filters are on" — lets the page reset to the first page when they change without depending on Set identity. */
function filtersKey(f: LineFilters): string {
  return [
    f.minDaysOff,
    f.minCreditHours,
    f.maxTripDays,
    f.tripCount,
    [...f.reportTimes].sort().join(","),
    [...f.cities].sort().join(","),
    f.noDeadheadsOnly,
    f.noRedEyesOnly,
    f.verifiedOnly,
    f.international,
  ].join("/");
}
