"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { Button } from "@/components/ui/Button";
import { LineCard } from "@/components/results/LineCard";
import { ScoreRing } from "@/components/results/ScoreRing";
import { fetchAllHotelQualityData } from "@/lib/hotel-client";
import { PHRASES } from "@/lib/preference-summary";
import { learnFromReorder, type LearnedAdjustment } from "@/lib/rank-learning";
import { rankLines, type HotelQualityData, type LineScore } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * Magnitude-only hotel weights have no negative direction, so their final
 * sign never tells you whether this correction just raised or lowered them —
 * only `direction` (which way this specific nudge went) does. Every other
 * dimension is bipolar, where the resulting sign itself is the more useful
 * thing to report (a pilot cares what they currently lean toward, not just
 * which way the last tweak happened to push).
 */
function phraseFor(adjustment: LearnedAdjustment): string {
  const magnitudeOnly = adjustment.key.startsWith("hotel");
  const leansPositive = magnitudeOnly ? adjustment.direction > 0 : adjustment.weight >= 0;
  return leansPositive ? PHRASES[adjustment.key].positive : PHRASES[adjustment.key].negative;
}

function describeLearn(adjustments: LearnedAdjustment[]): string {
  const phrases = adjustments.map(phraseFor);
  const joined = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}` : phrases[0];
  return `Got it — weighting ${joined} more heavily from here on.`;
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

    // A direct swap: dropping line A onto line B teaches the app exactly
    // one thing — A belongs at least as high as B — and nothing else in the
    // list is touched. Dragging up always promotes the dragged line;
    // dragging down always demotes it in favor of whatever it landed on.
    const moved = ranked[fromIndex];
    const displaced = ranked[toIndex];
    const [favored, overtaken] = toIndex < fromIndex ? [moved, displaced] : [displaced, moved];

    const result = learnFromReorder(profile.weights, favored, overtaken);
    if (result.adjustments.length === 0) {
      setLearnMessage(
        "Noted — but those two lines look too similar on what I'm tracking to tell what to adjust. Try a few more corrections."
      );
      return;
    }

    onUpdateProfile({ ...profile, weights: result.weights });
    setLearnMessage(describeLearn(result.adjustments));
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

      {learnMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent animate-fade-in">
          {learnMessage}
        </div>
      )}

      <p className="mt-6 text-xs text-ink-faint">
        Think a line is ranked too high or too low? Drag it by the grip on the left and drop it
        directly onto another line to swap — each swap adjusts your weights a bit, so your
        ranking keeps getting more accurate.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="mt-3 space-y-3">
          {ranked.map((lineScore, i) => (
            <LineCard key={lineScore.line.id} rank={i + 1} lineScore={lineScore} />
          ))}
        </div>
        <DragOverlay>{activeLineScore && <DragPreview lineScore={activeLineScore} />}</DragOverlay>
      </DndContext>
    </div>
  );
}
