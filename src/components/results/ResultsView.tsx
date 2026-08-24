"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LineCard } from "@/components/results/LineCard";
import { fetchAllHotelQualityData } from "@/lib/hotel-client";
import { rankLines, type HotelQualityData } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

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
}

export function ResultsView({
  bidPack,
  profile,
  onStartOver,
  onRefine,
}: ResultsViewProps) {
  const [hotelQualityData, setHotelQualityData] = useState<HotelQualityData>({});
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

      <div className="mt-6 space-y-3">
        {ranked.map((lineScore, i) => (
          <LineCard key={lineScore.line.id} rank={i + 1} lineScore={lineScore} />
        ))}
      </div>
    </div>
  );
}
