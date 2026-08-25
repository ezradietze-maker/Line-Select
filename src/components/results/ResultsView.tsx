"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LineCard } from "@/components/results/LineCard";
import { fetchAllHotelQualityData } from "@/lib/hotel-client";
import { PHRASES } from "@/lib/preference-summary";
import { learnFromReorder } from "@/lib/rank-learning";
import { rankLines, type HotelQualityData } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";

function describeLearn(dimension: keyof PreferenceWeights, newWeight: number): string {
  const phrase = newWeight >= 0 ? PHRASES[dimension].positive : PHRASES[dimension].negative;
  return `Got it — weighting ${phrase} more heavily from here on.`;
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

  function handleMoveLine(lineId: string, direction: "up" | "down") {
    const index = ranked.findIndex((r) => r.line.id === lineId);
    if (index === -1) return;
    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= ranked.length) return;

    const [favored, overtaken] =
      direction === "up" ? [ranked[index], ranked[neighborIndex]] : [ranked[neighborIndex], ranked[index]];

    const result = learnFromReorder(profile.weights, favored, overtaken);
    if (!result.adjustedDimension) {
      setLearnMessage(
        "Noted — but those two lines look too similar on what I'm tracking to tell what to adjust. Try a few more corrections."
      );
      return;
    }

    onUpdateProfile({ ...profile, weights: result.weights });
    setLearnMessage(describeLearn(result.adjustedDimension, result.weights[result.adjustedDimension]));
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
        Think a line is ranked too high or too low? Use the arrows on the left of any card —
        each correction adjusts your weights a bit, so your ranking keeps getting more accurate.
      </p>

      <div className="mt-3 space-y-3">
        {ranked.map((lineScore, i) => (
          <LineCard
            key={lineScore.line.id}
            rank={i + 1}
            lineScore={lineScore}
            canMoveUp={i > 0}
            canMoveDown={i < ranked.length - 1}
            onMoveUp={() => handleMoveLine(lineScore.line.id, "up")}
            onMoveDown={() => handleMoveLine(lineScore.line.id, "down")}
          />
        ))}
      </div>
    </div>
  );
}
