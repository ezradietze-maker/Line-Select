"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PreferenceMicroPrompt } from "@/components/results/PreferenceMicroPrompt";
import { Button } from "@/components/ui/Button";
import { LineCard } from "@/components/results/LineCard";
import { ScoreRing } from "@/components/results/ScoreRing";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { fetchAllHotelQualityData } from "@/lib/hotel-client";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { PHRASES } from "@/lib/preference-summary";
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

interface ResultsViewProps {
  bidPack: BidPack;
  profile: PreferenceProfile;
  onStartOver: () => void;
  onRefine: () => void;
  onUpdateProfile: (profile: PreferenceProfile) => void;
}

export function ResultsView({
  bidPack,
  profile,
  onStartOver,
  onRefine,
  onUpdateProfile,
}: ResultsViewProps) {
  const [hotelQualityData, setHotelQualityData] = useState<HotelQualityData>({});
  const [learnMessage, setLearnMessage] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [promptJudgment, setPromptJudgment] = useState<PairwiseJudgment | null>(null);
  const [promptCount, setPromptCount] = useState(0);
  const [askedPairIds, setAskedPairIds] = useState<Set<string>>(new Set());
  const caresAboutHotel = caresAboutLayoverQuality(profile);

  useEffect(() => {
    if (!caresAboutHotel) return;
    let cancelled = false;
    fetchAllHotelQualityData(bidPack).then((data) => {
      if (!cancelled) setHotelQualityData(data);
    });
    return () => {
      cancelled = true;
    };
    // Only the bid pack's identity and whether the pilot cares at all should
    // re-trigger this — re-fetching on every profile tweak (a slider nudge
    // elsewhere) would be wasted, cached network calls for data that hasn't
    // changed.
  }, [bidPack, caresAboutHotel]);

  const ranked = useMemo(
    () => rankLines(bidPack, profile, hotelQualityData),
    [bidPack, profile, hotelQualityData]
  );

  // The implicit taxonomy's normalized per-line values only depend on the
  // bid pack's own trip data, never on the pilot's weights — computed once
  // per bid pack and reused across every drag rather than recomputed per
  // judgment.
  const implicitValuesByLine = useMemo(() => computeImplicitLineValues(bidPack), [bidPack]);

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

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">
            Your ranked lines
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {bidPack.base} {bidPack.aircraft} {bidPack.seat} &middot; {bidPack.month}{" "}
            &middot; {bidPack.lines.length} lines scored against your preferences
            {profile.deepRoundCompleted && (
              <span className="ml-2 inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                Deep interview
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRefine}>
            Refine preferences
          </Button>
          <Button variant="ghost" onClick={onStartOver}>
            Start over
          </Button>
        </div>
      </div>

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

      <p className="mt-6 text-xs text-ink-faint">
        Think a line is ranked too high or too low? Drag it by the grip on the left and drop it
        directly onto another line to swap — each swap teaches the model something about what
        you actually care about, so your ranking keeps getting more accurate.
      </p>

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
        // move to support layouts that DO reflow mid-drag; with up to ~100
        // cards that's ~100 getBoundingClientRect layout reads per frame,
        // which is the actual source of the drag feeling laggy. Measuring
        // once at drag start is correct here and removes that cost entirely.
        measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
      >
        <div className="mt-3 space-y-3">
          {ranked.map((lineScore, i) => (
            <ErrorBoundary key={lineScore.line.id}>
              <LineCard
                rank={i + 1}
                lineScore={lineScore}
                profile={profile}
                implicitValuesByLine={implicitValuesByLine}
                homeBaseOffsetMinutes={homeBaseOffsetMinutes}
              />
            </ErrorBoundary>
          ))}
        </div>
        <DragOverlay>{activeLineScore && <DragPreview lineScore={activeLineScore} />}</DragOverlay>
      </DndContext>
    </div>
  );
}
